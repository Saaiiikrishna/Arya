'use client';

/**
 * Public articles index — paginated, filterable list of PUBLISHED articles.
 *
 * Data via storeApi.listArticles (page/limit/tag/category/search). The backend
 * returns RAW S3 keys (coverS3Key), so covers are resolved through
 * resolveMediaUrl before being handed to ArticleCard. Featured articles (server
 * `featured` — the field declared on ArticleSummary) are surfaced in a hero strip
 * and flow through the normal grid. Loading / empty / error states are handled.
 *
 * `useSearchParams` lives in an inner component wrapped in <Suspense> (the repo
 * convention — see apply/success), so the page does not bail out of static
 * rendering. Public marketing surface → `.mkt` premium layer inside Layout
 * (activeTab='articles').
 */

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { Search, X, Newspaper, AlertCircle, Loader2, PenLine } from 'lucide-react';
import Layout from '@/components/Layout';
import { ArticleCard, Pagination } from '@/components/store';
import { storeApi, type ArticleSummary } from '@/lib/storeApi';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { ApiError } from '@/lib/api';

const PAGE_SIZE = 12;

/** Read an article's cover from either a resolved URL or a raw S3 key. */
function coverOf(a: ArticleSummary): string | null {
  return resolveMediaUrl(
    (a.coverUrl as string | null | undefined) ??
      (a.coverS3Key as string | null | undefined),
  );
}

function authorOf(a: ArticleSummary): string | null {
  const name = a.authorName;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

function ArticlesIndex() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL is the source of truth for filters so a filtered list is shareable.
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const tag = searchParams.get('tag') || '';
  const category = searchParams.get('category') || '';
  const search = searchParams.get('search') || '';

  // Local search box mirrors the URL `search` but is committed on submit.
  const [searchInput, setSearchInput] = useState(search);

  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [featured, setFeatured] = useState<ArticleSummary[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tag chips harvested from results — the backend has no tag-catalog endpoint.
  const [knownTags, setKnownTags] = useState<string[]>([]);

  // Keep the search box in sync if the URL changes via back/forward nav.
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  // Track the latest request so a slow earlier fetch can't overwrite a newer one.
  // NOTE: this is a ref, not state — it MUST NOT be added to `load`'s useCallback
  // deps (doing so would recreate `load` on every fetch and defeat the dedup).
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await storeApi.listArticles({
        page,
        limit: PAGE_SIZE,
        tag: tag || undefined,
        category: category || undefined,
        search: search || undefined,
      });
      if (reqId !== reqIdRef.current) return; // a newer request superseded this one

      const data = Array.isArray(res.data) ? res.data : [];
      setArticles(data);

      const metaTotal = Number(res.meta?.total ?? data.length);
      const metaPages = Number(
        res.meta?.totalPages ?? Math.max(1, Math.ceil(metaTotal / PAGE_SIZE)),
      );
      setTotal(Number.isFinite(metaTotal) ? metaTotal : data.length);
      setTotalPages(Number.isFinite(metaPages) && metaPages > 0 ? metaPages : 1);

      // Featured strip only on the unfiltered first page — it is an editorial
      // entry point, not a property of a filtered/paged result.
      const isUnfiltered = page === 1 && !tag && !category && !search;
      setFeatured(
        isUnfiltered ? data.filter((a) => Boolean(a.featured)).slice(0, 3) : [],
      );

      // Harvest tag chips from results (de-duped).
      const tagSet = new Set<string>();
      for (const a of data) {
        for (const t of a.tags ?? []) {
          if (typeof t === 'string' && t.trim()) tagSet.add(t.trim());
        }
      }
      setKnownTags(Array.from(tagSet).slice(0, 18));
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      const msg =
        e instanceof ApiError
          ? e.message
          : 'We could not load the journal right now. Please try again.';
      setError(msg);
      setArticles([]);
      setFeatured([]);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [page, tag, category, search]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── URL mutation helpers ──────────────────────────────────────────────────

  const pushParams = useCallback(
    (next: Record<string, string | number | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === '' || v === undefined) params.delete(k);
        else params.set(k, String(v));
      }
      const q = params.toString();
      router.push(q ? `/articles?${q}` : '/articles');
    },
    [router, searchParams],
  );

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    pushParams({ search: searchInput.trim() || null, page: null });
  };

  const onPageChange = (next: number) => {
    pushParams({ page: next <= 1 ? null : next });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const selectTag = (t: string) => {
    pushParams({ tag: tag === t ? null : t, page: null });
  };

  const clearFilters = () => router.push('/articles');

  const hasActiveFilters = Boolean(tag || category || search);

  const featuredIds = useMemo(() => new Set(featured.map((f) => f.id)), [featured]);
  // Avoid showing a featured article twice (hero + grid) on the unfiltered page.
  const gridArticles = useMemo(
    () => articles.filter((a) => !featuredIds.has(a.id)),
    [articles, featuredIds],
  );

  return (
    <div className="mkt relative overflow-hidden bg-parchment min-h-[calc(100vh-80px)]">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="mkt-float mkt-glow-pulse pointer-events-none absolute -top-32 -right-24 w-[34rem] h-[34rem] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(244,163,0,0.18), transparent 62%)' }}
      />

      <div className="relative z-10 mx-auto max-w-screen-2xl px-6 py-14 md:px-8 md:py-20">
        {/* ── Header ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between"
        >
          <div className="max-w-2xl">
            <div className="mkt-pill mb-5">
              <Newspaper className="h-3.5 w-3.5 text-saffron-deep" />
              <span className="font-sans text-[10px] uppercase tracking-[0.22em] font-bold text-forest/80">
                The Journal
              </span>
            </div>
            <h1 className="font-serif-display font-bold text-5xl md:text-6xl text-forest leading-[0.95] tracking-[-0.025em]">
              Build logs &amp; teardowns
            </h1>
            <p className="mt-5 font-sans text-ink/70 text-lg leading-relaxed">
              Hard-won lessons, step-by-step builds, and field notes from the
              community. Read deeply — then publish your own.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push('/articles/submit')}
            className="mkt-btn shrink-0"
          >
            <PenLine className="h-4 w-4" />
            <span>Write an article</span>
          </button>
        </motion.div>

        {/* ── Search + filters ───────────────────────────────────── */}
        <div className="mt-10 flex flex-col gap-5">
          <form onSubmit={onSearchSubmit} className="flex w-full max-w-xl items-center gap-3">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40"
                aria-hidden
              />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search the journal…"
                aria-label="Search articles"
                className="w-full rounded-full border border-hairline bg-white/70 py-3 pl-11 pr-4 font-sans text-sm text-ink placeholder:text-ink/40 outline-none backdrop-blur transition-colors focus:border-saffron"
              />
            </div>
            <button type="submit" className="mkt-btn shrink-0 !px-6 !py-3">
              <span>Search</span>
            </button>
          </form>

          {(knownTags.length > 0 || hasActiveFilters) && (
            <div className="flex flex-wrap items-center gap-2">
              {category && (
                <button
                  type="button"
                  onClick={() => pushParams({ category: null, page: null })}
                  className="inline-flex items-center gap-1.5 rounded-full bg-forest px-3 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-parchment"
                >
                  {category}
                  <X className="h-3 w-3" />
                </button>
              )}
              {knownTags.map((t) => {
                const active = tag === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => selectTag(t)}
                    aria-pressed={active}
                    className={
                      active
                        ? 'inline-flex items-center gap-1.5 rounded-full bg-forest px-3 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-parchment'
                        : 'rounded-full border border-hairline bg-white/60 px-3 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-ink/65 backdrop-blur transition-colors hover:border-saffron hover:text-saffron-deep'
                    }
                  >
                    {t}
                    {active && <X className="h-3 w-3" />}
                  </button>
                );
              })}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="font-sans text-[11px] uppercase tracking-[0.06em] text-ink/45 underline-offset-2 transition-colors hover:text-terracotta hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Featured strip ─────────────────────────────────────── */}
        {!loading && !error && featured.length > 0 && (
          <section className="mt-14">
            <h2 className="mb-5 font-sans text-[11px] font-bold uppercase tracking-[0.18em] text-saffron-deep">
              Featured
            </h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {featured.map((a) => (
                <ArticleCard
                  key={a.id}
                  title={a.title}
                  href={`/articles/${a.slug}`}
                  excerpt={a.excerpt}
                  coverUrl={coverOf(a)}
                  date={a.publishedAt}
                  author={authorOf(a)}
                  tags={a.tags}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Main list ──────────────────────────────────────────── */}
        <section className="mt-14">
          {!loading && !error && (
            <div className="mb-6 flex items-baseline justify-between">
              <h2 className="font-serif text-2xl text-forest">
                {hasActiveFilters ? 'Results' : 'All articles'}
              </h2>
              {total > 0 && (
                <span className="font-sans text-[11px] uppercase tracking-[0.08em] text-ink/45">
                  {total} {total === 1 ? 'article' : 'articles'}
                </span>
              )}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-28 text-ink/50">
              <Loader2 className="h-7 w-7 animate-spin text-saffron" aria-hidden />
              <span className="font-sans text-sm">Loading the journal…</span>
            </div>
          ) : error ? (
            // DESIGN: intentional mkt-* exception — a static error panel, not an
            // interactive mkt-card (no hover lift). `rounded-2xl` is in-scope here
            // because it lives inside the `.mkt` wrapper (DESIGN.md §7).
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-terracotta/30 bg-terracotta/[0.04] px-8 py-14 text-center">
              <AlertCircle className="h-8 w-8 text-terracotta" aria-hidden />
              <p className="font-sans text-sm text-ink/75">{error}</p>
              <button type="button" onClick={() => void load()} className="mkt-btn-ghost !py-2.5 !px-5">
                <span>Try again</span>
              </button>
            </div>
          ) : gridArticles.length === 0 && featured.length === 0 ? (
            // DESIGN: intentional mkt-* exception — a static empty-state panel
            // (glass info card, no hover lift). In-scope inside `.mkt` (DESIGN.md §7).
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-hairline bg-white/50 px-8 py-16 text-center backdrop-blur">
              <Newspaper className="h-9 w-9 text-ink/25" aria-hidden />
              <h3 className="font-serif text-xl text-forest">
                {hasActiveFilters ? 'No articles match those filters' : 'No articles yet'}
              </h3>
              <p className="font-sans text-sm text-ink/60">
                {hasActiveFilters
                  ? 'Try a different search or clear the filters to see everything.'
                  : 'The journal is just getting started. Be the first to publish.'}
              </p>
              {hasActiveFilters ? (
                <button type="button" onClick={clearFilters} className="mkt-btn-ghost !py-2.5 !px-5">
                  <span>Clear filters</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => router.push('/articles/submit')}
                  className="mkt-btn !py-2.5 !px-5"
                >
                  <PenLine className="h-4 w-4" />
                  <span>Write the first article</span>
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {gridArticles.map((a) => (
                  <ArticleCard
                    key={a.id}
                    title={a.title}
                    href={`/articles/${a.slug}`}
                    excerpt={a.excerpt}
                    coverUrl={coverOf(a)}
                    date={a.publishedAt}
                    author={authorOf(a)}
                    tags={a.tags}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="mt-14">
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    onPageChange={onPageChange}
                    mkt
                  />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** Lightweight fallback while the search-params-dependent index hydrates. */
function ArticlesFallback() {
  return (
    <div className="mkt relative bg-parchment min-h-[calc(100vh-80px)]">
      <div className="flex flex-col items-center justify-center gap-3 py-40 text-ink/50">
        <Loader2 className="h-7 w-7 animate-spin text-saffron" aria-hidden />
        <span className="font-sans text-sm">Loading the journal…</span>
      </div>
    </div>
  );
}

export default function ArticlesPage() {
  return (
    <Layout activeTab="articles">
      <Suspense fallback={<ArticlesFallback />}>
        <ArticlesIndex />
      </Suspense>
    </Layout>
  );
}
