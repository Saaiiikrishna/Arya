/**
 * Shared defensive-narrowing helpers for the store pages.
 *
 * The public store DTOs are intentionally permissive (`Record<string, unknown>`
 * / open index signatures) so the frontend never crashes on an unexpected shape.
 * These three helpers narrow `unknown` values at the read site. They are extracted
 * here so the product-detail page and the DIY build page share one definition
 * rather than maintaining two copies that can silently drift.
 */

/** Narrow to a non-empty string, else null. */
export function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Narrow to a finite number, else null. */
export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Narrow to a plain object (not an array), else null. */
export function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
