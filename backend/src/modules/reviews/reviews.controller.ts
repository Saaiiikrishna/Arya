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
 *  - POST /api/store/reviews/:id/helpful                 CUSTOMER JWT — helpful vote
 *
 * Follows the repo-wide `@Controller('api')` convention (every store + platform
 * controller does the same); the sub-path is qualified per-route. The public READ
 * carries NO class-level guard (matching cart/orders store controllers); both the
 * submit AND helpful-vote routes are per-route CUSTOMER-gated and the customer id
 * is pinned from the verified JWT (req.user.id) — NEVER the body. The public can
 * still READ helpfulCount via the list; only a registered customer can vote.
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
   * Register a helpful vote on a review (CUSTOMER JWT). TRUE per-user dedupe: the
   * service inserts a (review, customer) row into review_helpful_votes guarded by
   * a @@unique, so a customer can vote at most once per review (a repeat is a 200
   * no-op returning the current count). The customer id is pinned from the verified
   * JWT (req.user.id) — never the body; no request body is needed. STRICT tier
   * bounds burst rate per customer.
   */
  @UseGuards(CustomerJwtGuard)
  @Post('store/reviews/:id/helpful')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 6, ttl: 60000 } })
  markHelpful(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const customerId = (req as Request & { user?: { id?: string } }).user?.id;
    if (!customerId) {
      // The guard guarantees an authenticated CUSTOMER, but assert defensively so
      // an unexpected missing id is a clean 401, never an undefined-id write.
      throw new UnauthorizedException('Customer authentication required');
    }
    return this.reviews.markHelpful(id, customerId);
  }
}
