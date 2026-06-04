import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Sort order for the public product-review list.
 *  - RECENT      → newest first (createdAt desc)  [default]
 *  - HELPFUL     → most-helpful first (helpfulCount desc, then createdAt desc)
 *  - RATING_DESC → highest rated first (rating desc, then createdAt desc)
 *
 * The string values mirror the frontend ReviewSort union exactly
 * ('recent' | 'helpful' | 'rating_desc') so the storefront's "Highest rated"
 * option maps to a recognised value instead of being whitelist-stripped by the
 * ValidationPipe and silently falling back to RECENT.
 */
export enum ReviewSort {
  RECENT = 'recent',
  HELPFUL = 'helpful',
  RATING_DESC = 'rating_desc',
}

/**
 * Public review-list filters + pagination
 * (GET /api/store/products/:productId/reviews). Pagination matches the repo-wide
 * {page, limit} → {data, meta} convention. limit is capped at 50 so a crawler
 * can't pull an unbounded page.
 */
export class ListReviewsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsEnum(ReviewSort)
  sort?: ReviewSort;
}
