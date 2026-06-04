import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AdminGuard } from '@/modules/auth/guards';
import { ReviewsService } from './reviews.service';
import { AdminListReviewsDto, ModerateReviewDto } from './dto';

/**
 * Admin review-moderation surface (REVIEW API CONTRACT — admin):
 *  - GET   /api/admin/store/reviews        list/filter by status (PENDING default)
 *  - PATCH /api/admin/store/reviews/:id    moderate { status: APPROVED|REJECTED }
 *
 * AdminGuard is applied at the controller class level (CLAUDE.md convention:
 * "AdminGuard at controller class level"); a MODERATOR can triage and act on the
 * queue. APPROVE adds the rating to Product.ratingSum/ratingCount and an
 * APPROVED→REJECTED move subtracts it — applied ATOMICALLY (advisory lock + CAS,
 * idempotent) in the service so concurrent moderations never double-count.
 */
@Controller('api/admin/store')
@UseGuards(AdminGuard, ThrottlerGuard)
export class ReviewsAdminController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Moderation queue (defaults to PENDING when no status filter is supplied). */
  @Get('reviews')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  list(@Query() query: AdminListReviewsDto) {
    return this.reviews.adminListReviews(query);
  }

  /** Approve or reject a review (idempotent; applies the rating-aggregate delta). */
  @Patch('reviews/:id')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  moderate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.reviews.moderateReview(id, dto.status);
  }
}
