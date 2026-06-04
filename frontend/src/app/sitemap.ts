/**
 * Dynamic sitemap for the PUBLIC surfaces (Next 16 metadata route convention —
 * `app/sitemap.ts` exporting a default function returning `MetadataRoute.Sitemap`).
 *
 * Lists:
 *   - Static public routes: /, /startup, /store, /articles.
 *   - Dynamic ACTIVE product slugs   (storeApi.listProducts).
 *   - Dynamic PUBLISHED article slugs (storeApi.listArticles — the public list
 *     endpoint only returns PUBLISHED items).
 *
 * Resilience: the dynamic fetches are best-effort. Any failure (API down, bad
 * shape, timeout) is swallowed and we fall back to JUST the static routes, so the
 * sitemap is always served and never 500s. Authenticated areas (/admin, /hub,
 * /account) are intentionally excluded here and disallowed in robots.ts.
 *
 * Base URL: the shared `baseUrl()` from `@/lib/siteUrl` (NEXT_PUBLIC_SITE_URL
 * when set, else the production domain). URLs in a sitemap MUST be absolute, so
 * every entry is prefixed with this origin. robots.ts imports the SAME helper.
 *
 * Build-time data: dynamic entries come from storeApi, whose base URL is read
 * from NEXT_PUBLIC_API_URL. If that env var is NOT set at build time (common in
 * CI where the backend is not running during the frontend build), the API calls
 * fail and the try/catch blocks below fall back to STATIC ROUTES ONLY — the
 * sitemap is still served and never 500s; it just omits product/article slugs.
 *
 * Caching: this file uses no request-time API, so Next caches it by default. The
 * pagination cap below bounds how many dynamic URLs we enumerate per build/render.
 */

import type { MetadataRoute } from 'next';
import { storeApi } from '@/lib/storeApi';
import { baseUrl } from '@/lib/siteUrl';

// Cap the dynamic enumeration. Google's hard limit is 50k URLs/sitemap; this is a
// pragmatic ceiling for a single-file sitemap on a storefront of this size. If the
// catalog/journal outgrows this, split via generateSitemaps (Next 16 docs). When a
// dynamic list returns exactly MAX_DYNAMIC rows the result is likely truncated, so
// we emit a build-time warning (see below) signalling a generateSitemaps() split.
const MAX_DYNAMIC = 1000;

/** Narrow an unknown list item to a usable, URL-safe slug, else null. */
function slugOf(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const slug = (item as { slug?: unknown }).slug;
  return typeof slug === 'string' && slug.trim().length > 0 ? slug.trim() : null;
}

/** Best-effort ISO/Date lastModified from a list item, else undefined. */
function lastModifiedOf(item: unknown, ...keys: string[]): Date | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const rec = item as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim()) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = baseUrl();
  const now = new Date();

  // ── Static public routes (always present) ──────────────────────────────────
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/startup`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/store`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/articles`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
  ];

  // ── Dynamic: ACTIVE product slugs (best-effort) ────────────────────────────
  let productEntries: MetadataRoute.Sitemap = [];
  try {
    const res = await storeApi.listProducts({ limit: MAX_DYNAMIC });
    const rows = Array.isArray(res?.data) ? res.data : [];
    if (rows.length >= MAX_DYNAMIC) {
      // Truncated at the cap — flag a generateSitemaps() split (Next 16 docs).
      console.warn(
        `[sitemap] product slugs hit the MAX_DYNAMIC cap (${MAX_DYNAMIC}); sitemap may be incomplete — consider generateSitemaps().`,
      );
    }
    productEntries = rows
      .map((p): MetadataRoute.Sitemap[number] | null => {
        const slug = slugOf(p);
        if (!slug) return null;
        // `slugOf()` already validated a non-empty string. `encodeURI` keeps URL-
        // safe path characters (hyphens, etc.) intact while still encoding any
        // genuinely unsafe character (space, `?`, a stray `/`) — unlike
        // encodeURIComponent, which over-encodes safe punctuation.
        return {
          url: `${base}/store/${encodeURI(slug)}`,
          lastModified: lastModifiedOf(p, 'updatedAt', 'createdAt') ?? now,
          changeFrequency: 'weekly',
          priority: 0.7,
        };
      })
      .filter((e): e is MetadataRoute.Sitemap[number] => e !== null);
  } catch {
    productEntries = [];
  }

  // ── Dynamic: PUBLISHED article slugs (best-effort) ─────────────────────────
  let articleEntries: MetadataRoute.Sitemap = [];
  try {
    const res = await storeApi.listArticles({ limit: MAX_DYNAMIC });
    const rows = Array.isArray(res?.data) ? res.data : [];
    if (rows.length >= MAX_DYNAMIC) {
      // Truncated at the cap — flag a generateSitemaps() split (Next 16 docs).
      console.warn(
        `[sitemap] article slugs hit the MAX_DYNAMIC cap (${MAX_DYNAMIC}); sitemap may be incomplete — consider generateSitemaps().`,
      );
    }
    articleEntries = rows
      .map((a): MetadataRoute.Sitemap[number] | null => {
        const slug = slugOf(a);
        if (!slug) return null;
        // See the product branch above: encodeURI preserves safe path characters
        // (the slug was already validated non-empty by slugOf()).
        return {
          url: `${base}/articles/${encodeURI(slug)}`,
          lastModified: lastModifiedOf(a, 'publishedAt', 'updatedAt', 'createdAt') ?? now,
          changeFrequency: 'monthly',
          priority: 0.6,
        };
      })
      .filter((e): e is MetadataRoute.Sitemap[number] => e !== null);
  } catch {
    articleEntries = [];
  }

  return [...staticEntries, ...productEntries, ...articleEntries];
}
