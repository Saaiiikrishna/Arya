/**
 * Rupee -> paise boundary conversion helpers for the catalog module.
 *
 * Money is INTEGER PAISE everywhere inside the service/DB. DTOs accept rupees
 * (decimal) and we convert ONLY here, at the API boundary, rejecting any value
 * that cannot be represented as a finite, non-negative whole number of paise.
 */
import { BadRequestException } from '@nestjs/common';

/**
 * Convert a rupee amount (number, may have up to 2 decimal places) to integer
 * paise. Rejects non-finite, negative, and sub-paise (fractional-paise) values.
 */
export function rupeesToPaise(rupees: number, field = 'amount'): number {
  if (typeof rupees !== 'number' || !Number.isFinite(rupees)) {
    throw new BadRequestException(`${field} must be a finite number of rupees`);
  }
  if (rupees < 0) {
    throw new BadRequestException(`${field} must not be negative`);
  }
  // Round to the nearest paise after scaling. Guard against floating-point
  // representation error (e.g. 19.99 * 100 = 1998.9999999998) by rounding, then
  // assert the rounded value is within half a paise of the scaled input so a
  // genuinely fractional-paise input (e.g. 19.999) is rejected, not silently
  // rounded.
  const scaled = rupees * 100;
  const paise = Math.round(scaled);
  if (Math.abs(scaled - paise) > 1e-6) {
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
