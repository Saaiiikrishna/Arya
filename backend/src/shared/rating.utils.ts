/**
 * Compute the rounded (1 dp) review average from the denormalized integer
 * aggregate (Product.ratingSum / Product.ratingCount).
 *
 * Integer columns are used upstream specifically to avoid float drift; the
 * rounding happens only here, at the read boundary. Returns 0 when there are no
 * ratings — a stable "no stars yet" value that also avoids a divide-by-zero.
 *
 * Shared by the catalog and reviews services so the rounding logic lives in
 * exactly one place (DRY across modules).
 */
export function ratingAverage(ratingSum: number, ratingCount: number): number {
  if (!ratingCount || ratingCount <= 0) return 0;
  return Math.round((ratingSum / ratingCount) * 10) / 10;
}
