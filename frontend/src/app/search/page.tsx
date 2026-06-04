'use client';

/**
 * Global search page (/search?q=).
 *
 * Queries BOTH the product catalog (storeApi.listProducts({ search })) and the
 * journal (storeApi.listArticles({ search })) for the `q` term and renders two
 * result groups (Products → ProductCard, Articles → ArticleCard). Public
 * marketing surface → `.mkt` premium layer inside the shared Layout.
 *
 * `useSearchParams` lives in an inner component wrapped in <Suspense> (the repo
 * convention) so the page does not bail out of static rendering.
 */

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { Search, X, Loader2, SearchX, ShoppingBag, Newspaper } from 'lucide-react';
import Layout from '@/components/Layout';
import { ProductCard, ArticleCard } from '@/components/store';
import {
  storeApi,
  type ProductSummary,
  type ArticleSummary,
} from '@/lib/storeApi';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { ApiError } from '@/lib/api';

const RESULT_LIMIT = 12;

// ── Defensive mappers (open-index DTOs) ──────────────────────────────────────

function productImage(p: ProductSummary): string | null {
  return p.primaryImageUrl ?? p.thumbnail?.url ?? null;
}

function productAlt(p: ProductSummary): string | undefined {
  return p.thumbnail?.altText ?? p.thumbnail?.caption ?? undefined;
}

function productCategoryLabel(p: ProductSummary): string | null {
  return typeof p.category === 'string' ? p.category : null;
}

function productRating(p: ProductSummary): { average: number | null; count: number | null } {
  const avg = (p as Record<string, unknown>).ratingAverage;
  const count = (p as Record<string, unknown>).ratingCount;
  return {
    average: typeof avg === 'number' && Number.isFinite(avg) ? avg : null,
    count: typeof count === 'number' && Number.isFinite(count) ? count : null,
  };
}

function articleCover(a: ArticleSummary): string | null {
  return resolveMediaUrl(
    (a.coverUrl as string | null | undefined) ??
      (a.coverS3Key as string | null | undefined),
  );
}

function articleAuthor(a: ArticleSummary): string | null {
  const name = a.authorName;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

// ── Inner (search-params dependent) ───────────────────────────────────────────

function SearchIndex() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = (searchParams.get('q') || '').trim();

  const [input, setInput] = useState(q);

  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the input in sync with back/forward URL changes.
  useEffect(() => {
    setInput(q);
  }, [q]);

  // Track the latest request so a slow earlier fetch can't overwrite a newer one.
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!q) {
      setProducts([]);
      setArticles([]);
      setError(null);
      setLoading(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      // Both groups run in parallel; settle so one failing group does not blank
      // the other.
      const [prodRes, artRes] = await Promise.allSettled([
        storeApi.listProducts({ search: q, limit: RESULT_LIMIT }),
        storeApi.listArticles({ search: q, limit: RESULT_LIMIT }),
      ]);
      if (reqId !== reqIdRef.current) return; // superseded

      const prods =
        prodRes.status === 'fulfilled' && Array.isArray(prodRes.value.data)
          ? prodRes.value.data
          : [];
      const arts =
        artRes.status === 'fulfilled' && Array.isArray(artRes.value.data)
          ? artRes.value.data
          : [];
      setProducts(prods);
      setArticles(arts);

      // Only surface an error if BOTH groups failed — a single failure still
      // shows the other group's results.
      if (prodRes.status === 'rejected' && artRes.status === 'rejected') {
        const e = prodRes.reason;
        setError(
          e instanceof ApiError
            ? e.message
            : 'We could not run your search right now. Please try again.',
        );
      }
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setError(
        e instanceof ApiError
          ? e.message
          : 'We could not run your search right now. Please try again.',
      );
      setProducts([]);
      setArticles([]);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = input.trim();
    router.push(next ? `/search?q=${encodeURIComponent(next)}` : '/search');
  };

  const totalResults = products.length + articles.length;
  const hasQuery = q.length > 0;

  return (
    <div className="mkt relative overflow-hidden bg-parchment min-h-[calc(100vh-80px)]">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="mkt-float mkt-glow-pulse pointer-events-none absolute -top-32 -right-24 h-[34rem] w-[34rem] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(244,163,0,0.18), transparent 62%)' }}
      />

      <div className="relative z-10 mx-auto max-w-screen-2xl px-4 py-14 sm:px-6 md:px-8 md:py-20 3xl:max-w-[110rem]">
        {/* ── Header + search box ───────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl"
        >
          <div className="mkt-pill mb-5">
            <Search className="h-3.5 w-3.5 text-saffron-deep" />
            <span className="font-sans text-[10px] uppercase tracking-[0.22em] font-bold text-forest/80">
              Search
            </span>
          </div>
          <h1 className="font-serif-display font-bold text-4xl sm:text-5xl md:text-6xl text-forest leading-[0.95] tracking-[-0.025em]">
            {hasQuery ? 'Search results' : 'Search the workshop'}
          </h1>
          <p className="mt-5 font-sans text-ink/70 text-base sm:text-lg leading-relaxed">
            Find products and articles across the store and the journal.
          </p>

          <form onSubmit={onSubmit} className="mt-8 flex w-full items-center gap-3">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40"
                aria-hidden
              />
              <input
                type="search"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Search products and articles…"
                aria-label="Search products and articles"
                autoFocus
                className="w-full border border-hairline bg-alabaster py-3.5 pl-11 pr-10 font-sans text-sm text-ink placeholder:text-ink/40 outline-none transition-colors focus:border-saffron"
              />
              {input && (
                <button
                  type="button"
                  onClick={() => setInput('')}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 transition-colors hover:text-terracotta"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <button type="submit" className="mkt-btn mkt-btn-sm shrink-0">
              <span>Search</span>
            </button>
          </form>

          {hasQuery && !loading && !error && (
            <p className="mt-5 font-sans text-[11px] uppercase tracking-[0.1em] text-ink/45">
              {totalResults} {totalResults === 1 ? 'result' : 'results'} for “{q}”
            </p>
          )}
        </motion.div>

        {/* ── States ────────────────────────────────────────────── */}
        {!hasQuery ? (
          // DESIGN: intentional mkt-* exception — a static prompt panel (no hover
          // lift). The rounded-2xl is in-scope inside the `.mkt` wrapper (DESIGN.md
          // §7); the surface is matte (bg-alabaster + 1px hairline), NOT frosted
          // glass, per the matte directive.
          <div className="mt-16 mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-hairline bg-alabaster px-8 py-16 text-center">
            <Search className="h-9 w-9 text-ink/25" aria-hidden />
            <p className="font-sans text-sm text-ink/60">
              Type a search term above to look across products and articles.
            </p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-28 text-ink/50">
            <Loader2 className="h-7 w-7 animate-spin text-saffron" aria-hidden />
            <span className="font-sans text-sm">Searching…</span>
          </div>
        ) : error ? (
          // DESIGN: intentional mkt-* exception — a static error panel, not an
          // interactive mkt-card. The rounded-2xl is in-scope inside the `.mkt`
          // wrapper (DESIGN.md §7).
          <div className="mt-16 mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-terracotta/30 bg-terracotta/[0.04] px-8 py-14 text-center">
            <SearchX className="h-8 w-8 text-terracotta" aria-hidden />
            <p className="font-sans text-sm text-ink/75">{error}</p>
            <button type="button" onClick={() => void load()} className="mkt-btn-ghost mkt-btn-sm">
              <span>Try again</span>
            </button>
          </div>
        ) : totalResults === 0 ? (
          // DESIGN: intentional mkt-* exception — a static empty-state panel (no
          // hover lift). The rounded-2xl is in-scope inside the `.mkt` wrapper
          // (DESIGN.md §7); the surface is matte (bg-alabaster + 1px hairline), NOT
          // frosted glass, per the matte directive.
          <div className="mt-16 mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-hairline bg-alabaster px-8 py-16 text-center">
            <SearchX className="h-9 w-9 text-ink/25" aria-hidden />
            <h3 className="font-serif text-xl text-forest">No results for “{q}”</h3>
            <p className="font-sans text-sm text-ink/60">
              Try a different term or check your spelling.
            </p>
          </div>
        ) : (
          <div className="mt-14 flex flex-col gap-16">
            {/* ── Products group ──────────────────────────────────── */}
            {products.length > 0 && (
              <section>
                <div className="mb-6 flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4 text-saffron-deep" aria-hidden />
                  <h2 className="font-serif text-2xl text-forest">Products</h2>
                  <span className="font-sans text-[11px] uppercase tracking-[0.08em] text-ink/45">
                    ({products.length})
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 3xl:grid-cols-5">
                  {products.map((p, i) => {
                    const rating = productRating(p);
                    return (
                      <ProductCard
                        key={p.id}
                        name={p.name}
                        href={`/store/${p.slug}`}
                        imageUrl={productImage(p)}
                        imageAlt={productAlt(p)}
                        priceFrom={p.priceFrom ?? null}
                        priceTo={p.priceTo ?? null}
                        eyebrow={p.brand ?? productCategoryLabel(p) ?? null}
                        subtitle={p.subtitle ?? null}
                        ratingAverage={rating.average}
                        ratingCount={rating.count}
                        priority={i === 0}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Articles group ──────────────────────────────────── */}
            {articles.length > 0 && (
              <section>
                <div className="mb-6 flex items-center gap-2">
                  <Newspaper className="h-4 w-4 text-saffron-deep" aria-hidden />
                  <h2 className="font-serif text-2xl text-forest">Articles</h2>
                  <span className="font-sans text-[11px] uppercase tracking-[0.08em] text-ink/45">
                    ({articles.length})
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-4">
                  {articles.map((a, i) => (
                    <ArticleCard
                      key={a.id}
                      title={a.title}
                      href={`/articles/${a.slug}`}
                      excerpt={a.excerpt}
                      coverUrl={articleCover(a)}
                      date={a.publishedAt}
                      author={articleAuthor(a)}
                      tags={a.tags}
                      priority={products.length === 0 && i === 0}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Lightweight fallback while the search-params-dependent index hydrates. */
function SearchFallback() {
  return (
    <div className="mkt relative bg-parchment min-h-[calc(100vh-80px)]">
      <div className="flex flex-col items-center justify-center gap-3 py-40 text-ink/50">
        <Loader2 className="h-7 w-7 animate-spin text-saffron" aria-hidden />
        <span className="font-sans text-sm">Loading search…</span>
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Layout activeTab="store">
      <Suspense fallback={<SearchFallback />}>
        <SearchIndex />
      </Suspense>
    </Layout>
  );
}
