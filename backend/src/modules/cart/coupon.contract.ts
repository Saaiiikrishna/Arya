import type { Prisma } from '@prisma/client';

/**
 * Cross-module contract for the (parallel-built) coupon module.
 *
 * The cart module only needs the validate (preview) half of the coupon surface —
 * it NEVER redeems (redemption happens atomically inside the checkout tx). We
 * depend on this STRUCTURAL interface (not the concrete CouponService class) so
 * the cart module compiles and boots independently of the coupon module's build
 * order. At runtime the coupon module registers its CouponService under the
 * {@link COUPON_SERVICE} token (see CouponModule), and cart resolves it via DI.
 *
 * The signatures here MUST stay byte-for-byte aligned with the cross-module
 * CONTRACT so cart, coupon and checkout agree:
 *
 *   validateCoupon(code, ctx, subtotalPaise) -> { couponId, code, discountPaise }
 *   redeemCoupon(tx, args) -> void   (checkout-only; declared for completeness)
 */

/** The validated-coupon preview returned to the cart for display + attach. */
export interface ValidatedCoupon {
  couponId: string;
  code: string;
  /** Discount in INTEGER PAISE, already capped at maxDiscount. */
  discountPaise: number;
}

/** Buyer context the validator uses for guest-gating + per-email anti-farming. */
export interface CouponValidationContext {
  customerId?: string;
  email?: string;
  isGuest: boolean;
}

/**
 * The slice of CouponService the cart depends on. The concrete CouponService in
 * the coupon module implements (a superset of) this; cart only calls
 * validateCoupon.
 */
export interface CouponValidator {
  /**
   * Validate a coupon for the given buyer + subtotal. Throws BadRequest if the
   * coupon is invalid/expired/min-not-met/guest-not-allowed/exhausted. Returns
   * the couponId + the capped discount in paise (preview only — no redemption).
   */
  validateCoupon(
    code: string,
    ctx: CouponValidationContext,
    subtotalPaise: number,
  ): Promise<ValidatedCoupon>;

  /**
   * Atomically redeem a coupon inside an open checkout transaction. Declared for
   * interface completeness / type-alignment across modules; cart never calls it.
   */
  redeemCoupon(
    tx: Prisma.TransactionClient,
    args: {
      couponId: string;
      orderId: string;
      customerId?: string;
      email?: string;
      phone?: string;
    },
  ): Promise<void>;
}

/**
 * DI token under which the coupon module provides its CouponService. Using a
 * token (rather than importing the CouponService class) keeps the cart module
 * free of a compile-time dependency on the coupon module's file layout.
 */
export const COUPON_SERVICE = 'COUPON_SERVICE';
