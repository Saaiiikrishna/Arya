import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request } from 'express';
import { Order } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CustomerJwtGuard } from '../../store-auth/guards';

interface InvoiceRequest extends Request {
  user?: { id?: string; sub?: string; role?: string };
  order?: Order;
  customerId?: string;
}

/**
 * Authorizes owner access to an order's invoice on
 * `GET /api/store/orders/:orderId/invoice`, accepting EITHER form of ownership
 * and NEVER a bare order id (IDOR fix, architecture 4.11 / Section 9):
 *
 *   1. A registered customer — proven by a valid CUSTOMER JWT (dedicated
 *      'jwt-customer' strategy via CustomerJwtGuard). The order must belong to
 *      that customer (`Order.customerId === req.user.id`), else 403.
 *   2. A guest — proven by possession of the raw signed order-access token in the
 *      `X-Order-Token` header. We SHA-256-hash it and match against
 *      `Order.guestAccessTokenHash`; the resolved order's id must equal the
 *      `:orderId` route param, else the token does not authorize this order.
 *
 * On success the resolved order is attached to `req.order` so the handler does
 * not re-query identity. Mirrors GuestCartGuard + GuestOrderGuard.
 *
 * Fallback semantics: a present-but-invalid Authorization header does NOT hard-
 * reject the request — if a valid `X-Order-Token` is also supplied, the guest
 * path still authorizes the download (a browser holding a stale customer JWT and
 * a fresh guest token can still fetch its invoice).
 */
@Injectable()
export class InvoiceAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerJwtGuard: CustomerJwtGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<InvoiceRequest>();
    const rawParam = req.params?.orderId;
    const orderId = Array.isArray(rawParam) ? rawParam[0] : rawParam;
    if (!orderId || typeof orderId !== 'string') {
      throw new NotFoundException('Order not found');
    }

    // ── Path 1: registered customer (CUSTOMER JWT). Attempted only when an
    // Authorization header is present so a pure-guest request is not rejected by
    // the customer strategy.
    //
    // If the header is present but the JWT is invalid/wrong-role, we DO NOT hard-
    // reject here: we fall through to the guest path so a caller holding a stale
    // customer JWT plus a valid X-Order-Token is still served. Only if BOTH paths
    // fail does the request get rejected (at the end of path 2).
    const authHeader = req.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.length > 0) {
      let jwtOk = false;
      try {
        jwtOk = await this.customerJwtGuard.canActivate(context);
      } catch {
        // Invalid/expired/wrong-role customer JWT — swallow and fall through to
        // the guest-token path rather than hard-rejecting.
        jwtOk = false;
      }

      if (jwtOk) {
        const customerId = req.user?.id ?? req.user?.sub;
        if (!customerId) {
          throw new UnauthorizedException('Customer authentication required');
        }
        const order = await this.prisma.order.findUnique({
          where: { id: orderId },
        });
        // 404 (not 403) when the order does not exist at all — do not leak
        // existence. When it exists but belongs to someone else → 403.
        if (!order) {
          throw new NotFoundException('Order not found');
        }
        if (order.customerId !== customerId) {
          throw new ForbiddenException('You do not have access to this order');
        }
        req.order = order;
        req.customerId = customerId;
        return true;
      }
      // jwtOk === false: deliberately fall through to path 2 below.
    }

    // ── Path 2: guest order-access token (X-Order-Token header).
    const rawHeader = req.headers?.['x-order-token'];
    const rawToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedException(
        'Provide a customer token (Authorization) or a guest order token (X-Order-Token)',
      );
    }

    const hash = createHash('sha256').update(rawToken).digest('hex');
    const order = await this.prisma.order.findUnique({
      where: { guestAccessTokenHash: hash },
    });
    if (!order) {
      throw new UnauthorizedException('Invalid order token');
    }
    // A guest cannot use order A's token to read order B's invoice.
    if (order.id !== orderId) {
      throw new UnauthorizedException('Order token does not match order');
    }
    req.order = order;
    return true;
  }
}
