import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import {
  buildSocketCorsOrigins,
  normalizeOrigin,
  REALTIME_ADMIN_ROLES,
  socketCorsOrigin,
  STOCK_ADMIN_ROOM,
  STOCK_UPDATED_EVENT,
} from './realtime.constants';
import type { StockUpdatedPayload } from './realtime.constants';

interface AdminSocketData {
  kind: 'admin';
  userId: string;
  role: string;
}

interface AdminSocket extends Socket {
  data: AdminSocketData;
}

/** The subset of the verified JWT this gateway reads. */
interface AdminJwtPayload {
  sub?: string;
  role?: string;
}

/**
 * Admin-only realtime stock feed (architecture Section 6, `/store/stock`).
 *
 * Handshake (modeled on `chat.gateway.ts`): the JWT is read from
 * `client.handshake.auth.token` (or an `Authorization: Bearer` header),
 * verified with `JWT_SECRET`, and the connection is REJECTED unless the role is
 * an admin role (`ADMIN`/`SUPER_ADMIN`/`MODERATOR`). Every accepted admin
 * auto-joins the `store-admin` room (the literal the frontend
 * `useAdminStockSocket()` hook joins — Section 11.5).
 *
 * CORS is enforced in TWO layers (security review):
 *  1. The decorator's `cors.origin` callback (`socketCorsOrigin`) lets Socket.io's
 *     own middleware reject a disallowed Origin at the HTTP-upgrade step, before
 *     the WS connection is established.
 *  2. The per-connection check in `handleConnection` re-applies the config-driven
 *     allow-list as defense-in-depth.
 * Both read from `FRONTEND_URL` (+ `ADDITIONAL_CORS_ORIGINS` + localhost/prod
 * variants), NOT a hardcoded list — `chat.gateway.ts` hardcodes its list and the
 * store gateways must not repeat that or they fail from the production origin.
 *
 * Fan-out is driven by `@OnEvent(STOCK_UPDATED_EVENT)`: `InventoryService` emits
 * `stock.updated` (via EventEmitter2) AFTER each stock-mutation transaction
 * commits; this gateway relays that payload to the `store-admin` room. The
 * gateway never reaches into the DB or the business path.
 */
@WebSocketGateway({
  namespace: '/store/stock',
  cors: { credentials: true, origin: socketCorsOrigin },
})
export class StockGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(StockGateway.name);
  private readonly corsOrigins: string[];

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    // Resolve the (normalised) allow-list once at construction for the
    // per-connection defense-in-depth check. The decorator's `cors.origin`
    // callback is the primary enforcement at the upgrade step.
    this.corsOrigins = buildSocketCorsOrigins(this.configService);
  }

  handleConnection(client: AdminSocket): void {
    try {
      // Defense-in-depth CORS allow-list at the handshake (the decorator's
      // cors.origin already rejected disallowed origins at the upgrade). A
      // connection whose Origin header is present but not allow-listed is
      // rejected; same-origin / non-browser clients (no Origin header) pass this
      // check and are still gated by the JWT below. Origins are normalised so a
      // trailing slash / case difference does not cause a false rejection.
      const origin = client.handshake.headers?.origin;
      if (origin && !this.corsOrigins.includes(normalizeOrigin(origin))) {
        client.disconnect(true);
        return;
      }

      const token = this.extractToken(client);
      if (!token) {
        client.emit('error', { message: 'Authentication required' });
        client.disconnect(true);
        return;
      }

      const payload = this.jwtService.verify<AdminJwtPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      // ADMIN/SUPER_ADMIN/MODERATOR only — anyone else is disconnected.
      if (!payload?.role || !REALTIME_ADMIN_ROLES.has(payload.role)) {
        client.emit('error', { message: 'Admin access required' });
        client.disconnect(true);
        return;
      }

      client.data = {
        kind: 'admin',
        userId: payload.sub ?? '',
        role: payload.role,
      };
      void client.join(STOCK_ADMIN_ROOM);
      this.logger.log(
        `Stock admin connected: ${client.id} (userId: ${payload.sub})`,
      );
    } catch {
      client.emit('error', { message: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    // Log the associated identity (set at connect) alongside the socket id so
    // connection churn is debuggable. handleDisconnect receives a plain Socket,
    // so read client.data defensively.
    const data = client.data as Partial<AdminSocketData> | undefined;
    this.logger.log(
      `Stock client disconnected: ${client.id} (kind: ${data?.kind ?? 'unknown'}, userId: ${data?.userId ?? 'n/a'})`,
    );
  }

  /**
   * Relay a committed stock mutation to all connected admins. Driven by
   * `InventoryService` emitting `stock.updated` after its transaction commits;
   * never inside the business transaction. Best-effort: a missing server (gateway
   * not yet bound, or an emit racing startup) is a silent no-op so an early event
   * can never null-dereference `this.server`.
   */
  @OnEvent(STOCK_UPDATED_EVENT)
  handleStockUpdated(payload: StockUpdatedPayload): void {
    if (!this.server) return;
    this.server.to(STOCK_ADMIN_ROOM).emit(STOCK_UPDATED_EVENT, payload);
  }

  /** Read the bearer token from the socket handshake (auth field or header). */
  private extractToken(client: Socket): string | undefined {
    const fromAuth: unknown = client.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      // trim() guards a malformed 'Bearer  token' (double space) that would
      // otherwise verify with a leading space → an obscure error rather than a
      // clean 'Authentication required'.
      const stripped = header.slice('Bearer '.length).trim();
      return stripped.length > 0 ? stripped : undefined;
    }
    return undefined;
  }
}
