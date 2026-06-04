import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/** Attach a coupon to the cart (validate-only — never redeems). (Section 4.5) */
export class ApplyCouponDto {
  /**
   * Coupon code. Normalised to a trimmed, upper-cased form so the same code in
   * any case maps to the one stored coupon. The authoritative validation lives
   * in CouponService.validateCoupon.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  code!: string;
}
