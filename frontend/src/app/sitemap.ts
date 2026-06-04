/**
 * Dynamic sitemap for the PUBLIC surfaces (Next 16 metadata route convention —
 * `app/sitemap.ts` exporting a default function returning `MetadataRoute.Sitemap`).
 *
 * AI- and Google-discovery optimised. Each entry carries:
 *   - `lastModified` — article publishedAt/updatedAt, product updatedAt.
 *   - `changeFrequency` + `priority` tuned per route TYPE (home > store/journal
 *     index > product detail > article detail).
 *   - `images` — absolute URLs of the product/article cover so image search and
 *     LLM crawlers can associate the media with the page (Next 16 sitemap
 *     `images` field → emits `<image:image>` in the XML).
 *
 * Lists:
 *   - Static public routes: /, /startup, /store, /articles, /pledge, /privacy,
 *     /terms (all built, indexable public pages).
 *   - Dynamic ACTIVE product slugs   (GET /store/products).
 *   - Dynamic PUBLISHED article slugs (GET /articles — the public list endpoint
 *     only returns PUBLISHED items).
 *
 * Data fetch: a bare server-side `fetch` (via the shared `fetchPublicJson`
 * helper), NOT the `storeApi` browser client. `storeApi` is a stateful singleton
 * (in-memory token slot, sessionStorage/localStorage guards) and must never be
 * imported into server code — the bare fetch is the correct server idiom here and
 * avoids any cross-request state coupling in the shared Node.js process.
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
 * Image URLs: covers come back from the public read surfaces as either an
 * already-resolved URL or a raw S3 key, so we run every candidate through
 * `resolveMediaUrl` (→ NEXT_PUBLIC_MEDIA_BASE / S3 fallback) to guarantee an
 * ABSOLUTE image URL — relative image URLs are invalid in a sitemap.
 *
 * Build-time data: dynamic entries come from a bare server fetch whose base URL
 * is read from NEXT_PUBLIC_API_URL. If that env var is NOT set at build time
 * (common in CI where the backend is not running during the frontend build), the
 * fetch fails and the try/catch blocks below fall back to STATIC ROUTES ONLY —
 * the sitemap is still served and never 500s; it just omits product/article slugs.
 *
 * Caching: `fetchPublicJson` ties each fetch to the `revalidate` window exported
 * below, so this sitemap is rebuilt at most once per `revalidate` seconds (ISR)
 * rather than on every crawl — a freshish sitemap without hammering the API on
 * every hit. The pagination cap below bounds how many dynamic URLs we enumerate.
 */

import type { MetadataRoute } from 'next';
import { baseUrl } from '@/lib/siteUrl';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { fetchPublicJson } from '@/lib/serverMetaUtil';

// Rebuild the sitemap at most hourly (ISR) rather than on every crawl hit.
export const revalidate = 3600;

// Cap the dynamic enumeration. Google's hard limit is 50k URLs/sitemap; this is a
// pragmatic ceiling for a single-file sitemap on a storefront of this size. If the
// catalog/journal outgrows this, split via generateSitemaps (Next 16 docs). When a
// dynamic list returns exactly MAX_DYNAMIC rows the result is likely truncated, so
// we emit a build-time warning (see below) signalling a generateSitemaps() split.
const MAX_DYNAMIC = 1000;

/**
 * Narrow an unknown list item to a usable, URL-safe slug, else null.
 *
 * `encodeURI` (applied at the call site) does NOT encode `&`, so a slug holding
 * a literal `&`/`<`/`>` would survive into the `<loc>` value, which Next writes
 * verbatim with no entity escaping — producing non-well-formed sitemap XML. Slugs
 * are URL-safe by backend convention; we reject any that contains an XML-unsafe
 * character as an extra defence layer rather than emit a malformed sitemap.
 */
function slugOf(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const slug = (item as { slug?: unknown }).slug;
  if (typeof slug !== 'string') return null;
  const trimmed = slug.trim();
  if (trimmed.length === 0) return null;
  if (/[&<>"']/.test(trimmed)) return null;
  return trimmed;
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

/** Read a string property from an unknown record, else undefined. */
function strProp(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * An image URL is only valid in a sitemap if it is an absolute http(s) URL (or
 * protocol-relative `//`). `resolveMediaUrl` may pass through `data:`/`blob:`
 * URIs (valid for in-browser preview, but NOT loadable by crawlers and rejected
 * by Google Search Console / XML validators). It also does not entity-escape,
 * so a URL containing a bare `&` or `<` would make Next's `<image:loc>`/`<loc>`
 * serialisation non-well-formed (Next writes these values verbatim). We drop any
 * candidate that is not a clean http(s)/protocol-relative URL free of those
 * XML-unsafe characters — an extra defence layer over the backend's slug rules.
 */
function isSitemapSafeImage(url: string): boolean {
  if (!(/^https?:\/\//i.test(url) || url.startsWith('//'))) return false;
  // Reject characters that Next's serializer would emit unescaped, breaking XML.
  return !/[&<>"']/.test(url);
}

/**
 * Resolve a list item's cover image to ONE absolute URL (or none).
 *
 * Covers may arrive as a resolved URL field, a raw S3 key field, or nested on a
 * `thumbnail` object (product cards). We probe the documented candidate keys in
 * priority order and push the first that resolves through `resolveMediaUrl`,
 * which guarantees an absolute URL. Returns `[]` (the Next sitemap `images`
 * field is `string[]`) when no usable cover is present.
 */
function imagesOf(item: unknown, ...keys: string[]): string[] {
  if (!item || typeof item !== 'object') return [];
  const rec = item as Record<string, unknown>;
  for (const k of keys) {
    const resolved = resolveMediaUrl(strProp(rec, k));
    if (resolved && isSitemapSafeImage(resolved)) return [resolved];
  }
  // Product cards may nest the thumbnail URL on a `thumbnail` object.
  const thumb = rec.thumbnail;
  if (thumb && typeof thumb === 'object') {
    const resolved = resolveMediaUrl(strProp(thumb as Record<string, unknown>, 'url'));
    if (resolved && isSitemapSafeImage(resolved)) return [resolved];
  }
  return [];
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
    // Public donor + legal pages: canonical, indexable, but low-churn.
    { url: `${base}/pledge`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  // ── Dynamic: ACTIVE product slugs (best-effort) ────────────────────────────
  let productEntries: MetadataRoute.Sitemap = [];
  try {
    // Bare server fetch (NOT the storeApi browser singleton). The public catalog
    // list returns `{ data: [...] }`; `?limit=MAX_DYNAMIC` requests the full page.
    const res = await fetchPublicJson(`/store/products?limit=${MAX_DYNAMIC}`, revalidate);
    const rows = Array.isArray(res?.data) ? (res.data as unknown[]) : [];
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
        const images = imagesOf(p, 'primaryImageUrl', 'primaryImageS3Key');
        return {
          url: `${base}/store/${encodeURI(slug)}`,
          lastModified: lastModifiedOf(p, 'updatedAt', 'createdAt') ?? now,
          changeFrequency: 'weekly',
          priority: 0.7,
          ...(images.length ? { images } : {}),
        };
      })
      .filter((e): e is MetadataRoute.Sitemap[number] => e !== null);
  } catch {
    productEntries = [];
  }

  // ── Dynamic: PUBLISHED article slugs (best-effort) ─────────────────────────
  let articleEntries: MetadataRoute.Sitemap = [];
  try {
    // Bare server fetch (NOT the storeApi browser singleton). The public article
    // list returns `{ data: [...] }`; `?limit=MAX_DYNAMIC` requests the full page.
    const res = await fetchPublicJson(`/articles?limit=${MAX_DYNAMIC}`, revalidate);
    const rows = Array.isArray(res?.data) ? (res.data as unknown[]) : [];
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
        const images = imagesOf(a, 'coverUrl', 'coverS3Key');
        return {
          url: `${base}/articles/${encodeURI(slug)}`,
          lastModified: lastModifiedOf(a, 'publishedAt', 'updatedAt', 'createdAt') ?? now,
          changeFrequency: 'monthly',
          priority: 0.6,
          ...(images.length ? { images } : {}),
        };
      })
      .filter((e): e is MetadataRoute.Sitemap[number] => e !== null);
  } catch {
    articleEntries = [];
  }

  return [...staticEntries, ...productEntries, ...articleEntries];
}
