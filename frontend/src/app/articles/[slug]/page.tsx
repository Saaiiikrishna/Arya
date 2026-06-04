'use client';

/**
 * Public article detail page.
 *
 * - Fetches the article via storeApi.getArticle(slug); 404 → friendly not-found.
 * - Cover, title, author display, publishedAt.
 * - The untrusted `body` is rendered through the shared BlockRenderer (which
 *   sanitises RICH_TEXT html via DOMPurify and renders the other block types
 *   structurally). We NEVER dangerouslySetInnerHTML a raw backend string here.
 * - Article media (raw S3 keys) resolved to URLs and shown in a MediaGallery.
 * - Related articles via storeApi.getRelatedArticles as an ArticleCard row.
 * - On mount we record a page view for '/articles/{slug}' by reusing the app's
 *   existing tracker (trackCurrentPage) so store-jobs can bump viewCount. View
 *   counts are NEVER shown publicly.
 *
 * Next.js 16: route params are a Promise → unwrap with React `use()`.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion } from 'motion/react';
import { ArrowLeft, AlertCircle, Loader2, Newspaper, CalendarDays, UserRound } from 'lucide-react';
import Layout from '@/components/Layout';
import { ArticleCard, MediaGallery, JsonLd, type GalleryMedia } from '@/components/store';
// Imported directly (not via the barrel) so this page does not depend on the
// store barrel having been updated to re-export the renderer.
import BlockRenderer, { type ContentBlock } from '@/components/store/BlockRenderer';
import {
  storeApi,
  type ArticleDetail,
  type ArticleSummary,
} from '@/lib/storeApi';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { ApiError } from '@/lib/api';
import { trackCurrentPage } from '@/lib/tracker';

interface PageProps {
  // Next.js 16: dynamic route params are a Promise and must be unwrapped with
  // React `use()` (see the `use(params)` call below). This differs from the
  // Next 13/14 convention where `params` was a plain `{ slug: string }` object.
  params: Promise<{ slug: string }>;
}

/** Human-readable + machine ISO date, or null if unparseable. */
function formatDate(value: unknown): { label: string; iso: string } | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return {
    label: d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    iso: d.toISOString(),
  };
}

/** Pull the ordered block array from a permissive body shape. */
function blocksOf(body: ArticleDetail['body']): ContentBlock[] {
  if (!body || typeof body !== 'object') return [];
  const b = body as Record<string, unknown>;
  // Article bodies are stored as `{ blocks: [...] }` (ArticleDetail['body'] is a
  // `Record<string, unknown> | null`, so a bare top-level array is not reachable).
  if (Array.isArray(b.blocks)) return b.blocks as ContentBlock[];
  return [];
}

/** Resolve article media rows (raw s3Key / type / caption) to gallery items. */
function mediaOf(article: ArticleDetail): GalleryMedia[] {
  const raw = Array.isArray(article.media) ? article.media : [];
  const out: GalleryMedia[] = [];
  for (const item of raw) {
    const m = item as Record<string, unknown>;
    const url = resolveMediaUrl(
      (m.url as string | undefined) ?? (m.s3Key as string | undefined),
    );
    if (!url) continue;
    out.push({
      url,
      type: m.type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
      caption: typeof m.caption === 'string' ? m.caption : null,
      poster: resolveMediaUrl(
        (m.poster as string | undefined) ?? (m.posterS3Key as string | undefined),
      ),
    });
  }
  return out;
}

function authorNameOf(article: ArticleDetail): string | null {
  const direct = article.authorName;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const author = article.author as Record<string, unknown> | null | undefined;
  if (author) {
    const name =
      (author.name as string | undefined) ??
      [author.firstName, author.lastName].filter(Boolean).join(' ').trim();
    if (name && name.trim()) return name.trim();
  }
  return null;
}

/**
 * Build a schema.org BlogPosting structured-data object (rendered as JSON-LD).
 *
 * Only confidently-populatable fields are emitted; absent ones are omitted. ISO
 * dates come from the parsed publishedAt; the cover (already resolved to a URL) is
 * used as the article `image`. The object is OUR OWN data → safe to JSON-LD.
 */
function buildArticleJsonLd(
  article: ArticleDetail,
  coverUrl: string | null,
  authorName: string | null,
  publishedIso: string | null,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
  };

  if (typeof article.excerpt === 'string' && article.excerpt.trim()) {
    data.description = article.excerpt.trim();
  }
  if (coverUrl) data.image = [coverUrl];
  if (authorName) data.author = { '@type': 'Person', name: authorName };
  if (publishedIso) {
    data.datePublished = publishedIso;
    // No dedicated updatedAt is exposed publicly — mirror datePublished so the
    // required dateModified hint is present rather than omitted.
    const updated =
      typeof article.updatedAt === 'string' && article.updatedAt.trim()
        ? article.updatedAt.trim()
        : publishedIso;
    data.dateModified = updated;
  }
  if (Array.isArray(article.tags) && article.tags.length) {
    data.keywords = article.tags.join(', ');
  }

  return data;
}

export default function ArticleDetailPage({ params }: PageProps) {
  // Next.js 16: `params` is a Promise → unwrap with React `use()`.
  const { slug } = use(params);
  const router = useRouter();

  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [related, setRelated] = useState<ArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the latest in-flight fetch so a stale earlier response (e.g. after a
  // retry or slug change) can't overwrite a newer one. This replaces the previous
  // per-effect `cancelled` flag so `load` can be re-invoked imperatively by the
  // "Try again" button (which router.refresh() could NOT do — the fetch is
  // client-side and a RSC refresh does not re-run this effect).
  const reqIdRef = useRef(0);

  // The fetch lives in a callable function (not just inline in the effect) so the
  // error-state "Try again" button can re-run it directly.
  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setNotFound(false);
    setError(null);
    setArticle(null);
    setRelated([]);

    try {
      const data = await storeApi.getArticle(slug);
      if (reqId !== reqIdRef.current) return; // superseded by a newer fetch
      setArticle(data);

      // Related is best-effort — a failure must not blank the article.
      try {
        const rel = await storeApi.getRelatedArticles(slug);
        if (reqId === reqIdRef.current) setRelated(Array.isArray(rel) ? rel : []);
      } catch {
        if (reqId === reqIdRef.current) setRelated([]);
      }
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      if (e instanceof ApiError && e.status === 404) {
        setNotFound(true);
      } else {
        setError(
          e instanceof ApiError
            ? e.message
            : 'We could not load this article right now. Please try again.',
        );
      }
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Record a page view for '/articles/{slug}' once the article resolves. We reuse
  // the app-wide tracker, which reads window.location.pathname (already
  // /articles/{slug} by the time this renders) and de-dupes internally via its
  // module-level `lastTrackedPath` guard — so Strict Mode's dev double-invoke and
  // any re-render with the same path collapse to a single network call. We rely on
  // that single source of truth rather than a second local ref-based debounce.
  // View counts are never displayed publicly.
  useEffect(() => {
    if (article) trackCurrentPage();
  }, [article]);

  const blocks = useMemo(() => (article ? blocksOf(article.body) : []), [article]);
  const media = useMemo(() => (article ? mediaOf(article) : []), [article]);
  const coverUrl = useMemo(
    () =>
      article
        ? resolveMediaUrl(
            (article.coverUrl as string | null | undefined) ??
              (article.coverS3Key as string | null | undefined),
          )
        : null,
    [article],
  );
  const dateInfo = article ? formatDate(article.publishedAt) : null;
  const authorName = article ? authorNameOf(article) : null;

  return (
    <Layout activeTab="articles">
      <div className="mkt relative overflow-hidden bg-parchment min-h-[calc(100vh-80px)]">
        <div
          aria-hidden
          className="mkt-float mkt-glow-pulse pointer-events-none absolute -top-28 -left-24 w-[30rem] h-[30rem] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(255,176,104,0.16), transparent 62%)' }}
        />

        <div className="relative z-10 mx-auto max-w-3xl px-4 py-12 sm:px-6 md:px-8 md:py-16">
          <button
            type="button"
            onClick={() => router.push('/articles')}
            className="mb-8 inline-flex items-center gap-2 font-sans text-[11px] uppercase tracking-[0.1em] text-ink/55 transition-colors hover:text-saffron-deep"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to the journal</span>
          </button>

          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-28 text-ink/50">
              <Loader2 className="h-7 w-7 animate-spin text-saffron" aria-hidden />
              <span className="font-sans text-sm">Loading article…</span>
            </div>
          ) : notFound ? (
            // DESIGN: intentional mkt-* exception — a static not-found panel (glass
            // info card, no hover lift). In-scope inside `.mkt` (DESIGN.md §7).
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-hairline bg-white/50 px-8 py-16 text-center backdrop-blur">
              <Newspaper className="h-10 w-10 text-ink/25" aria-hidden />
              <h1 className="font-serif text-2xl text-forest">Article not found</h1>
              <p className="font-sans text-sm text-ink/60">
                This article may have been moved, unpublished, or never existed.
              </p>
              <button
                type="button"
                onClick={() => router.push('/articles')}
                className="mkt-btn !py-2.5 !px-5"
              >
                <span>Browse the journal</span>
              </button>
            </div>
          ) : error ? (
            // DESIGN: intentional mkt-* exception — a static error panel, not an
            // interactive mkt-card. In-scope inside `.mkt` (DESIGN.md §7).
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-terracotta/30 bg-terracotta/[0.04] px-8 py-14 text-center">
              <AlertCircle className="h-8 w-8 text-terracotta" aria-hidden />
              <p className="font-sans text-sm text-ink/75">{error}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="mkt-btn-ghost !py-2.5 !px-5"
              >
                <span>Try again</span>
              </button>
            </div>
          ) : article ? (
            <motion.article
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            >
              {/* schema.org BlogPosting structured data (JSON-LD) for SEO. */}
              <JsonLd
                data={buildArticleJsonLd(
                  article,
                  coverUrl,
                  authorName,
                  dateInfo?.iso ?? null,
                )}
              />

              {/* Tags */}
              {article.tags && article.tags.length > 0 && (
                <div className="mb-5 flex flex-wrap gap-1.5">
                  {article.tags.slice(0, 6).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => router.push(`/articles?tag=${encodeURIComponent(t)}`)}
                      className="rounded-full bg-saffron-glow/30 px-2.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.06em] text-saffron-deep transition-colors hover:bg-saffron-glow/50"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}

              {/* Title */}
              <h1 className="font-serif-display font-bold text-3xl sm:text-4xl md:text-5xl text-forest leading-[1.02] tracking-[-0.02em]">
                {article.title}
              </h1>

              {/* Byline */}
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-sans text-[12px] uppercase tracking-[0.06em] text-ink/50">
                {authorName && (
                  <span className="inline-flex items-center gap-1.5">
                    <UserRound className="h-3.5 w-3.5" aria-hidden />
                    {authorName}
                  </span>
                )}
                {dateInfo && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                    <time dateTime={dateInfo.iso}>{dateInfo.label}</time>
                  </span>
                )}
              </div>

              {/* Excerpt as a lede */}
              {article.excerpt && (
                <p className="mt-7 font-serif text-xl italic leading-relaxed text-forest-soft">
                  {article.excerpt}
                </p>
              )}

              {/* Cover — the parent reserves a 16/9 box (matching ArticleCard) so
                  the image load does not cause Cumulative Layout Shift. */}
              {coverUrl && (
                <div className="relative mt-9 aspect-[16/9] overflow-hidden rounded-2xl border border-hairline bg-parchment-dark">
                  {/* next/image: the resolved cover host (S3/CDN/localhost) is in
                      next.config remotePatterns, so the original raw <img> bypass
                      is unnecessary. `fill` is safe — the parent reserves the 16/9
                      box and clips overflow. `priority` because this hero cover is
                      the above-the-fold LCP element on the article page. */}
                  <Image
                    src={coverUrl}
                    alt={article.title}
                    fill
                    sizes="(min-width: 768px) 48rem, 100vw"
                    priority
                    className="object-cover"
                  />
                </div>
              )}

              {/* Body — sanitised + structural via the shared renderer */}
              <div className="mt-10">
                <BlockRenderer blocks={blocks} />
              </div>

              {/* Article media gallery */}
              {media.length > 0 && (
                <section className="mt-12">
                  <h2 className="mb-4 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-saffron-deep">
                    Gallery
                  </h2>
                  <MediaGallery media={media} mkt aspect="aspect-video" />
                </section>
              )}
            </motion.article>
          ) : null}
        </div>

        {/* Related — full-width strip below the reading column */}
        {!loading && !notFound && !error && article && related.length > 0 && (
          <div className="relative z-10 mx-auto max-w-screen-2xl px-4 pb-20 sm:px-6 md:px-8 3xl:max-w-[110rem]">
            <div className="border-t border-hairline pt-12">
              <h2 className="mb-6 font-serif text-2xl text-forest">Keep reading</h2>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-4">
                {related.map((r) => (
                  <ArticleCard
                    key={r.id}
                    title={r.title}
                    href={`/articles/${r.slug}`}
                    excerpt={r.excerpt}
                    coverUrl={resolveMediaUrl(
                      (r.coverUrl as string | null | undefined) ??
                        (r.coverS3Key as string | null | undefined),
                    )}
                    date={r.publishedAt}
                    author={
                      typeof r.authorName === 'string' && r.authorName.trim()
                        ? r.authorName.trim()
                        : null
                    }
                    tags={r.tags}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
