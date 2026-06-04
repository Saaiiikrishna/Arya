/**
 * Rupee -> paise boundary conversion for the DIY module.
 *
 * Re-exports the canonical helpers from `@/common/money` so the bundle SKU
 * minting path produces the EXACT same paise representation as ordinary SKU
 * creation in catalog — one implementation, no divergent rounding rules. The
 * fractional-paise guard lives there (see common/money.ts).
 */
export { rupeesToPaise, optionalRupeesToPaise } from '@/common/money';
