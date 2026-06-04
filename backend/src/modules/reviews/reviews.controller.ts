import {
  Body,
  Controller,
  Get,
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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { CustomerJwtGuard } from '@/modules/store-auth/guards';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto, ListReviewsDto } from './dto';

/**
 * Store-facing reviews surface (REVIEW API CONTRACT — public + customer):
 *  - GET  /api/store/products/:productId/reviews        public list + summary
 *  - POST /api/store/products/:productId/reviews         CUSTOMER JWT — submit
 *  - POST /api/store/reviews/:id/helpful                 public — helpful vote
 *
 * Follows the repo-wide `@Controller('api')` convention (every store + platform
 * controller does the same); the sub-path is qualified per-route. The public
 * reads/votes carry NO class-level guard (matching cart/orders store controllers);
 * the submit route is per-route CUSTOMER-gated and the customer id is pinned from
 * the verified JWT (req.user.id) — NEVER the body.
 */
@Controller('api')
@UseGuards(ThrottlerGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Public paginated APPROVED reviews + aggregate summary for a product. */
  @Get('store/products/:productId/reviews')
  @Throttle({ medium: { limit: 30, ttl: 60000 } })
  listProductReviews(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Query() query: ListReviewsDto,
  ) {
    return this.reviews.listPublicReviews(productId, query);
  }

  /**
   * Submit a review (CUSTOMER JWT). Creates a PENDING review (one per customer per
   * product → 409 on duplicate); isVerifiedPurchase is computed server-side from a
   * DELIVERED order. STRICT tier — a single customer should not be hammering this.
   */
  @UseGuards(CustomerJwtGuard)
  @Post('store/products/:productId/reviews')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 6, ttl: 60000 } })
  submitReview(
    @Req() req: Request,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: CreateReviewDto,
  ) {
    const customerId = (req as Request & { user?: { id?: string } }).user?.id;
    if (!customerId) {
      // The guard guarantees an authenticated CUSTOMER, but assert defensively so
      // an unexpected missing id is a clean 401, never an undefined-id write.
      throw new UnauthorizedException('Customer authentication required');
    }
    return this.reviews.submitReview(productId, customerId, dto);
  }

  /**
   * Increment a review's helpful count (public). Layered abuse mitigation: the
   * STRICT per-IP @Throttle bounds burst rate, and the service applies a Redis
   * per-review-per-IP dedupe (one vote / IP / review / 24h) so a single IP can't
   * inflate a count beyond one. The voter IP is taken SOLELY from `req.ip` /
   * the socket remote address — the raw `X-Forwarded-For` header is intentionally
   * NOT trusted (Express is not configured with `trust proxy`, so a client could
   * otherwise spoof the source IP and defeat the dedupe). True per-user dedupe
   * still needs a votes table (schema change, out of this module's scope).
   */
  @Post('store/reviews/:id/helpful')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 6, ttl: 60000 } })
  markHelpful(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const voterIp = req.ip ?? req.socket?.remoteAddress ?? null;
    return this.reviews.markHelpful(id, voterIp);
  }
}
