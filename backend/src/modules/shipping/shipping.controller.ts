import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { resolveCustomerSecret } from '@/modules/store-auth/customer.strategy';
import { ShippingService } from './shipping.service';

/** The minimal verified CUSTOMER JWT payload this controller relies on. */
interface CustomerJwtPayload {
  sub?: string;
  role?: string;
}

/**
 * Store-facing fulfillment surface (architecture 4.9):
 *  - POST /api/store/webhooks/courier         (public; raw-body HMAC if configured)
 *  - POST /api/store/webhooks/courier/:courier (provider-named variant)
 *  - GET  /api/store/orders/:id/tracking      (CUSTOMER JWT owner OR guest X-Order-Token)
 *
 * Follows the repo-wide `@Controller('api')` convention. The tracking route is
 * genuinely DUAL-AUTH (customer OR guest), which a single Passport guard cannot
 * express, so it verifies the presented credential inline (identical scheme to
 * OrdersController.getMyOrder): a CUSTOMER bearer is verified with JWT_SECRET +
 * role assertion; a guest token is SHA-256-hashed + matched against the stored
 * Order.guestAccessTokenHash.
 */
@Controller('api')
@UseGuards(ThrottlerGuard)
export class ShippingController {
  constructor(
    private readonly shipping: ShippingService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Courier tracking webhook. NO guard — verified by raw-body HMAC inside the
   * service with COURIER_WEBHOOK_SECRET when configured (else accept-from-source,
   * logged). Idempotent ingest; unknown AWBs are acked-and-ignored. Returns 200
   * {received:true} so the courier stops retrying.
   */
  @Post('store/webhooks/courier')
  @HttpCode(HttpStatus.OK)
  // Tight per-IP rate limit (defense-in-depth): even with HMAC enforced this
  // bounds forged-payload / token-probing floods. Document IP allowlisting for the
  // known courier CIDR ranges at the Azure Front Door / reverse-proxy layer too.
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  async courierWebhook(
    @Headers('x-courier-signature') signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    return this.handleCourierWebhook(undefined, signature, req);
  }

  /** Provider-named webhook variant (POST /api/store/webhooks/courier/:courier). */
  @Post('store/webhooks/courier/:courier')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  async courierWebhookNamed(
    @Param('courier') courier: string,
    @Headers('x-courier-signature') signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    return this.handleCourierWebhook(courier, signature, req);
  }

  private handleCourierWebhook(
    providerKey: string | undefined,
    signature: string | undefined,
    req: Request & { rawBody?: Buffer },
  ) {
    // HMAC MUST be over the EXACT bytes the courier signed. main.ts enables
    // rawBody:true. Fail LOUD if the raw body is missing so a misconfiguration
    // surfaces in testing rather than silently dropping every tracking update.
    if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
      throw new BadRequestException(
        'Raw request body unavailable; cannot verify courier webhook signature',
      );
    }
    return this.shipping.ingestWebhook({
      providerKey,
      signature,
      rawBody: req.rawBody,
    });
  }

  /**
   * Order tracking (shipment + event timeline). Authorized by EITHER the owning
   * customer (CUSTOMER JWT) OR a guest order-access token (X-Order-Token).
   * Ownership is re-asserted in the service. STRICT throttle tier: reachable by an
   * unauthenticated guest holding only an order token, so the tighter limit bounds
   * token-probing.
   */
  @Get('store/orders/:id/tracking')
  @Throttle({ short: { limit: 30, ttl: 60000 } })
  async tracking(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const authHeader = req.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.length > 0) {
      const customerId = await this.verifyCustomerToken(authHeader);
      return this.shipping.getTrackingForViewer(id, { customerId });
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
    return this.shipping.getTrackingForViewer(id, { guestOrderId: order.id });
  }

  /**
   * Verify a CUSTOMER bearer token (same JWT_SECRET + role assertion as the
   * dedicated 'jwt-customer' strategy) and resolve the active REGISTERED customer
   * id. Mirrors OrdersController.verifyCustomerToken for the dual-auth route.
   */
  private async verifyCustomerToken(authHeader: string): Promise<string> {
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Customer authentication required');
    }
    let payload: CustomerJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<CustomerJwtPayload>(token, {
        secret: resolveCustomerSecret(this.config),
      });
    } catch {
      throw new UnauthorizedException('Customer authentication required');
    }
    if (!payload || payload.role !== 'CUSTOMER' || !payload.sub) {
      throw new UnauthorizedException('Customer access required');
    }
    const customer = await this.prisma.customer.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true, type: true },
    });
    if (!customer || !customer.isActive || customer.type !== 'REGISTERED') {
      throw new UnauthorizedException('Customer not found or inactive');
    }
    return customer.id;
  }
}
