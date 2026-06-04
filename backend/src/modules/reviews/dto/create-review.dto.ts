import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Bounds for the free-text review fields. The body is required; the title is
 * optional. Both are length-capped so an oversized payload can't be used to bloat
 * the row / abuse storage (the column is @db.Text but we still cap at the API edge).
 */
export const REVIEW_TITLE_MAX = 200;
export const REVIEW_BODY_MAX = 5000;

/**
 * Submit a product review (POST /api/store/products/:productId/reviews).
 *
 * The customer identity is ALWAYS taken from the verified CUSTOMER JWT
 * (req.user.id) — never accepted from the body. The created review is PENDING and
 * does NOT affect Product.ratingSum/ratingCount until an admin APPROVES it.
 * `rating` is bounded 1..5 here (and re-enforced by the reviews_rating_check DB
 * constraint), so a value outside the range is a clean 400, not a DB error.
 */
export class CreateReviewDto {
  // No @Type(() => Number) here: this is a JSON body field (not a query string),
  // and `rating` is already an integer in the payload. The query DTOs
  // (ListReviewsDto / AdminListReviewsDto) keep @Type for their pagination
  // fields because those arrive as strings on the query string.
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  // Trimmed at the edge so the stored title matches the service-side
  // `dto.title?.trim()` treatment and a whitespace-only title becomes empty
  // (then nulled by the service).
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(REVIEW_TITLE_MAX)
  title?: string;

  // Required free text. Trimmed first, then @MinLength(1) rejects an empty /
  // whitespace-only body at the API edge (matches the apply-coupon /
  // article-media @MinLength(1) precedent) rather than silently storing a blank.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(REVIEW_BODY_MAX)
  body!: string;
}
