import { apportion, resolveUnitPrice, PricingSkuLike } from './pricing.utils';

describe('pricing.utils — apportion (largest-remainder split, paise)', () => {
  it('parts always sum EXACTLY to the total', () => {
    for (const total of [10, 100, 999, 1, 7]) {
      const parts = apportion([1, 1, 1], total);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('distributes the remainder to the largest fractional parts', () => {
    // 10 across three equal weights → 3.33 each → [4,3,3]
    const parts = apportion([1, 1, 1], 10);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(parts.filter((p) => p === 4)).toHaveLength(1);
  });

  it('splits proportionally to weights', () => {
    expect(apportion([1, 3], 100)).toEqual([25, 75]);
    expect(apportion([1, 1], 10)).toEqual([5, 5]);
  });

  it('returns zeros for non-positive total or zero weights', () => {
    expect(apportion([1, 2, 3], 0)).toEqual([0, 0, 0]);
    expect(apportion([1, 2], -5)).toEqual([0, 0]);
    expect(apportion([0, 0], 10)).toEqual([0, 0]);
  });

  it('never produces a negative part', () => {
    const parts = apportion([5, 1, 1], 3);
    expect(parts.every((p) => p >= 0)).toBe(true);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('pricing.utils — resolveUnitPrice (paise)', () => {
  const sku = (o: Partial<PricingSkuLike> = {}): PricingSkuLike => ({
    basePrice: 1000,
    salePrice: null,
    saleStartsAt: null,
    saleEndsAt: null,
    priceTiers: [],
    ...o,
  });

  it('returns base price with no sale or tier', () => {
    expect(resolveUnitPrice(sku(), 1)).toBe(1000);
  });

  it('applies an in-window sale that is strictly below base', () => {
    expect(resolveUnitPrice(sku({ salePrice: 800 }), 1)).toBe(800);
  });

  it('ignores a sale price that is not below base', () => {
    expect(resolveUnitPrice(sku({ salePrice: 1200 }), 1)).toBe(1000);
  });

  it('ignores an expired sale', () => {
    expect(
      resolveUnitPrice(sku({ salePrice: 800, saleEndsAt: new Date(Date.now() - 60_000) }), 1),
    ).toBe(1000);
  });

  it('ignores a not-yet-started sale', () => {
    expect(
      resolveUnitPrice(sku({ salePrice: 800, saleStartsAt: new Date(Date.now() + 600_000) }), 1),
    ).toBe(1000);
  });

  it('applies a qualifying quantity tier when it is the lowest', () => {
    expect(resolveUnitPrice(sku({ priceTiers: [{ minQty: 10, unitPrice: 700 }] }), 10)).toBe(700);
  });

  it('ignores a tier when qty is below its threshold', () => {
    expect(resolveUnitPrice(sku({ priceTiers: [{ minQty: 10, unitPrice: 700 }] }), 5)).toBe(1000);
  });

  it('picks the lowest of an active sale and a qualifying tier', () => {
    expect(
      resolveUnitPrice(sku({ salePrice: 800, priceTiers: [{ minQty: 5, unitPrice: 600 }] }), 5),
    ).toBe(600);
  });
});
