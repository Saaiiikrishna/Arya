import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '@/prisma/prisma.service';
import { GuestTokenService } from '@/modules/store-auth/guest-token.service';
import { resolveCustomerSecret } from '@/modules/store-auth/customer.strategy';
import {
  buildSocketCorsOrigins,
  normalizeOrigin,
  ORDER_UPDATED_EVENT,
  ORDERS_ADMIN_ROOM,
  REALTIME_ADMIN_ROLES,
  socketCorsOrigin,
} from './realtime.constants';
import type {
  OrderUpdatedPayload,
  OrderUpdatedPublicPayload,
} from './realtime.constants';

/** What a guest order-access token carries (mirrors GuestTokenService.mintOrderToken). */
interface GuestOrderTokenClaims {
  typ?: string;
  orderId?: string;
}

/** The subset of a verified admin/customer JWT this gateway reads. */
interface OrdersJwtPayload {
  sub?: string;
  role?: string;
}

interface OrdersSocketData {
  /** 'admin' | 'customer' | 'guest' */
  kind: 'admin' | 'customer' | 'guest';
  /** Admin/customer subject id (JWT sub); absent for guests. */
  userId?: string;
  /** Customer.id for a customer socket — used to authorize `order:{id}` joins. */
  customerId?: string;
  /** The single order id a guest socket is scoped to (the only room it may join). */
  orderId?: string;
}

interface OrdersSocket extends Socket {
  data: OrdersSocketData;
}

/** Inbound `joinRoom` message body (client→server, Section 6). */
interface JoinRoomBody {
  room?: string;
}

/**
 * Realtime order feed (architecture Section 6, `/store/orders`). Serves the three
 * caller classes the spec defines:
 *
 *  - ADMIN (`ADMIN`/`SUPER_ADMIN`/`MODERATOR` via the platform JWT) → joins
 *    `store-admin-orders` and sees every order update.
 *  - CUSTOMER (`jwt-customer` token, `role === 'CUSTOMER'`, `sub = Customer.id`)
 *    → joins `customer:{customerId}` and receives updates for their own orders;
 *    may additionally `joinRoom` an `order:{id}` they OWN.
 *  - GUEST (signed guest order-access token in `handshake.auth.orderToken`)
 *    → the token is verified (`JWT_SECRET`) AND its hash is matched against
 *    `Order.guestAccessTokenHash`, so the socket joins ONLY `order:{orderId}`
 *    for the single order the token grants. Knowing an order id is never enough.
 *
 * Beyond the handshake auto-join, the spec defines a `client→server joinRoom
 * {room}` message for dynamic subscription; `handleJoinRoom` validates membership
 * (admin role for admin rooms; ownership for `order:{id}`) before `client.join`.
 *
 * CORS is enforced at the decorator (`socketCorsOrigin`, rejecting disallowed
 * origins at the HTTP-upgrade step) AND re-checked per connection. Origins come
 * from `ConfigService` (`FRONTEND_URL` + `ADDITIONAL_CORS_ORIGINS` + localhost/
 * prod), not hardcoded. Fan-out is driven by `OrdersService` emitting
 * `order.updated` after checkout / webhook capture / status-transition commits;
 * this gateway relays to the admin room and to the owning customer/order rooms.
 * The gateway never touches the business path and never writes to the DB on emit.
 */
/**
 * Per-IP connection rate-limit window. Unauthenticated handshakes run
 * `jwtService.verify` and (for guests/customers) an indexed DB read, so an
 * un-throttled connect storm from one peer is a CPU/DB DoS vector. We cap NEW
 * connections per source IP to {@link CONN_LIMIT_MAX} per
 * {@link CONN_LIMIT_WINDOW_MS} and refuse the rest BEFORE any verify/DB work.
 */
const CONN_LIMIT_WINDOW_MS = 10_000;
const CONN_LIMIT_MAX = 30;
/** Max upgrade-request payload (bytes) — caps oversized handshake frames. */
const MAX_HTTP_BUFFER_SIZE = 1e6;
/** Drop a half-open handshake that never completes within this window (ms). */
const CONNECT_TIMEOUT_MS = 10_000;

@WebSocketGateway({
  namespace: '/store/orders',
  cors: { credentials: true, origin: socketCorsOrigin },
  connectTimeout: CONNECT_TIMEOUT_MS,
  maxHttpBufferSize: MAX_HTTP_BUFFER_SIZE,
})
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(OrdersGateway.name);
  private readonly corsOrigins: string[];
  /**
   * In-memory per-IP connection counters for the rate limiter. Keyed by source
   * IP → { count, resetAt }. Stale windows are pruned lazily on access, so the
   * map never grows unbounded for IPs that stop connecting.
   */
  private readonly connRates = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly guestTokens: GuestTokenService,
    private readonly prisma: PrismaService,
  ) {
    this.corsOrigins = buildSocketCorsOrigins(this.configService);
  }

  /**
   * Lightweight in-memory per-IP connection rate limiter. Returns `true` when
   * the connection is WITHIN budget (and records it), `false` when the IP has
   * exceeded {@link CONN_LIMIT_MAX} connects in the current
   * {@link CONN_LIMIT_WINDOW_MS} window. Called at the TOP of `handleConnection`,
   * before any `jwtService.verify` or DB lookup, so a connect storm is shed
   * cheaply.
   */
  private allowConnection(ip: string): boolean {
    const now = Date.now();
    const entry = this.connRates.get(ip);
    if (!entry || now >= entry.resetAt) {
      this.connRates.set(ip, { count: 1, resetAt: now + CONN_LIMIT_WINDOW_MS });
      return true;
    }
    if (entry.count >= CONN_LIMIT_MAX) {
      return false;
    }
    entry.count += 1;
    return true;
  }

  /** Resolve the source IP of a handshake for rate-limit keying. */
  private clientIp(client: Socket): string {
    return client.handshake.address || 'unknown';
  }

  async handleConnection(client: OrdersSocket): Promise<void> {
    try {
      // Connection-flood guard FIRST: shed an over-budget IP before any
      // signature verification or DB read, so an unauthenticated connect storm
      // cannot burn CPU/DB. Checked at the very top of the handshake.
      if (!this.allowConnection(this.clientIp(client))) {
        client.emit('error', { message: 'Too many connections' });
        client.disconnect(true);
        return;
      }

      // Defense-in-depth CORS (the decorator rejected disallowed origins at the
      // upgrade). Origins are normalised so a trailing slash / case difference
      // does not falsely reject.
      const origin = client.handshake.headers?.origin;
      if (origin && !this.corsOrigins.includes(normalizeOrigin(origin))) {
        client.disconnect(true);
        return;
      }

      // A guest authenticates with a dedicated order-access token; admins and
      // customers authenticate with a standard bearer JWT. Prefer the JWT path
      // when both are present (an admin/customer would not normally send an
      // orderToken).
      const token = this.extractToken(client);
      const orderToken = this.extractOrderToken(client);

      if (token) {
        const result = this.joinFromJwt(client, token);
        if (result === 'joined') return;
        // result === 'wrong-role': a valid token of a role we do not serve here
        // (e.g. APPLICANT/MENTOR). Fall through to the guest path only if a guest
        // order token was ALSO supplied; otherwise reject with a role-specific
        // message so it is distinguishable from a missing token.
        if (result === 'wrong-role' && !orderToken) {
          client.emit('error', {
            message: 'This account cannot access the order feed',
          });
          client.disconnect(true);
          return;
        }
      }

      if (orderToken) {
        const joined = await this.joinFromGuestToken(client, orderToken);
        if (joined) return;
      }

      client.emit('error', { message: 'Authentication required' });
      client.disconnect(true);
    } catch {
      client.emit('error', { message: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as Partial<OrdersSocketData> | undefined;
    const identity =
      data?.kind === 'guest'
        ? `orderId: ${data?.orderId ?? 'n/a'}`
        : `userId: ${data?.userId ?? 'n/a'}`;
    this.logger.log(
      `Orders client disconnected: ${client.id} (kind: ${data?.kind ?? 'unknown'}, ${identity})`,
    );
  }

  /**
   * Explicit dynamic room subscription (Section 6: `client→server joinRoom
   * {room}`). Membership is validated against the identity pinned on the socket at
   * handshake — NEVER trusted from the message body:
   *   - the admin room requires an admin socket;
   *   - an `order:{id}` room requires that the customer socket OWNS the order, or
   *     that the guest socket's token was scoped to exactly that order id;
   *   - `customer:{id}` is auto-joined at handshake and not joinable here.
   * Anything else is refused with an error ack and no join occurs.
   */
  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: OrdersSocket,
    @MessageBody() body: JoinRoomBody,
  ): Promise<{ ok: boolean; room?: string; error?: string }> {
    const room = typeof body?.room === 'string' ? body.room.trim() : '';
    if (!room) {
      return { ok: false, error: 'room is required' };
    }
    const data = client.data;

    // Admin room: admin sockets only.
    if (room === ORDERS_ADMIN_ROOM) {
      if (data?.kind !== 'admin') {
        return { ok: false, error: 'Admin access required' };
      }
      void client.join(room);
      return { ok: true, room };
    }

    // order:{id} room: customer must own the order; guest must be scoped to it.
    if (room.startsWith('order:')) {
      const orderId = room.slice('order:'.length);
      if (!orderId) {
        return { ok: false, error: 'Invalid room' };
      }
      const allowed = await this.canJoinOrderRoom(data, orderId);
      if (!allowed) {
        return { ok: false, error: 'Not authorized for this order' };
      }
      void client.join(room);
      return { ok: true, room };
    }

    // customer:{id} is auto-joined at handshake; do not allow joining an
    // arbitrary customer room here (would enable cross-customer subscription).
    return { ok: false, error: 'Room not joinable' };
  }

  /**
   * Authorize an `order:{orderId}` join for the socket's pinned identity.
   *  - guest: the token-scoped orderId must equal the requested order id (no DB hit).
   *  - customer: the order must belong to the socket's customerId (one indexed read).
   *  - admin: admins use the admin room, not per-order rooms (return false).
   */
  private async canJoinOrderRoom(
    data: OrdersSocketData | undefined,
    orderId: string,
  ): Promise<boolean> {
    if (!data) return false;
    if (data.kind === 'guest') {
      return !!data.orderId && data.orderId === orderId;
    }
    if (data.kind === 'customer' && data.customerId) {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { customerId: true },
      });
      return !!order && order.customerId === data.customerId;
    }
    return false;
  }

  /**
   * Relay a committed order mutation. Driven by `OrdersService` emitting
   * `order.updated` AFTER its transaction commits (checkout / capture /
   * transition). Routed to:
   *   - the `store-admin-orders` room (all admins) → FULL payload;
   *   - `customer:{customerId}` (the owning customer) → FULL payload;
   *   - `order:{orderId}` (the shared per-order room a GUEST may join) →
   *     guest-safe projection WITHOUT `customerId`.
   *
   * SECURITY (DPDP Act 2023): the `order:{orderId}` room is the only room a guest
   * order-access token can join, and a guest must never learn the owning
   * customer's UUID. So the full payload (which carries `customerId`) is emitted
   * ONLY to the admin and owning-customer rooms; the per-order room receives a
   * `customerId`-stripped projection. (A logged-in customer that also joined its
   * own `order:{id}` room still gets the full payload via `customer:{customerId}`.)
   *
   * Routing uses the values ON THE EMITTED PAYLOAD (server-pinned by the service
   * after commit), never client-supplied data. Best-effort: a missing server is a
   * silent no-op (never affects the business path).
   */
  @OnEvent(ORDER_UPDATED_EVENT)
  handleOrderUpdated(payload: OrderUpdatedPayload): void {
    if (!this.server) return;
    // Full payload (incl. customerId) → admins and the owning customer only.
    this.server.to(ORDERS_ADMIN_ROOM).emit(ORDER_UPDATED_EVENT, payload);
    if (payload.customerId) {
      this.server
        .to(`customer:${payload.customerId}`)
        .emit(ORDER_UPDATED_EVENT, payload);
    }
    // Guest-safe projection (NO customerId) → the shared per-order room.
    if (payload.orderId) {
      const publicPayload: OrderUpdatedPublicPayload = {
        orderId: payload.orderId,
        orderNumber: payload.orderNumber,
        status: payload.status,
        paymentStatus: payload.paymentStatus,
      };
      this.server
        .to(`order:${payload.orderId}`)
        .emit(ORDER_UPDATED_EVENT, publicPayload);
    }
  }

  /**
   * Admin or customer JWT path. Returns:
   *  - 'joined'     — authenticated and placed in the correct room;
   *  - 'wrong-role' — token verified but carried a role we do not serve here
   *                   (caller then tries the guest path / rejects with a clear msg);
   *  - 'invalid'    — token did not verify (caller may try the guest path).
   */
  private joinFromJwt(
    client: OrdersSocket,
    token: string,
  ): 'joined' | 'wrong-role' | 'invalid' {
    // The handshake token may be a PLATFORM token (admin, signed with JWT_SECRET)
    // or a CUSTOMER token (signed with the isolated JWT_CUSTOMER_SECRET). Try the
    // platform secret first, then the customer secret, so a distinct customer
    // secret never rejects a legitimate customer socket. Each token only verifies
    // under its own secret; the role claim below decides the room.
    let payload: OrdersJwtPayload;
    try {
      payload = this.jwtService.verify<OrdersJwtPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      try {
        payload = this.jwtService.verify<OrdersJwtPayload>(token, {
          secret: resolveCustomerSecret(this.configService),
        });
      } catch {
        return 'invalid'; // invalid/expired — maybe a guest token follows
      }
    }

    if (payload?.role && REALTIME_ADMIN_ROLES.has(payload.role)) {
      client.data = { kind: 'admin', userId: payload.sub };
      void client.join(ORDERS_ADMIN_ROOM);
      this.logger.log(
        `Orders admin connected: ${client.id} (userId: ${payload.sub})`,
      );
      return 'joined';
    }

    if (payload?.role === 'CUSTOMER' && payload.sub) {
      client.data = {
        kind: 'customer',
        userId: payload.sub,
        customerId: payload.sub,
      };
      void client.join(`customer:${payload.sub}`);
      this.logger.log(
        `Orders customer connected: ${client.id} (customerId: ${payload.sub})`,
      );
      return 'joined';
    }

    return 'wrong-role';
  }

  /**
   * Guest order-access path. The token is verified for signature + expiry, its
   * `orderId` claim is extracted, AND the raw token's SHA-256 hash is matched
   * against `Order.guestAccessTokenHash` — so possession of an order id alone can
   * never join the room (IDOR fix, consistent with GuestOrderGuard). On success
   * the socket joins ONLY `order:{orderId}`.
   */
  private async joinFromGuestToken(
    client: OrdersSocket,
    orderToken: string,
  ): Promise<boolean> {
    let claims: GuestOrderTokenClaims;
    try {
      claims = this.jwtService.verify<GuestOrderTokenClaims>(orderToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      return false;
    }
    if (claims?.typ !== 'guest-order' || !claims.orderId) {
      return false;
    }

    // Defense-in-depth: the signed token alone is not trusted to name an order.
    // Match its hash against the persisted Order.guestAccessTokenHash and confirm
    // the resolved order is the one the claim names.
    const hash = this.guestTokens.hashToken(orderToken);
    const order = await this.prisma.order.findUnique({
      where: { guestAccessTokenHash: hash },
      select: { id: true },
    });
    if (!order || order.id !== claims.orderId) {
      return false;
    }

    client.data = { kind: 'guest', orderId: order.id };
    void client.join(`order:${order.id}`);
    this.logger.log(
      `Orders guest connected: ${client.id} (orderId: ${order.id})`,
    );
    return true;
  }

  /** Read the standard bearer token from the handshake (auth field or header). */
  private extractToken(client: Socket): string | undefined {
    const fromAuth: unknown = client.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      // trim() guards a malformed 'Bearer  token' (double space).
      const stripped = header.slice('Bearer '.length).trim();
      return stripped.length > 0 ? stripped : undefined;
    }
    return undefined;
  }

  /**
   * Read the guest order-access token from the handshake auth payload. The client
   * MUST send the raw token verbatim in `auth.orderToken` (NO 'Bearer ' prefix):
   * the token is both jwtService.verify()'d AND SHA-256 hashed for the
   * Order.guestAccessTokenHash lookup, so any prefix would break the hash match.
   */
  private extractOrderToken(client: Socket): string | undefined {
    const fromAuth: unknown = client.handshake.auth?.orderToken;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
    return undefined;
  }
}
