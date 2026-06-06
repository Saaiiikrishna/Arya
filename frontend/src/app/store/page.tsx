'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Search,
  SlidersHorizontal,
  X,
  ShoppingBag,
  PackageOpen,
  AlertTriangle,
  RotateCw,
} from 'lucide-react';
import Layout from '@/components/Layout';
import { ProductCard, Pagination } from '@/components/store';
import { cn } from '@/lib/cn';
import {
  storeApi,
  type ProductSummary,
  type ProductListResponse,
} from '@/lib/storeApi';
import { ApiError } from '@/lib/api';

/**
 * Public STOREFRONT CATALOG (/store).
 *
 * Premium marketing surface (DESIGN.md §7 `mkt-*` layer) wrapped in a `.mkt`
 * container inside the shared Layout (activeTab='store'). Drives the public
 * catalog via `storeApi.listProducts(params)` — the ONLY data source here.
 *
 * Filters → category (slug), tag, free-text search (debounced), sort, plus
 * server-side pagination via the `{ data, meta }` envelope. Every async surface
 * has explicit loading / empty / error states. All prices are integer paise and
 * rendered through <Money/>; availability via <StockBadge/> (inside ProductCard).
 */

const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 350;

type SortKey = 'featured' | 'newest' | 'price_asc' | 'price_desc' | 'popular';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'featured', label: 'Curated' },
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most popular' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
];

/** A flattened category option for the filter chips (root + nested children). */
interface CategoryOption {
  slug: string;
  name: string;
  depth: number;
}

/** Loosely-typed node from storeApi.getCategories() (a nested root array). */
interface CategoryNode {
  id?: string;
  slug?: string;
  name?: string;
  children?: CategoryNode[];
}

/** Depth-first flatten of the category tree into a single ordered list. */
function flattenCategories(nodes: CategoryNode[], depth = 0): CategoryOption[] {
  const out: CategoryOption[] = [];
  for (const node of nodes) {
    if (node && typeof node.slug === 'string' && typeof node.name === 'string') {
      out.push({ slug: node.slug, name: node.name, depth });
    }
    if (Array.isArray(node?.children) && node.children.length) {
      out.push(...flattenCategories(node.children, depth + 1));
    }
  }
  return out;
}

/** Resolve a product's display image from the list payload (defensive). */
function resolveImage(p: ProductSummary): string | null {
  return p.primaryImageUrl ?? p.thumbnail?.url ?? null;
}

/** Resolve an alt text for the thumbnail, if present. */
function resolveAlt(p: ProductSummary): string | undefined {
  return p.thumbnail?.altText ?? p.thumbnail?.caption ?? undefined;
}

/**
 * Resolve the eyebrow category label. On the LIST payload `category` is the
 * denormalised name string (§2.2); guard the union so the (theoretical) detail
 * object form is ignored rather than rendered as `[object Object]`.
 */
function resolveCategoryLabel(p: ProductSummary): string | null {
  return typeof p.category === 'string' ? p.category : null;
}

/** Read the denormalised rating average/count off the (open-index) list item. */
function resolveRating(p: ProductSummary): { average: number | null; count: number | null } {
  const avg = (p as Record<string, unknown>).ratingAverage;
  const count = (p as Record<string, unknown>).ratingCount;
  return {
    average: typeof avg === 'number' && Number.isFinite(avg) ? avg : null,
    count: typeof count === 'number' && Number.isFinite(count) ? count : null,
  };
}

export default function StorePage() {
  // ── Filter / query state ──────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState(''); // debounced value sent to the API
  const [category, setCategory] = useState<string>(''); // category slug ('' = all)
  const [tag, setTag] = useState<string>(''); // single tag filter ('' = none)
  const [sort, setSort] = useState<SortKey>('featured');
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ── Data state ────────────────────────────────────────────
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Categories (for the filter rail) ──────────────────────
  const [categories, setCategories] = useState<CategoryOption[]>([]);

  // De-dupes/ignores stale responses when filters change rapidly.
  const requestSeq = useRef(0);

  // Debounce the free-text search; reset to page 1 whenever the term changes.
  // The two state updates are issued directly in the timeout body (not as a
  // side-effect inside a setState updater) so React 19 strict-mode's repeated
  // updater invocations cannot fire setPage more than necessary. `search` is read
  // off the latest render via the effect's dependency, so the comparison is fresh.
  useEffect(() => {
    const handle = setTimeout(() => {
      const next = searchInput.trim();
      if (next !== search) {
        setSearch(next);
        setPage(1);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput, search]);

  // Load the category tree once (best-effort; failure just hides the rail).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tree = (await storeApi.getCategories()) as CategoryNode[] | unknown;
        const list = Array.isArray(tree) ? flattenCategories(tree as CategoryNode[]) : [];
        if (!cancelled) setCategories(list);
      } catch {
        if (!cancelled) setCategories([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The params object sent to the API — memoised so the fetch effect is stable.
  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      sort,
      ...(search ? { search } : {}),
      ...(category ? { category } : {}),
      ...(tag ? { tag } : {}),
    }),
    [page, sort, search, category, tag],
  );

  const fetchProducts = useCallback(async () => {
    // Stale-request guard: each call claims the next sequence number; only the
    // call whose `seq` still matches `requestSeq.current` is allowed to commit
    // state (success, error, OR the `loading=false` in `finally`). A superseded
    // call therefore no-ops on every branch. The `setLoading(true)` below runs
    // BEFORE the seq check on purpose — every filter change should immediately
    // show the skeleton. DO NOT move it after the await or remove it.
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res: ProductListResponse = await storeApi.listProducts(params);
      if (seq !== requestSeq.current) return; // a newer request superseded this one
      const data = Array.isArray(res.data) ? res.data : [];
      const metaTotal = typeof res.meta?.total === 'number' ? res.meta.total : data.length;
      const metaPages =
        typeof res.meta?.totalPages === 'number'
          ? res.meta.totalPages
          : Math.max(1, Math.ceil(metaTotal / PAGE_SIZE));
      setProducts(data);
      setTotal(metaTotal);
      setTotalPages(metaPages);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      const message =
        err instanceof ApiError
          ? err.message
          : 'We could not load the catalog right now. Please try again.';
      setError(message);
      setProducts([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  // ── Filter helpers ────────────────────────────────────────
  const hasActiveFilters = Boolean(search || category || tag) || sort !== 'featured';

  const clearAll = () => {
    setSearchInput('');
    setSearch('');
    setCategory('');
    setTag('');
    setSort('featured');
    setPage(1);
  };

  const selectCategory = (slug: string) => {
    setCategory((prev) => (prev === slug ? '' : slug));
    setPage(1);
  };

  // Scroll the grid back into view on page change for long lists.
  const gridRef = useRef<HTMLDivElement>(null);
  const goToPage = (next: number) => {
    setPage(next);
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <Layout activeTab="store">
      <div className="mkt relative overflow-hidden bg-parchment min-h-[calc(100dvh-80px)]">
        {/* Ambient brand orbs */}
        <div
          aria-hidden
          className="mkt-float mkt-glow-pulse pointer-events-none absolute -top-32 -right-24 h-[34rem] w-[34rem] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(244,163,0,0.20), transparent 62%)' }}
        />
        <div
          aria-hidden
          className="mkt-float pointer-events-none absolute top-[28rem] -left-40 h-[28rem] w-[28rem] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(19,48,34,0.10), transparent 65%)' }}
        />

        {/* ── Search (Amazon-style: the search bar comes first) ─────────────
            Icon + input + clear are flex SIBLINGS (not an icon absolutely
            positioned over the input), so the hint text can never sit under the
            icon. The input is plain (no `.mkt-input` padding shorthand) inside a
            hairline bar, keeping it on-brand (0px, matte, hairline). */}
        <section className="relative z-10 mx-auto max-w-[1600px] px-4 pt-8 sm:px-6 md:px-8 md:pt-12">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-3 border border-hairline bg-alabaster px-4 py-3.5 transition-colors focus-within:border-saffron"
          >
            <Search className="h-5 w-5 shrink-0 text-ink/40" aria-hidden />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search kits, components & brands by name…"
              aria-label="Search the catalog"
              className="w-full border-0 bg-transparent p-0 font-sans text-sm text-forest outline-none placeholder:text-ink/45 sm:text-base"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
                className="shrink-0 text-ink/40 transition-colors hover:text-terracotta"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </motion.div>
        </section>

        {/* ── Heading + description (compact, single-line — below the search) ── */}
        <section className="relative z-10 mx-auto max-w-[1600px] px-4 pt-6 sm:px-6 md:px-8 md:pt-7">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-3xl"
          >
            <div className="mkt-pill mb-3">
              <ShoppingBag className="h-3.5 w-3.5 text-saffron-deep" />
              <span className="font-sans text-[10px] font-bold uppercase tracking-[0.22em] text-forest/80">
                The Workshop Store
              </span>
            </div>
            <h1 className="font-serif text-xl font-bold leading-tight tracking-[-0.02em] text-forest sm:text-2xl md:text-3xl">
              Kits, components &amp; DIY projects
            </h1>
            <p className="mt-2 font-sans text-sm leading-relaxed text-ink/65">
              Curated hardware &amp; modular kits — built to make real.
            </p>
          </motion.div>
        </section>

        {/* ── Controls bar (count left · sort + filters right) ───────────── */}
        <section className="relative z-10 mx-auto max-w-[1600px] px-4 pt-6 sm:px-6 md:px-8">
          <div className="flex flex-wrap items-center gap-3">
            {/* Results count (left) */}
            {!loading && !error && (
              <span className="font-sans text-[11px] uppercase tracking-[0.1em] text-ink/45">
                {total} {total === 1 ? 'result' : 'results'}
              </span>
            )}

            {/* Sort + filters (right) */}
            <div className="ml-auto flex items-center gap-3">
              <label
                htmlFor="store-sort"
                className="hidden font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/50 md:inline"
              >
                Sort
              </label>
              <select
                id="store-sort"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as SortKey);
                  setPage(1);
                }}
                className="mkt-input min-w-0 px-4 py-2.5 text-forest"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {/* Mobile filter toggle */}
              {categories.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFiltersOpen((v) => !v)}
                  aria-expanded={filtersOpen}
                  className="inline-flex shrink-0 items-center gap-2 rounded-full border border-hairline bg-white/70 px-4 py-2.5 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-forest backdrop-blur transition-colors hover:border-saffron md:hidden"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Filters
                </button>
              )}
            </div>
          </div>

          {/* Category rail */}
          {categories.length > 0 && (
            <div className={cn('mt-4', !filtersOpen && 'hidden md:block')}>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCategory('');
                    setPage(1);
                  }}
                  className={cn(
                    'rounded-full border px-4 py-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors',
                    category === ''
                      ? 'border-forest bg-forest text-parchment'
                      : 'border-hairline bg-white/60 text-ink/65 backdrop-blur hover:border-saffron hover:text-saffron-deep',
                  )}
                >
                  All
                </button>
                {categories.map((c) => (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => selectCategory(c.slug)}
                    className={cn(
                      'rounded-full border px-4 py-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors',
                      c.depth > 0 && 'opacity-90',
                      category === c.slug
                        ? 'border-forest bg-forest text-parchment'
                        : 'border-hairline bg-white/60 text-ink/65 backdrop-blur hover:border-saffron hover:text-saffron-deep',
                    )}
                  >
                    {c.depth > 0 ? `· ${c.name}` : c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active filter summary (tag + clear-all; result count lives in the
              controls row above) */}
          {(tag || hasActiveFilters) && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {tag && (
                <button
                  type="button"
                  onClick={() => {
                    setTag('');
                    setPage(1);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-saffron-glow/30 px-3 py-1 font-sans text-[10px] font-semibold uppercase tracking-[0.06em] text-saffron-deep transition-colors hover:bg-saffron-glow/50"
                >
                  #{tag}
                  <X className="h-3 w-3" />
                </button>
              )}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-terracotta transition-colors hover:text-terracotta-warm"
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </section>

        {/* ── Product grid ─────────────────────────────────── */}
        <section
          ref={gridRef}
          className="relative z-10 mx-auto max-w-[1600px] scroll-mt-24 px-4 pb-24 pt-8 sm:px-6 md:px-8"
        >
          {/* Loading */}
          {loading && (
            <div
              className="grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5"
              aria-busy="true"
              aria-label="Loading products"
            >
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <div
                  key={i}
                  className="mkt-card overflow-hidden"
                >
                  <div className="aspect-[4/5] w-full animate-pulse bg-parchment-dark/60" />
                  <div className="space-y-2 p-4">
                    <div className="h-2.5 w-1/3 animate-pulse rounded-full bg-parchment-dark/60" />
                    <div className="h-3.5 w-4/5 animate-pulse rounded-full bg-parchment-dark/60" />
                    <div className="h-3 w-1/4 animate-pulse rounded-full bg-parchment-dark/60" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="mkt-card mx-auto flex max-w-md flex-col items-center gap-4 p-10 text-center">
              <AlertTriangle className="h-8 w-8 text-terracotta" aria-hidden />
              <h2 className="font-serif text-xl text-forest">Something went wrong</h2>
              <p className="font-sans text-sm leading-relaxed text-ink/60">{error}</p>
              <button type="button" onClick={() => void fetchProducts()} className="mkt-btn mt-2">
                <RotateCw className="h-4 w-4" />
                <span>Try again</span>
              </button>
            </div>
          )}

          {/* Empty */}
          {!loading && !error && products.length === 0 && (
            <div className="mkt-card mx-auto flex max-w-md flex-col items-center gap-4 p-10 text-center">
              <PackageOpen className="h-8 w-8 text-ink/30" aria-hidden />
              <h2 className="font-serif text-xl text-forest">No products found</h2>
              <p className="font-sans text-sm leading-relaxed text-ink/60">
                {hasActiveFilters
                  ? 'Nothing matches these filters yet. Try widening your search.'
                  : 'The shelves are being stocked — check back soon.'}
              </p>
              {hasActiveFilters && (
                <button type="button" onClick={clearAll} className="mkt-btn-ghost mt-2">
                  <X className="h-4 w-4" />
                  <span>Clear filters</span>
                </button>
              )}
            </div>
          )}

          {/* Results */}
          {!loading && !error && products.length > 0 && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5"
              >
                {products.map((p, i) => {
                  const rating = resolveRating(p);
                  return (
                    <ProductCard
                      key={p.id}
                      name={p.name}
                      href={`/store/${p.slug}`}
                      imageUrl={resolveImage(p)}
                      imageAlt={resolveAlt(p)}
                      priceFrom={p.priceFrom ?? null}
                      priceTo={p.priceTo ?? null}
                      eyebrow={p.brand ?? resolveCategoryLabel(p) ?? null}
                      subtitle={p.subtitle ?? null}
                      ratingAverage={rating.average}
                      ratingCount={rating.count}
                      // Eager-load the first card's image — the top-left grid cell is
                      // the above-the-fold LCP element on the catalog.
                      priority={i === 0}
                    />
                  );
                })}
              </motion.div>

              <div className="mt-12">
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  onPageChange={goToPage}
                  mkt
                />
              </div>
            </>
          )}
        </section>
      </div>
    </Layout>
  );
}
