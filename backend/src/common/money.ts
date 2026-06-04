/**
 * Canonical rupee -> paise boundary conversion helpers.
 *
 * Money is INTEGER PAISE everywhere inside services/DB. DTOs accept rupees
 * (decimal) and we convert ONLY here, at the API boundary, rejecting any value
 * that cannot be represented as a finite, non-negative whole number of paise.
 *
 * Single source of truth: catalog AND diy (bundle SKU minting) both import from
 * here so the paise representation can never diverge between the two SKU-creation
 * paths (no duplicated, drifting rounding rules).
 */
import { BadRequestException } from '@nestjs/common';

/**
 * Convert a rupee amount (number, may have up to 2 decimal places) to integer
 * paise. Rejects non-finite, negative, and sub-paise (fractional-paise) values.
 *
 * Sub-paise guard: we count the decimal places of the input rather than relying
 * solely on `|scaled - round| > epsilon`, because float representation can make a
 * genuinely fractional-paise input (e.g. 99.005 → 9900.500000000001) round to a
 * whole paise with a residual far below any fixed epsilon, silently accepting it.
 * Comparing `Math.round(rupees * 100) / 100` back to the original detects any
 * value that is not an exact multiple of one paise.
 */
export function rupeesToPaise(rupees: number, field = 'amount'): number {
  if (typeof rupees !== 'number' || !Number.isFinite(rupees)) {
    throw new BadRequestException(`${field} must be a finite number of rupees`);
  }
  if (rupees < 0) {
    throw new BadRequestException(`${field} must not be negative`);
  }
  const paise = Math.round(rupees * 100);
  // Reject any input that is not an exact whole number of paise. Dividing the
  // rounded paise back to rupees and comparing to the original input rejects
  // sub-paise precision (e.g. 99.005) that a fixed-epsilon check would miss.
  if (paise / 100 !== rupees) {
    throw new BadRequestException(`${field} must not have fractional paise`);
  }
  if (!Number.isSafeInteger(paise)) {
    throw new BadRequestException(`${field} is too large`);
  }
  return paise;
}

/**
 * Optional variant: returns undefined for null/undefined input, otherwise
 * converts. Used for optional price fields (salePrice, etc.).
 */
export function optionalRupeesToPaise(
  rupees: number | null | undefined,
  field = 'amount',
): number | undefined {
  if (rupees === null || rupees === undefined) return undefined;
  return rupeesToPaise(rupees, field);
}
