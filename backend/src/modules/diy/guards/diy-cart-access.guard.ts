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
 * set here for the handler/service to consume without re-querying.
 */
interface DiyCartRequest extends Request {
  user?: { id?: string; email?: string | null; role?: string };
  cart?: Cart;
  customerId?: string;
}

/**
 * Resolves and authorizes the CURRENT cart for the DIY add-to-cart route,
 * accepting EITHER ownership form and never a bare Cart.id from the body (IDOR
 * fix — same model as the cart module's CartAccessGuard, re-implemented here so
 * the diy module depends only on StoreAuthModule's exported guards, not on the
 * cart module's internal guard):
 *
 *   1. Registered customer — proven by a valid CUSTOMER JWT (via CustomerJwtGuard,
 *      the 'jwt-customer' strategy). Their ACTIVE cart is resolved by customerId.
 *   2. Guest — proven by possession of the raw signed token in the `X-Cart-Token`
 *      header; we SHA-256-hash it and match Cart.sessionTokenHash. A guest cart
 *      already claimed by a customer (non-null customerId) is NOT guest-accessible.
 *
 * On success the resolved cart is attached to `req.cart` and the customerId (if
 * any) to `req.customerId`. The cart must be ACTIVE + unexpired. A customer with
 * NO active cart yet is rejected (the DIY add-to-cart path requires an existing
 * cart — the frontend creates one via POST /api/store/cart first).
 */
@Injectable()
export class DiyCartAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerJwtGuard: CustomerJwtGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DiyCartRequest>();

    // Path 1: registered customer (only attempted when an Authorization header is
    // present, so a pure-guest request never pays the customer-strategy cost).
    const authHeader = req.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.length > 0) {
      const ok = await this.customerJwtGuard.canActivate(context);
      if (!ok) {
        throw new UnauthorizedException('Customer authentication required');
      }
      const customerId = req.user?.id;
      if (!customerId) {
        throw new UnauthorizedException('Customer authentication required');
      }
      const cart = await this.prisma.cart.findFirst({
        where: { customerId, status: CartStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
      });
      if (!cart) {
        throw new UnauthorizedException(
          'No active cart — create a cart first (POST /api/store/cart)',
        );
      }
      this.assertMutable(cart);
      req.cart = cart;
      req.customerId = customerId;
      return true;
    }

    // Path 2: guest cart token (X-Cart-Token header).
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
    if (cart.customerId) {
      throw new UnauthorizedException(
        'Cart is no longer accessible by guest token',
      );
    }
    this.assertMutable(cart);
    req.cart = cart;
    return true;
  }

  /** Reject carts that are expired or not ACTIVE. */
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
