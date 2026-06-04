import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { ReturnsService } from './returns.service';
import { CreateReturnDto } from './dto';

/**
 * Store-facing returns/RMA surface (architecture 4.10):
 *  - POST /api/store/orders/:orderNumber/returns  (CUSTOMER JWT owner OR guest X-Order-Token)
 *  - GET  /api/store/returns/:id                  (CUSTOMER JWT owner OR guest X-Order-Token)
 *
 * Genuinely DUAL-AUTH (customer OR guest), which a single Passport guard cannot
 * express. Per the CLAUDE.md module pattern, the verification (JWT verify + guest
 * X-Order-Token hash lookup) lives in the SERVICE (`resolveRequester`), so this
 * controller injects no PrismaService/JwtService — it only forwards the relevant
 * headers. A CUSTOMER bearer is verified with JWT_SECRET + role assertion (same as
 * the 'jwt-customer' strategy); the guest token is SHA-256 hashed + matched
 * against Order.guestAccessTokenHash (knowing the order id is never sufficient).
 * Ownership of the order the items belong to is re-asserted in the service.
 */
@Controller('api')
@UseGuards(ThrottlerGuard)
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  /**
   * Request a return for a specific order (order-scoped URL per spec). The items
   * (from the body) must belong to the order named in the path AND be owned by the
   * caller (customer JWT) or match the guest order token — all enforced in the
   * service. No body orderId/customerId is trusted.
   */
  @Post('store/orders/:orderNumber/returns')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 6, ttl: 60000 } })
  async create(
    @Req() req: Request,
    @Param('orderNumber') orderNumber: string,
    @Body() dto: CreateReturnDto,
  ) {
    const requester = await this.returns.resolveRequester(
      this.authHeaders(req),
    );
    return this.returns.requestReturn(requester, dto, orderNumber);
  }

  /**
   * View a single return (own). Authorized by the owning customer (CUSTOMER JWT)
   * OR the guest order-access token whose order matches the return's order.
   */
  @Get('store/returns/:id')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  async getOne(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const requester = await this.returns.resolveRequester(
      this.authHeaders(req),
    );
    return this.returns.getReturnForRequester(id, requester);
  }

  // ── internal ────────────────────────────────────────────────

  /** Extract the dual-auth headers the service needs to resolve identity. */
  private authHeaders(req: Request): {
    authorization?: string;
    orderToken?: string;
  } {
    const authorization =
      typeof req.headers?.authorization === 'string'
        ? req.headers.authorization
        : undefined;
    const rawHeader = req.headers?.['x-order-token'];
    const orderToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    return {
      authorization,
      orderToken: typeof orderToken === 'string' ? orderToken : undefined,
    };
  }
}
