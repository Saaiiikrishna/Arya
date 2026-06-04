import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { CartStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Guards guest cart access. Reads the raw signed token from the `X-Cart-Token`
 * header, SHA-256-hashes it, and matches it against `Cart.sessionTokenHash`.
 *
 * IDOR fix: knowing the Cart.id UUID (it leaks via URLs/receipts) is NOT
 * sufficient to read/mutate a cart — possession of the unguessable raw token
 * is required. The raw token is never stored server-side; only its hash is.
 *
 * On success the resolved cart is attached to `req.cart` so the handler does
 * not re-query it. Cart ownership by a logged-in customer is handled by
 * CustomerJwtGuard on the relevant routes; this guard covers the guest path.
 */
@Injectable()
export class GuestCartGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const rawHeader = req.headers['x-cart-token'];
    const rawToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedException('Missing cart token');
    }

    const hash = createHash('sha256').update(rawToken).digest('hex');
    const cart = await this.prisma.cart.findUnique({
      where: { sessionTokenHash: hash },
    });

    if (!cart) {
      throw new UnauthorizedException('Invalid cart token');
    }

    if (cart.expiresAt && cart.expiresAt < new Date()) {
      throw new UnauthorizedException('Cart expired');
    }

    if (cart.status !== CartStatus.ACTIVE) {
      throw new UnauthorizedException('Cart is no longer active');
    }

    // Post-conversion guard: once a guest cart is claimed by a registered
    // customer (convert-guest sets customerId), the guest session token must no
    // longer authorize it — such carts are accessible only via CustomerJwtGuard.
    // This closes the window where a guest who keeps their X-Cart-Token could
    // keep mutating a now customer-owned cart, bypassing the ownership model.
    if (cart.customerId) {
      throw new UnauthorizedException(
        'Cart is no longer accessible by guest token',
      );
    }

    // If a :id route param is present, it must match the token's cart — a guest
    // cannot pass cart A's token to operate on cart B.
    const paramId = req.params?.id;
    if (paramId && paramId !== cart.id) {
      throw new UnauthorizedException('Cart token does not match cart');
    }

    req.cart = cart;
    return true;
  }
}
