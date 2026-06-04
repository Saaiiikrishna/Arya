'use client';

/**
 * Socket.io hooks for the store realtime namespaces (backend
 * `store-realtime/{stock,orders}.gateway.ts`).
 *
 * Connection model is reused verbatim from the chat widget
 * (src/components/ChatWidget.tsx): the websocket host is `NEXT_PUBLIC_API_URL`
 * with the trailing `/api` stripped, the JWT rides in `handshake.auth.token`,
 * and `transports: ['websocket']`. The only differences here are the namespace
 * suffix (`/store/stock`, `/store/orders`) and the auth source:
 *
 *  - useAdminStockSocket  → `/store/stock`,  PLATFORM admin token (api.getToken)
 *  - useAdminOrdersSocket → `/store/orders`, PLATFORM admin token (api.getToken)
 *  - useStoreOrderTracking → `/store/orders`, a guest order token (passed) OR the
 *    store CUSTOMER token (storeApi.getCustomerToken); joins `order:{id}`.
 *
 * Each gateway AUTO-JOINS the right room at handshake (admins → `store-admin` /
 * `store-admin-orders`; customers → `customer:{id}`; guests → `order:{id}`), so
 * the admin hooks need no explicit join. `useStoreOrderTracking` additionally
 * emits `joinRoom { room: 'order:{id}' }` so a logged-in customer watching one
 * order is subscribed to that specific order's room (the gateway validates
 * ownership server-side before joining).
 *
 * Every hook tears its socket down on unmount / dependency change.
 *
 * Reactivity: the admin hooks read the platform token and re-run their effect on
 * `isAuthenticated` / `loading` from `useAuth()`, so a component that mounts
 * BEFORE platform auth hydration finishes will (re)connect once the token lands —
 * it does not silently no-op for its whole lifetime.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { storeApi } from '@/lib/storeApi';

// ── Payload shapes (mirror backend realtime.constants.ts) ───────────────────

/** Broadcast on `/store/stock` after a committed stock CAS (`stock.updated`). */
export interface StockUpdatedPayload {
  skuId: string;
  warehouseId: string;
  onHand: number;
  reserved: number;
  /** Pre-computed `onHand - reserved`. */
  available: number;
  /** Post-CAS optimistic-lock counter — drop stale out-of-order frames with it. */
  version: number;
}

/**
 * Broadcast on `/store/orders` after a committed order mutation
 * (`order.updated`). `customerId` is relayed by the gateway ONLY for routing —
 * per the backend contract (DPDP Act 2023) it must never reach the browser
 * console or a consumer. The hooks below STRIP it before invoking `onUpdate`, so
 * the PII is structurally unavailable to callers rather than guarded by
 * convention. The public payload handed to consumers therefore omits it.
 */
export interface OrderUpdatedPayload {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
}

/** Internal wire shape — what the gateway actually emits (carries `customerId`). */
interface OrderUpdatedWire extends OrderUpdatedPayload {
  customerId?: string | null;
}

// ── Canonical event names (match realtime.constants.ts) ─────────────────────

const STOCK_UPDATED_EVENT = 'stock.updated';
const ORDER_UPDATED_EVENT = 'order.updated';

const IS_DEV = process.env.NODE_ENV !== 'production';

// Roles permitted to open the store admin feeds. The gateway is the real
// authority (server-side guard); this client check is defence-in-depth so a
// non-admin platform token (e.g. an applicant who also shops the store) never
// even opens the admin socket.
const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

/**
 * Strip `customerId` from a raw order frame, yielding the PII-free payload that
 * is safe to hand to consumers.
 */
function sanitizeOrder(wire: OrderUpdatedWire): OrderUpdatedPayload {
  return {
    orderId: wire.orderId,
    orderNumber: wire.orderNumber,
    status: wire.status,
    paymentStatus: wire.paymentStatus,
  };
}

/**
 * Best-effort, UNVERIFIED client-side decode of a JWT's `role` claim. This does
 * NOT validate the signature — it is only used to avoid opening an admin socket
 * with a token that plainly is not an admin token. The gateway performs the
 * authoritative verification. Returns null if the token is malformed.
 */
function readRoleClaim(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    // base64url → base64
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? atob(b64) : '';
    if (!json) return null;
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** True if the platform token carries an admin-tier role claim. */
function isAdminToken(token: string): boolean {
  const role = readRoleClaim(token);
  return role !== null && ADMIN_ROLES.has(role);
}

/**
 * Resolve the websocket host: `NEXT_PUBLIC_API_URL` with a trailing `/api`
 * removed so we connect to the server root, then append the namespace. Matches
 * ChatWidget's `.replace(/\/api\/?$/, '')`.
 */
function namespaceUrl(namespace: string): string {
  const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(
    /\/api\/?$/,
    '',
  );
  return `${base}${namespace}`;
}

/**
 * Shared connect helper. Builds a socket for `namespace` with the given auth
 * payload and returns it so the caller's effect can register listeners and clean
 * up. `auth` is read once at connect time (a token refresh will only take effect
 * on the next connect, which is acceptable for these short-lived dashboard
 * feeds). A `connect_error` handler is attached here so a rejected handshake
 * (expired/invalid token) is at least surfaced in development rather than
 * failing silently.
 */
function connect(namespace: string, auth: Record<string, string>): Socket {
  const socket = io(namespaceUrl(namespace), {
    auth,
    transports: ['websocket'],
  });
  socket.on('connect_error', (err: Error) => {
    if (IS_DEV) {
      console.warn(`[storeSockets] ${namespace} connect_error:`, err.message);
    }
  });
  return socket;
}

/**
 * Internal: a single live admin feed. Connects to `namespace` with the PLATFORM
 * admin token and invokes `onUpdate` for every `eventName` frame. Extracted so
 * the stock and orders admin hooks share one implementation — any future change
 * (backoff, a `connected` state, etc.) lands in exactly one place.
 *
 * Reactivity: the effect depends on the auth hydration signal so it (re)connects
 * once the platform token is available, instead of permanently no-opping when a
 * component mounts before `AuthProvider` has finished hydrating.
 *
 * `transform` adapts the raw wire frame to the shape passed to `onUpdate`
 * (used by the orders feed to strip `customerId`).
 */
function useAdminSocketFeed<TWire, TOut>(
  namespace: string,
  eventName: string,
  transform: (wire: TWire) => TOut,
  onUpdate: (payload: TOut) => void,
): void {
  // Keep the latest handler/transform in refs so the socket effect can stay
  // mounted across re-renders without reconnecting. Sync in useLayoutEffect: it
  // commits synchronously after render (before paint and before the next event
  // loop tick), so a socket frame — always delivered asynchronously via the event
  // loop, never mid-commit — sees the current callback, closing the stale-closure
  // window without mutating refs during render (forbidden by react-hooks/refs).
  const handlerRef = useRef(onUpdate);
  const transformRef = useRef(transform);
  useLayoutEffect(() => {
    handlerRef.current = onUpdate;
    transformRef.current = transform;
  });

  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    // Wait for platform auth to settle before deciding there is no token.
    if (loading) return;

    const token = api.getToken();
    if (!token) return;
    // Defence-in-depth: never open an admin feed with a non-admin token.
    if (!isAdminToken(token)) {
      if (IS_DEV) {
        console.warn(`[storeSockets] ${namespace}: token lacks admin role, not connecting.`);
      }
      return;
    }

    const socket = connect(namespace, { token });
    // Named listener so cleanup removes exactly THIS handler, not every listener
    // for the event.
    const listener = (wire: TWire) => {
      handlerRef.current(transformRef.current(wire));
    };
    socket.on(eventName, listener);

    return () => {
      socket.off(eventName, listener);
      socket.disconnect();
    };
    // Re-run when auth hydration completes / auth flips so a token that arrives
    // after mount triggers a connect. `isAuthenticated` is the stable signal.
  }, [namespace, eventName, isAuthenticated, loading]);
}

/**
 * Admin live stock feed (`/store/stock`). Connects with the PLATFORM admin token
 * and invokes `onUpdate` on every `stock.updated` frame. The gateway auto-joins
 * `store-admin`, so no explicit join is needed.
 *
 * No-ops (no connection) until an admin platform token is present. IMPORTANT: if
 * the component mounts before platform auth hydration completes, this hook waits
 * for the token and connects once it lands (it does not permanently no-op).
 *
 * `onUpdate` may be an inline closure — it is captured in a ref so it never
 * forces a reconnect.
 */
export function useAdminStockSocket(
  onUpdate: (payload: StockUpdatedPayload) => void,
): void {
  useAdminSocketFeed<StockUpdatedPayload, StockUpdatedPayload>(
    '/store/stock',
    STOCK_UPDATED_EVENT,
    (wire) => wire,
    onUpdate,
  );
}

/**
 * Admin live orders feed (`/store/orders`). Connects with the PLATFORM admin
 * token; the gateway auto-joins `store-admin-orders`. Invokes `onUpdate` on every
 * `order.updated` frame, with `customerId` stripped (DPDP). No-ops until an admin
 * platform token is present (reconnects once it lands — see note above).
 */
export function useAdminOrdersSocket(
  onUpdate: (payload: OrderUpdatedPayload) => void,
): void {
  useAdminSocketFeed<OrderUpdatedWire, OrderUpdatedPayload>(
    '/store/orders',
    ORDER_UPDATED_EVENT,
    sanitizeOrder,
    onUpdate,
  );
}

/**
 * Track a single order's live status (`/store/orders`, `order:{orderId}`).
 *
 * Auth resolution per the store contract:
 *  - if `guestToken` is supplied, authenticate as a GUEST via
 *    `handshake.auth.orderToken` (raw token, NO 'Bearer ' prefix — the gateway
 *    both verifies and SHA-256-hashes it). The gateway auto-joins `order:{id}`.
 *  - otherwise authenticate as the logged-in CUSTOMER via `handshake.auth.token`
 *    and explicitly `emit('joinRoom', { room: 'order:{id}' })`; the gateway
 *    validates that the customer OWNS the order before joining.
 *
 * Invokes `onUpdate` on every `order.updated` frame for that order (with
 * `customerId` stripped). No-ops if there is neither a guest token nor a customer
 * token. Reconnects when `orderId` or `guestToken` changes; cleans up on unmount.
 *
 * Callers SHOULD set `guestToken` to `null` once the order reaches a terminal
 * state (DELIVERED / CANCELLED); the `[orderId, guestToken]` dependency will then
 * tear the socket down and stop holding the token open.
 */
export function useStoreOrderTracking(
  orderId: string | null | undefined,
  guestToken: string | null | undefined,
  onUpdate: (payload: OrderUpdatedPayload) => void,
): void {
  // Same stable-callback rationale as the admin feed above: sync in
  // useLayoutEffect (post-render, pre-paint) so socket frames see the current
  // callback without a render-phase ref mutation.
  const handlerRef = useRef(onUpdate);
  useLayoutEffect(() => {
    handlerRef.current = onUpdate;
  });

  useEffect(() => {
    if (!orderId) return;

    // Guest path takes precedence when a guest token is supplied; otherwise use
    // the customer token. Bail if neither identity is available.
    const customerToken = guestToken ? null : storeApi.getCustomerToken();
    if (!guestToken && !customerToken) return;

    const auth: Record<string, string> = guestToken
      ? { orderToken: guestToken }
      : { token: customerToken as string };

    const room = `order:${orderId}`;
    const socket = connect('/store/orders', auth);

    // Named handlers so cleanup removes exactly these listeners.
    const onConnect = () => {
      // Guests are auto-joined to their order room at handshake; a logged-in
      // customer must explicitly request the order room (the gateway authorizes
      // ownership before joining). Re-emitted on every (re)connect so a reconnect
      // re-subscribes.
      if (!guestToken) {
        socket.emit('joinRoom', { room });
      }
    };
    const onOrderUpdate = (wire: OrderUpdatedWire) => {
      // Defensive: only surface frames for the order we're tracking (the room
      // already scopes this, but a customer socket also receives its
      // `customer:{id}` feed which carries that customer's OTHER orders). Strip
      // `customerId` before handing the frame to the consumer.
      if (wire.orderId === orderId) {
        handlerRef.current(sanitizeOrder(wire));
      }
    };

    socket.on('connect', onConnect);
    socket.on(ORDER_UPDATED_EVENT, onOrderUpdate);

    return () => {
      socket.off(ORDER_UPDATED_EVENT, onOrderUpdate);
      socket.off('connect', onConnect);
      socket.disconnect();
    };
  }, [orderId, guestToken]);
}
