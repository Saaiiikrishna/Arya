/**
 * Rupee -> paise boundary conversion for the catalog module.
 *
 * Re-exports the canonical helpers from `@/common/money` so SKU creation here and
 * bundle SKU minting in the diy module share one implementation — the
 * fractional-paise guard and rounding rules live in common/money.ts.
 */
export { rupeesToPaise, optionalRupeesToPaise } from '@/common/money';
