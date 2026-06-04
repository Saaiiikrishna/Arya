/**
 * Shared defensive-narrowing helpers for the store pages.
 *
 * The public store DTOs are intentionally permissive (`Record<string, unknown>`
 * / open index signatures) so the frontend never crashes on an unexpected shape.
 * These three helpers narrow a SINGLE already-accessed `unknown` value at the read
 * site (caller pre-accesses the property, e.g. `asStr(product.brand)`). They are
 * extracted here so the store pages share one definition rather than maintaining
 * copies that can silently drift.
 *
 * NAMING — `as*` prefix on purpose:
 * These are deliberately named `asStr`/`asNum`/`asObj`, distinct from the
 * value-accessor helpers in `@/lib/storeHelpers` (`str(obj, ...keys)` /
 * `num(obj, ...keys)`), which take a permissive bag PLUS a fallback chain of keys
 * and do the property access themselves. The two families share neither a calling
 * convention nor a return type (storeHelpers.num returns `number | undefined`;
 * asNum returns `number | null`), so they are NOT interchangeable. The distinct
 * names make that contract self-documenting and prevent a swap-the-import bug.
 */

/** Narrow to a non-empty (trimmed) string, else null. The trimmed value is returned. */
export function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** Narrow to a finite number, else null. */
export function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Narrow to a plain object (not an array), else null. */
export function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
