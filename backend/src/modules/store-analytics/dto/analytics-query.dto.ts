import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Supported relative ranges for store-analytics endpoints. Resolved server-side
 * to an [start, end) IST day window (Section 8.8) so the client never supplies
 * raw dates that could be abused to scan unbounded history.
 */
export const ANALYTICS_RANGES = ['today', '7d', '30d'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/** `?range=today|7d|30d` (default 7d). */
export class AnalyticsRangeDto {
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range?: AnalyticsRange;
}

/** `?range=…&limit=…` for the top-products leaderboard. */
export class TopProductsQueryDto extends AnalyticsRangeDto {
  /** Best-sellers to return. Hard-capped so the leaderboard can never page the whole catalog. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/** Pagination for the low-stock report (limit hard-capped service-side too). */
export class LowStockQueryDto {
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
