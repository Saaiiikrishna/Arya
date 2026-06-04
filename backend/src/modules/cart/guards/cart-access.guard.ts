import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Cart, CartStatus } from '@prisma/client';
import { createHash } from 'crypto';
import type { Request } from 'express';
import { PrismaService } from '@/prisma/prisma.service';
import { CustomerJwtGuard } from '../../store-auth/guards';

/**
 * The Express request shape this guard reads from and augments. `user` is pinned
 * by CustomerJwtGuard's strategy on the customer path; `cart`/`customerId` are
 * set by this guard for the handler/service to consume without re-querying.
 */
interface CartRequest extends Request {
  user?: { id?: string; email?: string | null; role?: string };
  cart?: Cart;
  customerId?: string;
}

/**
 * Resolves and authorizes the CURRENT cart for a store-cart route, accepting
 * EITHER form of ownership and never a bare Cart.id (IDOR fix, architecture
 * Section 9 / 4.5):
 *
 *   1. A registered customer — proven by a valid CUSTOMER JWT (the dedicated
 *      'jwt-customer' strategy via CustomerJwtGuard). Their ACTIVE cart is
 *      resolved by customerId.
 *   2. A guest — proven by possession of the raw signed token in the
 *      `X-Cart-Token` header. We SHA-256-hash it (same scheme as the platform
 *      auth + GuestCartGuard) and match it against Cart.sessionTokenHash. A
 *      guest cart that has since been claimed by a customer (non-null
 *      customerId) is NOT accessible by the guest token.
 *
 * Exactly ONE identity is required. If a customer JWT is present it takes
 * precedence and the cart is bound to that customer; otherwise the guest token
 * path runs. On success the resolved cart is attached to `req.cart` and the
 * resolved customerId (if any) to `req.customerId` so the handler/service does
 * not re-query identity.
 *
 * The cart must be ACTIVE and unexpired to be mutated — CONVERTED / ABANDONED /
 * EXPIRED carts are refused here (defense-in-depth; the service re-asserts too).
 */
@Injectable()
export class CartAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerJwtGuard: CustomerJwtGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CartRequest>();

    // ── Path 1: registered customer (CUSTOMER JWT). Only attempted when an
    // Authorization header is present, so a pure-guest request never pays the
    // cost of (or is rejected by) the customer strategy.
    const authHeader = req.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.length > 0) {
      // CustomerJwtGuard validates the 'jwt-customer' token and pins req.user.
      // It throws 401/403 on an invalid/wrong-role token — which is the correct
      // outcome when a caller explicitly presented an Authorization header.
      const ok = await this.customerJwtGuard.canActivate(context);
      if (!ok) {
        throw new UnauthorizedException('Customer authentication required');
      }
      const customerId: string | undefined = req.user?.id;
      if (!customerId) {
        throw new UnauthorizedException('Customer authentication required');
      }

      const cart = await this.prisma.cart.findFirst({
        where: { customerId, status: CartStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
      });
      if (!cart) {
        // No active cart for this customer yet. GET/items routes that require an
        // existing cart surface this as a 404 in the service; the guard simply
        // signals "no cart" by leaving req.cart unset. We still return true so
        // the handler can produce a clean, route-specific response.
        req.customerId = customerId;
        return true;
      }
      this.assertMutable(cart);
      req.cart = cart;
      req.customerId = customerId;
      return true;
    }

    // ── Path 2: guest cart token (X-Cart-Token header).
    const rawHeader = req.headers?.['x-cart-token'];
    const rawToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedException(
        'Provide a customer token (Authorization) or a guest cart token (X-Cart-Token)',
      );
    }

    const hash = createHash('sha256').update(rawToken).digest('hex');
    const cart = await this.prisma.cart.findUnique({
      where: { sessionTokenHash: hash },
    });
    if (!cart) {
      throw new UnauthorizedException('Invalid cart token');
    }
    // Once claimed by a registered customer, the guest token no longer authorizes
    // the cart — it is reachable only via the customer JWT path (prevents a kept
    // guest token from mutating a now customer-owned cart).
    if (cart.customerId) {
      throw new UnauthorizedException(
        'Cart is no longer accessible by guest token',
      );
    }
    this.assertMutable(cart);
    req.cart = cart;
    return true;
  }

  /** Reject carts that are expired or not ACTIVE (no mutating CONVERTED/EXPIRED). */
  private assertMutable(cart: {
    status: CartStatus;
    expiresAt: Date | null;
  }): void {
    if (cart.expiresAt && cart.expiresAt < new Date()) {
      throw new UnauthorizedException('Cart expired');
    }
    if (cart.status !== CartStatus.ACTIVE) {
      throw new UnauthorizedException('Cart is no longer active');
    }
  }
}
