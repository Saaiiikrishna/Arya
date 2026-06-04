/**
 * `GET /feed.xml` — RSS 2.0 feed of the latest PUBLISHED Journal articles.
 *
 * Next 16 Route Handler (`app/feed.xml/route.ts` exporting GET). Fetches the
 * public article list via a bare server `fetch` (the public list endpoint only
 * ever returns PUBLISHED items) and serialises each into an RSS `<item>` with:
 *   - title         → article title
 *   - link          → absolute /articles/<slug> URL
 *   - description   → article excerpt
 *   - pubDate       → publishedAt (RFC-822), when present
 *   - guid          → the canonical article URL (isPermaLink="true")
 *   - media:content → absolute cover image URL, when present (Media RSS), so
 *                     media-aware readers (Feedly, Inoreader, …) show the cover.
 *
 * Data fetch: a bare server-side `fetch` (via the shared `fetchPublicJson`
 * helper), NOT the `storeApi` browser singleton (stateful token slot + storage
 * guards) — a server route handler must use the bare-fetch idiom and never the
 * browser client.
 *
 * Absolute URLs are built from `baseUrl()` (NEXT_PUBLIC_SITE_URL → production
 * fallback); cover images run through `resolveMediaUrl` so a raw S3 key becomes an
 * absolute URL. The response Content-Type is `application/rss+xml`.
 *
 * Resilience: the upstream fetch is best-effort. On any failure (API down, bad
 * shape, timeout) we still emit a VALID, EMPTY channel so feed readers and
 * validators get well-formed XML rather than a 500.
 */

import { baseUrl } from '@/lib/siteUrl';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { fetchPublicJson } from '@/lib/serverMetaUtil';

// Latest N articles in the feed — a feed is a recency window, not a full archive.
const FEED_LIMIT = 50;

// Refresh the feed at most every 15 min (ISR) rather than rebuilding per request.
export const revalidate = 900;

/** Permissive article row shape from the public list (open index). */
type ArticleRow = Record<string, unknown>;

/**
 * Escape the five XML predefined entities so arbitrary text is safe inside an
 * element body or attribute value. Applied to every dynamic string.
 */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Read a trimmed string property from an article row, else undefined. */
function str(a: ArticleRow, key: string): string | undefined {
  const v = a[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Format an ISO date string as RFC-822 (RSS pubDate), or undefined if invalid. */
function toRfc822(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toUTCString();
}

/**
 * An image URL is only usable in an RSS `media:content url=""` attribute if it is
 * an absolute http(s) (or protocol-relative) URL — `data:`/`blob:` are not
 * fetchable by feed readers. We also reject the XML-unsafe `<`/`>` (already
 * entity-escaped on emit, but keeping the attribute clean avoids odd readers
 * mishandling it). Returns the safe URL or undefined.
 */
function feedSafeImage(url: string | null): string | undefined {
  if (!url) return undefined;
  if (!(/^https?:\/\//i.test(url) || url.startsWith('//'))) return undefined;
  if (/[<>]/.test(url)) return undefined;
  return url;
}

export async function GET(): Promise<Response> {
  const base = baseUrl();
  const channelLink = `${base}/articles`;
  const feedSelf = `${base}/feed.xml`;

  let items: ArticleRow[] = [];
  try {
    // Bare server fetch (NOT the storeApi browser singleton). The public article
    // list returns `{ data: [...] }`, PUBLISHED only.
    const res = await fetchPublicJson(`/articles?limit=${FEED_LIMIT}`, revalidate);
    items = Array.isArray(res?.data) ? (res.data as ArticleRow[]) : [];
  } catch {
    items = [];
  }

  // lastBuildDate reflects the freshest article, not "now", so the channel-level
  // timestamp is stable across fetches when nothing has changed (enabling edge
  // caching) and only advances when new content is actually published.
  let latestMs = 0;
  for (const a of items) {
    const d = new Date(str(a, 'publishedAt') ?? '');
    const ms = d.getTime();
    if (!Number.isNaN(ms) && ms > latestMs) latestMs = ms;
  }
  const buildDate = (latestMs > 0 ? new Date(latestMs) : new Date()).toUTCString();

  const itemXml = items
    .map((a) => {
      const slug = str(a, 'slug');
      if (!slug) return null; // no slug → no stable link/guid, skip
      const url = `${base}/articles/${encodeURI(slug)}`;
      const title = str(a, 'title') ?? 'Untitled';
      const description = str(a, 'excerpt') ?? '';
      const pubDate = toRfc822(str(a, 'publishedAt'));
      // Cover image (resolved URL or raw S3 key) → absolute, feed-safe URL.
      const cover = feedSafeImage(
        resolveMediaUrl(str(a, 'coverUrl') ?? str(a, 'coverS3Key')),
      );
      return [
        '    <item>',
        `      <title>${xmlEscape(title)}</title>`,
        `      <link>${xmlEscape(url)}</link>`,
        `      <description>${xmlEscape(description)}</description>`,
        pubDate ? `      <pubDate>${pubDate}</pubDate>` : null,
        cover
          ? `      <media:content url="${xmlEscape(cover)}" medium="image" />`
          : null,
        `      <guid isPermaLink="true">${xmlEscape(url)}</guid>`,
        '    </item>',
      ]
        .filter((line): line is string => line !== null)
        .join('\n');
    })
    .filter((x): x is string => x !== null)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Aryavartham Journal</title>
    <link>${xmlEscape(channelLink)}</link>
    <description>The latest published articles from the Aryavartham Journal.</description>
    <language>en</language>
    <lastBuildDate>${buildDate}</lastBuildDate>
    <atom:link href="${xmlEscape(feedSelf)}" rel="self" type="application/rss+xml" />
${itemXml}
  </channel>
</rss>
`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900, s-maxage=3600',
    },
  });
}
