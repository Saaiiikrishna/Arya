/**
 * Canonical storefront pricing math, shared so the cart PREVIEW and the checkout
 * CHARGE can never drift (architecture 8.3 — single source of truth for money).
 *
 * `OrdersService` delegates to these functions instead of carrying its own copy
 * of the apportionment / unit-price logic. `CartService` historically kept a
 * private copy with identical semantics; it should be migrated onto these helpers
 * so there is exactly ONE implementation. Until then the two MUST stay byte-for-
 * byte equivalent — any change here must be mirrored there (and vice versa) or the
 * checkout total will diverge from the previewed cart total.
 *
 * All amounts are INTEGER PAISE.
 */

/** The live SKU pricing projection used to resolve a unit price. */
export interface PricingSkuLike {
  basePrice: number;
  salePrice: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  priceTiers: { minQty: number; unitPrice: number }[];
}

/**
 * Resolve the unit price (paise) for `qty` units of a SKU from its LIVE pricing
 * projection: the lowest of the effective price (an in-window sale strictly below
 * base, else base) and any qualifying quantity tier.
 */
export function resolveUnitPrice(sku: PricingSkuLike, qty: number): number {
  const now = Date.now();
  const startsOk = !sku.saleStartsAt || sku.saleStartsAt.getTime() <= now;
  const endsOk = !sku.saleEndsAt || sku.saleEndsAt.getTime() >= now;
  let best =
    sku.salePrice !== null &&
    sku.salePrice < sku.basePrice &&
    startsOk &&
    endsOk
      ? sku.salePrice
      : sku.basePrice;
  for (const tier of sku.priceTiers) {
    if (qty >= tier.minQty && tier.unitPrice < best) best = tier.unitPrice;
  }
  return best;
}

/**
 * Largest-remainder apportionment of `total` across `weights` so the parts are
 * non-negative integers summing EXACTLY to `total`. Used to split a coupon
 * discount across order lines so per-line taxable + GST stay correct.
 */
export function apportion(weights: number[], total: number): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w * total) / sumW);
  const floored = raw.map((r) => Math.floor(r));
  let remaining = total - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floored];
  for (const { i } of order) {
    if (remaining <= 0) break;
    result[i] += 1;
    remaining -= 1;
  }
  return result;
}
