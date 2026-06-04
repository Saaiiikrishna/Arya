import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Guards guest order/tracking/invoice access. Reads the raw signed token from
 * the `X-Order-Token` header, SHA-256-hashes it, and matches it against
 * `Order.guestAccessTokenHash`.
 *
 * IDOR fix: knowing the order number / Order.id is NOT sufficient — possession
 * of the unguessable raw guest order-access token (handed back once at
 * checkout) is required. Only the hash is stored server-side.
 *
 * On success the resolved order is attached to `req.order`. Registered-customer
 * order access is handled by CustomerJwtGuard + ownership check on those routes.
 */
@Injectable()
export class GuestOrderGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const rawHeader = req.headers['x-order-token'];
    const rawToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedException('Missing order token');
    }

    const hash = createHash('sha256').update(rawToken).digest('hex');
    const order = await this.prisma.order.findUnique({
      where: { guestAccessTokenHash: hash },
    });

    if (!order) {
      throw new UnauthorizedException('Invalid order token');
    }

    // If an :orderNumber (or :id) route param is present it must match — a guest
    // cannot use order A's token to view order B.
    const paramOrderNumber = req.params?.orderNumber;
    if (paramOrderNumber && paramOrderNumber !== order.orderNumber) {
      throw new UnauthorizedException('Order token does not match order');
    }
    const paramId = req.params?.id;
    if (paramId && paramId !== order.id) {
      throw new UnauthorizedException('Order token does not match order');
    }

    req.order = order;
    return true;
  }
}
