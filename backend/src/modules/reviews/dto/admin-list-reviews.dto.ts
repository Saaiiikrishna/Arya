import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ReviewStatus } from '@prisma/client';

/**
 * Admin review-moderation queue filters + pagination
 * (GET /api/admin/store/reviews). Defaults to the PENDING queue is applied in the
 * service (no status → PENDING) so the moderation board opens on the work list.
 * limit capped at 200 (admin board may want larger pages than the public list).
 */
export class AdminListReviewsDto {
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
