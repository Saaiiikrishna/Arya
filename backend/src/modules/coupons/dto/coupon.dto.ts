import {
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsBoolean,
  IsEnum,
  Min,
  Max,
  MaxLength,
  MinLength,
  IsDateString,
  Matches,
} from 'class-validator';
import { CouponType, CouponStatus } from '@prisma/client';

/**
 * Max basis points for a PERCENT coupon: 10000 bps = 100%. (PERCENT.value is bps.)
 */
const MAX_PERCENT_BPS = 10000;

/**
 * Upper bound (in RUPEES) for any monetary coupon field and for a validate
 * subtotal. 10,000,000 (₹1 crore) is far above any realistic cart or coupon
 * amount, yet small enough to (a) bound oversized-input probing of coupon config
 * through the public validate endpoint and (b) keep the rupee→paise integer
 * arithmetic well within Number.MAX_SAFE_INTEGER. A FIXED coupon's `value`,
 * `maxDiscount`, `minOrderValue`, and the validate `subtotal` all share this cap.
 * (A PERCENT coupon's `value` is basis points, bounded separately by MAX_PERCENT_BPS.)
 */
const MAX_RUPEE_AMOUNT = 10_000_000;

/**
 * Admin: create a coupon.
 *
 * Money fields (`minOrderValue`, `maxDiscount`, and a FIXED coupon's `value`) are
 * supplied in RUPEES and converted to integer paise at the service boundary. A
 * PERCENT coupon's `value` is BASIS POINTS (1800 = 18%) and is taken directly.
 * The code is uppercased + trimmed at the boundary so lookups are stable.
 */
export class CreateCouponDto {
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  // Alphanumerics, dashes, underscores only — a coupon code is typed by humans.
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code may contain only letters, numbers, dashes and underscores',
  })
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @IsEnum(CouponType)
  type!: CouponType;

  /**
   * PERCENT → basis points (1..10000). FIXED → rupees (converted to paise).
   * Must be positive — a 0-value coupon discounts nothing; the service would
   * later reject it, so reject at the boundary instead. Type-specific bounds +
   * the rupee→paise conversion are enforced in the service so the rule lives in
   * one place; MAX_RUPEE_AMOUNT bounds a FIXED rupee value (a PERCENT value is
   * further constrained to MAX_PERCENT_BPS in the service).
   */
  @IsNumber()
  @Min(1)
  @Max(MAX_RUPEE_AMOUNT)
  value!: number;

  /**
   * Rupees; cap on the discount a PERCENT coupon may grant. Ignored for FIXED.
   * Must be positive — a cap of 0 would silently zero every discount.
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(MAX_RUPEE_AMOUNT)
  maxDiscount?: number;

  /** Rupees; minimum order subtotal (pre-tax) for the coupon to apply. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_RUPEE_AMOUNT)
  minOrderValue?: number;

  @IsOptional()
  @IsEnum(CouponStatus)
  status?: CouponStatus;

  /** Total redemptions allowed across all customers; omit/null = unlimited. */
  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  /** Per-identity (email) redemption cap. Defaults to 1. */
  @IsOptional()
  @IsInt()
  @Min(1)
  perCustomerLimit?: number;

  /** If false (default) the coupon requires a REGISTERED customer (anti-farming). */
  @IsOptional()
  @IsBoolean()
  allowGuest?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

/**
 * Admin: partial update. `code` and `type` are intentionally NOT updatable —
 * mutating either after redemptions exist would corrupt audit/anti-farming
 * semantics; admins disable + recreate instead.
 */
export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(MAX_RUPEE_AMOUNT)
  value?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(MAX_RUPEE_AMOUNT)
  maxDiscount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_RUPEE_AMOUNT)
  minOrderValue?: number;

  @IsOptional()
  @IsEnum(CouponStatus)
  status?: CouponStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  perCustomerLimit?: number;

  @IsOptional()
  @IsBoolean()
  allowGuest?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

/** Admin list filters. */
export class CouponQueryDto {
  @IsOptional()
  @IsEnum(CouponStatus)
  status?: CouponStatus;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/**
 * Public: validate a coupon against a cart subtotal before checkout. Subtotal is
 * the pre-tax, pre-discount items total in RUPEES (converted to paise here).
 * Identity (customerId / email / isGuest) is derived server-side from the
 * JWT/guest context by the caller — never trusted from this body.
 */
export class ValidateCouponDto {
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  code!: string;

  @IsNumber()
  @Min(0)
  @Max(MAX_RUPEE_AMOUNT)
  subtotal!: number;
}

export { MAX_PERCENT_BPS, MAX_RUPEE_AMOUNT };
