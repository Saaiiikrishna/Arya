import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { createHash } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { CustomerJwtGuard } from '@/modules/store-auth/guards';
import { OrdersService, CheckoutActor } from './orders.service';
import { CheckoutDto, OrderQueryDto } from './dto';

/** The minimal verified CUSTOMER JWT payload this controller relies on. */
interface CustomerJwtPayload {
  sub?: string;
  role?: string;
  email?: string | null;
}

/**
 * Store-facing orders surface (architecture 4.6):
 *  - POST /api/store/checkout            (guest X-Cart-Token OR CUSTOMER JWT)
 *  - POST /api/store/webhooks/razorpay   (public; raw-body HMAC, ownership-filtered)
 *  - GET  /api/store/orders              (CUSTOMER JWT — own orders)
 *  - GET  /api/store/orders/:id          (CUSTOMER JWT owner OR guest X-Order-Token)
 *
 * Follows the repo-wide `@Controller('api')` convention; the sub-path is qualified
 * per-route. Identity is ALWAYS pinned from the verified JWT / guest token, never
 * the request body.
 *
 * checkout + get-order/:id are genuinely DUAL-AUTH (customer OR guest), which a
 * single Passport guard cannot express, so they verify the presented credential
 * inline: a CUSTOMER bearer is verified with the same JWT_SECRET + role assertion
 * the 'jwt-customer' strategy uses, and the guest token is hashed + matched
 * against the stored hash (identical scheme to GuestCart/GuestOrder guards).
 */
@Controller('api')
@UseGuards(ThrottlerGuard)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create an order + reserve stock + mint a Razorpay order. Authorized by EITHER
   * a CUSTOMER JWT (Authorization header) OR a guest cart token (X-Cart-Token).
   * The cart is resolved server-side from that identity — never a body cartId.
   */
  @Post('store/checkout')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 6, ttl: 60000 } })
  async checkout(@Req() req: Request, @Body() dto: CheckoutDto) {
    const actor = await this.resolveCheckoutActor(req);
    return this.orders.checkout(actor, dto);
  }

  /**
   * Razorpay STORE webhook. NO guard — verified by raw-body HMAC inside the
   * service with RAZORPAY_STORE_WEBHOOK_SECRET. Ownership-filtered: a pledge event
   * landing here is acked-and-ignored. Returns 200 {received:true} on a valid
   * signature so Razorpay stops retrying.
   */
  @Post('store/webhooks/razorpay')
  @HttpCode(HttpStatus.OK)
  async razorpayWebhook(
    @Headers('x-razorpay-signature') signature: string,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    // HMAC MUST be computed over the EXACT bytes Razorpay signed. main.ts enables
    // `rawBody: true`, so req.rawBody is the original wire payload. There is NO
    // re-serialization fallback: JSON.stringify(parsedBody) would produce a
    // DIFFERENT byte sequence (key order / whitespace / unicode), so every HMAC
    // would fail and payment.captured events would be silently dropped, leaving
    // orders stuck PENDING_PAYMENT with stock held. We fail LOUD instead so a
    // raw-body misconfiguration surfaces immediately in testing.
    if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
      throw new BadRequestException(
        'Raw request body unavailable; cannot verify webhook signature',
      );
    }
    return this.orders.handleWebhook(signature, req.rawBody);
  }

  /** A registered customer's own orders (paginated). */
  @UseGuards(CustomerJwtGuard)
  @Get('store/orders')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  listMyOrders(@Req() req: Request, @Query() query: OrderQueryDto) {
    const customerId = (req as Request & { user?: { id?: string } }).user?.id;
    if (!customerId) {
      throw new UnauthorizedException('Customer authentication required');
    }
    return this.orders.listCustomerOrders(customerId, query);
  }

  /**
   * Single order detail incl. tracking + invoice link. Authorized by EITHER the
   * owning customer (CUSTOMER JWT) OR a guest order-access token (X-Order-Token).
   * Ownership is re-asserted in the service. The STRICT tier is used here (not the
   * 100/min medium tier) because this endpoint mints a presigned invoice-download
   * URL and is reachable by an unauthenticated guest holding only an order token;
   * the tighter limit bounds token-probing + presign abuse.
   */
  @Get('store/orders/:id')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  async getMyOrder(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const authHeader = req.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.length > 0) {
      const customer = await this.verifyCustomerToken(authHeader);
      return this.orders.getOrderForViewer(id, { customerId: customer.id });
    }

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
      select: { id: true },
    });
    if (!order || order.id !== id) {
      throw new UnauthorizedException('Invalid order token');
    }
    return this.orders.getOrderForViewer(id, { guestOrderId: order.id });
  }

  // ── internal ────────────────────────────────────────────────

  /**
   * Resolve the checkout actor from EITHER a CUSTOMER JWT (Authorization) or a
   * guest cart token (X-Cart-Token). Exactly one path; identity pinned from the
   * verified credential, never the body. The guest cart is resolved + asserted
   * ACTIVE here (mirrors CartAccessGuard's guest path).
   */
  private async resolveCheckoutActor(req: Request): Promise<CheckoutActor> {
    const authHeader = req.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.length > 0) {
      const customer = await this.verifyCustomerToken(authHeader);
      return {
        customerId: customer.id,
        email: customer.email ?? null,
        phone: customer.phone ?? null,
        isGuest: false,
      };
    }

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
      select: { id: true, status: true, expiresAt: true, customerId: true },
    });
    if (!cart) {
      throw new UnauthorizedException('Invalid cart token');
    }
    if (cart.customerId) {
      throw new UnauthorizedException(
        'Cart is no longer accessible by guest token',
      );
    }
    if (cart.expiresAt && cart.expiresAt < new Date()) {
      throw new UnauthorizedException('Cart expired');
    }
    if (cart.status !== 'ACTIVE') {
      throw new UnauthorizedException('Cart is no longer active');
    }
    return { guestCartId: cart.id, isGuest: true };
  }

  /**
   * Verify a CUSTOMER bearer token (same JWT_SECRET + role assertion as the
   * dedicated 'jwt-customer' strategy) and resolve the active REGISTERED customer.
   * Used by the dual-auth checkout + order-view routes where a single Passport
   * guard cannot express "customer OR guest".
   *
   * KNOWN PERFORMANCE DEBT: this performs a Customer DB lookup on every dual-auth
   * request because `isActive` + the buyer `phone` (needed for coupon anti-farming
   * on checkout) are NOT carried in the JWT payload. The single-auth route
   * GET /api/store/orders uses CustomerJwtGuard and avoids this. If this dual-auth
   * pattern spreads, extract a CheckoutAuthService and/or carry isActive+phone in
   * the CUSTOMER JWT (store-auth) to drop the round-trip; until then the extra
   * lookup is an accepted correctness-over-latency tradeoff.
   */
  private async verifyCustomerToken(authHeader: string): Promise<{
    id: string;
    email: string | null;
    phone: string | null;
  }> {
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Customer authentication required');
    }

    let payload: CustomerJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<CustomerJwtPayload>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Customer authentication required');
    }
    if (!payload || payload.role !== 'CUSTOMER' || !payload.sub) {
      throw new UnauthorizedException('Customer access required');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        phone: true,
        isActive: true,
        type: true,
      },
    });
    if (!customer || !customer.isActive || customer.type !== 'REGISTERED') {
      throw new UnauthorizedException('Customer not found or inactive');
    }
    return { id: customer.id, email: customer.email, phone: customer.phone };
  }
}
