/**
 * Server-only helpers shared by the per-route metadata layouts
 * (`app/store/[slug]/layout.tsx`, `app/articles/[slug]/layout.tsx`) and the SEO
 * route handlers. Extracted to kill the verbatim copy-paste that previously lived
 * inline in each sibling layout (the `str()` narrowing helper and the `API_BASE`
 * constant) — change the trim/null logic or the API base ONCE, here, and every
 * consumer stays in sync.
 *
 * These call NO browser APIs and hold NO module state, so they are safe to import
 * into Server Components and Route Handlers. They are the correct counterpart to a
 * bare server-side `fetch()` (the established server-fetch idiom) — unlike the
 * stateful `storeApi` browser client, which must NOT be imported into server code.
 */

/**
 * Server-side API base for direct metadata fetches. Mirrors the storeApi default
 * (`NEXT_PUBLIC_API_URL`, which already includes the `/api` prefix) so the bare
 * server fetches work in local dev too. Single source of truth for the SEO layer.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

/** Narrow an unknown value to a trimmed non-empty string, else null. */
export function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Best-effort server fetch of a public JSON resource by absolute-or-relative path
 * (joined onto `API_BASE`). Returns the parsed object, or null on ANY failure
 * (non-2xx, network error, non-object body) so metadata generation degrades to a
 * static fallback rather than throwing — a metadata error must never break render.
 *
 * `revalidateSeconds` ties the fetch to the route's ISR window (Next 16 caching).
 */
export async function fetchPublicJson(
  path: string,
  revalidateSeconds: number,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      next: { revalidate: revalidateSeconds },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return data && typeof data === 'object'
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
