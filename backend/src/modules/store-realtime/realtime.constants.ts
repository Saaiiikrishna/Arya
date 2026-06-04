import { ConfigService } from '@nestjs/config';

/**
 * Normalise an origin string for allow-list comparison: trim surrounding
 * whitespace, drop a single trailing slash, and lower-case the scheme + host.
 * Browsers send the Origin header WITHOUT a trailing path/slash, but a
 * mis-configured `FRONTEND_URL` (or a non-browser client) may carry one
 * (`https://aryavartham.com/`), which would otherwise fail an exact `includes`
 * match. Normalising BOTH the allow-list (at construction) and the incoming
 * origin (at handshake) makes the comparison robust to these benign variations.
 */
export function normalizeOrigin(origin: string): string {
  let o = origin.trim();
  // Strip exactly one trailing slash (an Origin never has a path).
  if (o.endsWith('/')) o = o.slice(0, -1);
  // Origins are case-insensitive in scheme + host. Lower-casing the whole
  // string is safe here because an Origin has no path/query that could carry
  // case-significant data.
  return o.toLowerCase();
}

/**
 * Build the Socket.io CORS allow-list from configuration rather than hardcoding
 * it. `chat.gateway.ts` hardcodes its origin list — the store gateways must NOT
 * repeat that mistake, or they fail handshakes from the production frontend
 * origin (architecture Section 6). The production domain is sourced from
 * `FRONTEND_URL`; extra origins may be added via `ADDITIONAL_CORS_ORIGINS` (a
 * comma-separated list); localhost variants are kept for dev/preview. The result
 * is normalised (see `normalizeOrigin`) and deduped so a `FRONTEND_URL` that
 * equals one of the static entries (modulo a trailing slash / case) does not
 * appear twice.
 *
 * Mirrors the HTTP CORS list assembled in `main.ts` so WS and REST agree on the
 * same set of trusted origins. The production domains below are kept in lock-step
 * with `main.ts`'s static list ON PURPOSE: if either is ever made env-only, BOTH
 * must change together, or WS and REST CORS silently diverge.
 */
export function buildSocketCorsOrigins(config: ConfigService): string[] {
  const frontendUrl = config.get<string>(
    'FRONTEND_URL',
    'http://localhost:3000',
  );
  const additional = config.get<string>('ADDITIONAL_CORS_ORIGINS', '');
  const extra = additional
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const origins = [
    frontendUrl,
    ...extra,
    'http://localhost:3000',
    'http://localhost:3005',
    'https://aryavartham.com',
    'https://www.aryavartham.com',
  ].filter((o): o is string => typeof o === 'string' && o.length > 0);
  return Array.from(new Set(origins.map(normalizeOrigin)));
}

/**
 * Build the allow-list directly from `process.env` (NOT ConfigService). Used by
 * the `@WebSocketGateway` `cors.origin` callback, which is evaluated at class-
 * decoration time — before any DI container exists — so it cannot inject
 * ConfigService. `@nestjs/config` reads the same `process.env`, so this stays in
 * agreement with `buildSocketCorsOrigins` (which the gateway also applies per
 * connection as defense-in-depth). Kept private to this module.
 */
function buildCorsOriginsFromEnv(): string[] {
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  const additional = process.env.ADDITIONAL_CORS_ORIGINS ?? '';
  const extra = additional
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const origins = [
    frontendUrl,
    ...extra,
    'http://localhost:3000',
    'http://localhost:3005',
    'https://aryavartham.com',
    'https://www.aryavartham.com',
  ].filter((o) => typeof o === 'string' && o.length > 0);
  return Array.from(new Set(origins.map(normalizeOrigin)));
}

/**
 * Socket.io `cors.origin` callback for the store gateways. Passed into the
 * `@WebSocketGateway` decorator so Socket.io's OWN CORS middleware rejects a
 * disallowed Origin at the HTTP-upgrade step — before the WebSocket connection is
 * established — rather than relying solely on the post-upgrade per-connection
 * check (security review: a static `{ credentials: true }` never enforces an
 * origin allow-list). Non-browser clients send no Origin header and are allowed
 * through here (they remain gated by the JWT handshake), matching the standard
 * WebSocket CORS model. The allow-list is read from `process.env` because the
 * decorator runs before DI exists.
 */
export function socketCorsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin) {
    callback(null, true); // non-browser client; gated by JWT below
    return;
  }
  const allowed = buildCorsOriginsFromEnv();
  if (allowed.includes(normalizeOrigin(origin))) {
    callback(null, true);
  } else {
    callback(new Error('Origin not allowed'));
  }
}

/** Admin roles allowed onto the store realtime admin rooms. */
export const REALTIME_ADMIN_ROLES: ReadonlySet<string> = new Set([
  'ADMIN',
  'SUPER_ADMIN',
  'MODERATOR',
]);

/**
 * Room every authenticated admin joins on the `/store/stock` namespace.
 * MUST equal the literal the frontend `useAdminStockSocket()` hook joins
 * (architecture Section 6 / 11.5: `store-admin`). Do NOT rename without changing
 * the hook in lock-step — a mismatch silently delivers nothing.
 */
export const STOCK_ADMIN_ROOM = 'store-admin';

/**
 * Room every authenticated admin joins on the `/store/orders` namespace.
 * MUST equal the literal the frontend `useAdminOrdersSocket()` hook joins
 * (architecture Section 6 / 11.5: `store-admin-orders`).
 */
export const ORDERS_ADMIN_ROOM = 'store-admin-orders';

// ─────────────────────────────────────────────────────────────────────────
//  CANONICAL realtime event names (single source of truth — Section 6).
//
//  `InventoryService` / `OrdersService` re-export THESE constants (they import
//  from here) rather than declaring their own literals, so a producer and the
//  gateway @OnEvent consumer can never drift apart silently. The additional
//  events below are pre-declared so `store-jobs` (built in parallel) emits
//  against the SAME contract instead of inventing ad-hoc literals.
// ─────────────────────────────────────────────────────────────────────────

/** Realtime event the inventory service emits after a committed stock mutation. */
export const STOCK_UPDATED_EVENT = 'stock.updated';

/** Low-stock crossing (store-jobs / inventory low-stock hook). */
export const STOCK_LOW_EVENT = 'stock.low';

/** Reorder job auto-drafted a PO (store-jobs reorder-alerts). */
export const STOCK_REORDER_DRAFTED_EVENT = 'stock.reorderDrafted';

/** Realtime event the orders service emits after a committed order mutation. */
export const ORDER_UPDATED_EVENT = 'order.updated';

/** A new order was created (store-jobs / orders service). */
export const ORDER_CREATED_EVENT = 'order.created';

/** An order's status changed (store-jobs / orders service). */
export const ORDER_STATUS_CHANGED_EVENT = 'order.statusChanged';

/** An order was paid (store-jobs / webhook capture). */
export const ORDER_PAID_EVENT = 'order.paid';

/** An order was (partially) refunded (store-jobs / refund flow). */
export const ORDER_REFUNDED_EVENT = 'order.refunded';

/** A shipment advanced (store-jobs courier-sync). */
export const SHIPMENT_UPDATED_EVENT = 'shipment.updated';

/**
 * Payload broadcast on the `/store/stock` namespace after a committed StockLevel
 * CAS. `available = onHand - reserved` is pre-computed so admin dashboards never
 * have to derive it client-side. `version` is the post-CAS optimistic-lock
 * counter so a dashboard can drop stale out-of-order frames (Section 6 names
 * `version` in the `stock.updated` contract).
 *
 * NOTE: the AUTHORITATIVE shape of this payload is `StockUpdatedEvent` in
 * `inventory.service.ts`, which imports this name from here and re-exports it.
 * This interface is the structural contract the gateway relays; keep it in sync
 * with the producer (the producer's `satisfies` check enforces compatibility).
 */
export interface StockUpdatedPayload {
  skuId: string;
  warehouseId: string;
  onHand: number;
  reserved: number;
  available: number;
  version: number;
}

/**
 * Payload broadcast on the `/store/orders` namespace after a committed order
 * mutation (checkout / capture / status transition). `customerId` is included so
 * the gateway can additionally target the owning customer's room; it is never
 * trusted from the client.
 *
 * SECURITY (DPDP Act 2023): `customerId` is a UUID tied to a real person and is
 * relayed ONLY for room routing. Frontend consumers MUST use it for routing
 * logic only and never log it to the browser console.
 *
 * NOTE: the authoritative shape is `OrderUpdatedEvent` in `orders.service.ts`,
 * which imports this name from here and re-exports it. Keep the two in sync; the
 * producer's `satisfies` check enforces structural compatibility.
 */
export interface OrderUpdatedPayload {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  customerId: string | null;
}
