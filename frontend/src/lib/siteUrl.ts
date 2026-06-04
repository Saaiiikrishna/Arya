/**
 * Single source of truth for the public site origin used by SEO metadata routes
 * (app/sitemap.ts, app/robots.ts) and anywhere else that must emit ABSOLUTE URLs.
 *
 * Resolution: NEXT_PUBLIC_SITE_URL when set (non-empty after trim), else the
 * production domain. A trailing slash is stripped so callers can safely append
 * a path beginning with `/` without producing a double slash.
 *
 * This was extracted from a verbatim copy-paste that previously lived in both
 * sitemap.ts and robots.ts — change the production domain or the fallback logic
 * here, in ONE place, and both consumers stay in sync.
 */

/** The production fallback origin, used when NEXT_PUBLIC_SITE_URL is unset. */
export const PRODUCTION_SITE_URL = 'https://aryavartham.com';

/**
 * The absolute public origin (no trailing slash), e.g. `https://aryavartham.com`.
 * Prefer this over reading the env var directly so the fallback + normalisation
 * stay consistent across every SEO surface.
 */
export function baseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const url = raw && raw.length > 0 ? raw : PRODUCTION_SITE_URL;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
