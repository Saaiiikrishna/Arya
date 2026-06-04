/**
 * Article DETAIL layout (server component) — per-article SEO metadata.
 *
 * Next 16 runs `generateMetadata` on the SERVER for /articles/[slug] and writes
 * the tags into the initial <head>, so crawlers and unfurlers see real
 * per-article title/description/OG (type 'article' with author + publishedTime)
 * WITHOUT touching the client page body (page.tsx stays a client component that
 * fetches its own data for the interactive reader).
 *
 * Data: a direct server-side `fetch` to the public article endpoint
 * (`GET {NEXT_PUBLIC_API_URL}/articles/:slug` — note articles are mounted at the
 * root, NOT under /store). We do NOT import the storeApi client (stateful
 * browser client). A bare server fetch is the correct tool here.
 *
 * Resilience: any failure (API down at build, 404, bad shape) falls back to a
 * generic journal title rather than throwing — metadata must never break render.
 *
 * `metadataBase` (root layout) makes the relative canonical/og url absolute.
 */

import type { Metadata } from 'next';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { str, fetchPublicJson } from '@/lib/serverMetaUtil';

// Published articles change rarely once live — revalidate hourly so edits
// propagate without a redeploy while keeping crawl-time fetches off the hot path.
export const revalidate = 3600;

// Cap the derived author name embedded in <head> metadata. There is no confirmed
// server-side length bound on the author name column, so a pathologically long
// value would bloat the page head; 120 chars is a sane display limit.
const AUTHOR_NAME_MAX = 120;

/** Coerce a value to an ISO 8601 string if it parses as a date, else null. */
function isoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Best-effort server fetch of a single article by slug; null on any failure. */
async function fetchArticle(
  slug: string,
): Promise<Record<string, unknown> | null> {
  // Shared bare server fetch (ties to this route's ISR window); never throws.
  return fetchPublicJson(`/articles/${encodeURIComponent(slug)}`, revalidate);
}

/**
 * Display author name from `authorName` or a nested `author` object, else null.
 * The result is length-capped (AUTHOR_NAME_MAX) before it is embedded in the
 * <head> metadata so an oversized stored name can't bloat the page head.
 */
function authorNameOf(article: Record<string, unknown>): string | null {
  const direct = str(article.authorName);
  let name = direct;
  if (!name) {
    const author = article.author;
    if (author && typeof author === 'object') {
      const a = author as Record<string, unknown>;
      name =
        str(a.name) ??
        str([a.firstName, a.lastName].filter(Boolean).join(' '));
    }
  }
  if (!name) return null;
  return name.length > AUTHOR_NAME_MAX
    ? name.slice(0, AUTHOR_NAME_MAX).trimEnd()
    : name;
}

export async function generateMetadata({
  params,
}: {
  // Next 16: route params are async and MUST be awaited.
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await fetchArticle(slug);

  const canonicalPath = `/articles/${encodeURI(slug)}`;

  // Graceful fallback when the article can't be fetched (build-time, 404, etc.).
  if (!article) {
    return {
      title: 'Article',
      description: 'Read essays and field reports on the Aryavartham journal.',
      alternates: { canonical: canonicalPath },
    };
  }

  const title = str(article.title) ?? 'Article';
  const description =
    str(article.excerpt) ?? `Read "${title}" on the Aryavartham journal.`;
  const cover = resolveMediaUrl(
    (str(article.coverUrl) ?? str(article.coverS3Key)) ?? undefined,
  );
  const images = cover ? [{ url: cover, alt: title }] : undefined;

  const author = authorNameOf(article);
  const publishedTime =
    isoDate(article.publishedAt) ?? isoDate(article.createdAt) ?? undefined;
  // No dedicated public updatedAt is guaranteed — mirror publishedTime when the
  // explicit modified date is absent so the hint is present rather than omitted.
  const modifiedTime = isoDate(article.updatedAt) ?? publishedTime;
  const tags = Array.isArray(article.tags)
    ? (article.tags.filter((t) => typeof t === 'string') as string[])
    : undefined;

  return {
    title,
    description,
    authors: author ? [{ name: author }] : undefined,
    keywords: tags && tags.length ? tags : undefined,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title,
      description,
      url: canonicalPath,
      type: 'article',
      images,
      publishedTime,
      modifiedTime,
      authors: author ? [author] : undefined,
      tags,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: cover ? [cover] : undefined,
    },
  };
}

export default function ArticleDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
