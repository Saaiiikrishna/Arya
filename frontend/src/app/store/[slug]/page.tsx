'use client';

/**
 * Public product detail page (PDP).
 *
 * Data: storeApi.getProduct(slug) → ProductDetail (see storeApi.ts). All money is
 * INTEGER PAISE and rendered via <Money/>. Untrusted admin-authored tab sections
 * are rendered through the shared <BlockRenderer/> (sanitises RICH_TEXT, renders
 * the other four block types structurally) — never raw HTML.
 *
 * Layout: marketing surface → everything sits inside a `.mkt` wrapper using the
 * DESIGN.md §7 premium glossy/rounded layer, wrapped in <Layout activeTab="store">.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  Hammer,
  Loader2,
  PackageX,
  ShoppingCart,
  ThumbsUp,
  BadgeCheck,
  MessageSquare,
} from 'lucide-react';
import Layout from '@/components/Layout';
import {
  Money,
  StockBadge,
  MediaGallery,
  Tabs,
  BlockRenderer,
  JsonLd,
  Stars,
  StarInput,
} from '@/components/store';
import type {
  GalleryMedia,
  ContentBlock,
} from '@/components/store';
import {
  storeApi,
  type ProductDetail,
  type ProductReview,
  type ReviewSummary,
} from '@/lib/storeApi';
import { ApiError } from '@/lib/api';
import { useStoreAuth } from '@/lib/storeAuth';
import { useStoreCart } from '@/lib/storeCart';
import { cn } from '@/lib/cn';
import { asStr, asNum } from '../_util';

// ── Local view models (defensive narrowing of the permissive ProductDetail) ──

interface SkuView {
  id: string;
  name: string;
  skuCode: string | null;
  effectivePrice: number | null;
  basePrice: number | null;
  salePrice: number | null;
  available: number | null;
  inStock: boolean;
}

/** Map a raw SKU record onto a defensive SkuView. */
function toSkuView(raw: Record<string, unknown>): SkuView {
  const stock = (raw.stock as Record<string, unknown> | undefined) ?? {};
  const basePrice = asNum(raw.basePrice);
  const salePrice = asNum(raw.salePrice);
  const effectivePrice = asNum(raw.effectivePrice) ?? salePrice ?? basePrice;
  return {
    id: String(raw.id ?? ''),
    name: asStr(raw.name) ?? asStr(raw.skuCode) ?? 'Default',
    skuCode: asStr(raw.skuCode),
    effectivePrice,
    basePrice,
    salePrice,
    available: asNum(stock.available),
    // Treat the explicit boolean `inStock === true` as authoritative; otherwise
    // fall back to a positive available count. A truthy non-boolean (e.g. the
    // string 'true') must NOT over-report as in stock, hence `=== true`.
    inStock: stock.inStock === true || (asNum(stock.available) ?? 0) > 0,
  };
}

/**
 * Resolve product media rows into gallery items, dropping URL-less rows.
 *
 * Filtering of PENDING / unconfirmed media is the server projection's job — the
 * public catalog DTO only returns CONFIRMED rows (COMMERCE_ARCHITECTURE §9), so
 * here we only defensively drop rows that carry no usable `url`.
 */
function toGalleryMedia(product: ProductDetail): GalleryMedia[] {
  const rows = Array.isArray(product.media) ? product.media : [];
  const out: GalleryMedia[] = [];
  for (const r of rows) {
    const url = asStr((r as Record<string, unknown>).url);
    if (!url) continue;
    const type =
      (r as Record<string, unknown>).type === 'VIDEO' ? 'VIDEO' : 'IMAGE';
    out.push({
      url,
      type,
      caption: asStr((r as Record<string, unknown>).caption),
      altText: asStr((r as Record<string, unknown>).altText),
    });
  }
  return out;
}

/**
 * Does this product expose a DIY guide? (build flag / linked guide).
 *
 * TODO: pin to a single `hasDiyGuide` boolean (or the `diyGuide` relation) once
 * the public catalog DTO is stabilised — this multi-key probe currently
 * compensates for an unspecified backend contract (COMMERCE_ARCHITECTURE §2.2).
 */
function hasBuildGuide(product: ProductDetail): boolean {
  const p = product as Record<string, unknown>;
  if (p.hasGuide === true || p.hasBuild === true || p.buildable === true) return true;
  if (p.diyGuide && typeof p.diyGuide === 'object') return true;
  if (p.guide && typeof p.guide === 'object') return true;
  return false;
}

/**
 * Build a schema.org Product structured-data object (rendered as JSON-LD).
 *
 * - `offers.price` is in RUPEES with 2 decimals (schema.org expects a decimal
 *   currency value), converted from the lowest available SKU price in integer
 *   paise — the same number the buy box shows. `priceCurrency` is INR.
 * - `availability` reflects whether ANY SKU is in stock.
 * - Only fields we can populate confidently are emitted; absent ones are omitted
 *   rather than sent empty. The object is OUR OWN data → safe to JSON-LD.
 */
function buildProductJsonLd(
  product: ProductDetail,
  skus: SkuView[],
  media: GalleryMedia[],
): Record<string, unknown> {
  // Lowest effective price across SKUs (paise), preferring server priceFrom.
  const skuPrices = skus
    .map((s) => s.effectivePrice)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
  const lowestPaise =
    asNum(product.priceFrom) ?? (skuPrices.length ? Math.min(...skuPrices) : null);
  const inStock = skus.some((s) => s.inStock);

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
  };

  // Aggregate rating → enables star rich-results in Google search. Emitted only
  // when there is at least one approved rating; values come straight off the
  // denormalised ProductDetail fields (Product.ratingSum / Product.ratingCount).
  const ratingAverage = asNum(product.ratingAverage);
  const ratingCount = asNum(product.ratingCount) ?? 0;
  if (ratingAverage != null && ratingCount > 0) {
    data.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: ratingAverage.toFixed(1),
      reviewCount: ratingCount,
      bestRating: '5',
      worstRating: '1',
    };
  }

  const desc = asStr(product.shortDescription) ?? asStr(product.subtitle) ?? asStr(product.description);
  if (desc) data.description = desc;

  const brand = asStr(product.brand);
  if (brand) data.brand = { '@type': 'Brand', name: brand };

  // schema.org Product.image expects IMAGE URLs only. The media list mixes IMAGE
  // and VIDEO rows (videos render in the gallery's video slot); a VIDEO URL here
  // would be served to crawlers as a product image (Google Search rich-result
  // breakage / invalid structured data). Filter to IMAGE rows before mapping.
  const imageUrls = media
    .filter((m) => m.type === 'IMAGE')
    .map((m) => m.url)
    .filter(Boolean);
  if (imageUrls.length) data.image = imageUrls;

  const sku = asStr(product.sku) ?? (skus.length ? asStr(skus[0].skuCode) : null);
  if (sku) data.sku = sku;

  if (lowestPaise != null) {
    data.offers = {
      '@type': 'Offer',
      // Paise → rupees, fixed 2dp, as a string (schema.org price is a decimal).
      price: (lowestPaise / 100).toFixed(2),
      priceCurrency: asStr(product.currency) ?? 'INR',
      availability: inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    };
  }

  return data;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const data = await storeApi.getProduct(slug);
      setProduct(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setError(
          err instanceof Error ? err.message : 'Failed to load this product.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Single Layout/PageShell wrapper for every state so the header/footer never
  // re-mount on a loading → loaded transition (which would flicker the chrome).
  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-forest/60" aria-label="Loading" />
      </div>
    );
  } else if (notFound) {
    body = (
      <EmptyState
        icon={<PackageX className="h-10 w-10" aria-hidden />}
        title="Product not found"
        subtitle="This item may have sold out or been retired from the catalog."
      />
    );
  } else if (error || !product) {
    body = (
      <EmptyState
        icon={<PackageX className="h-10 w-10" aria-hidden />}
        title="Something went wrong"
        subtitle={error ?? 'We could not load this product.'}
        action={
          <button type="button" onClick={() => void load()} className="mkt-btn">
            <span>Try again</span>
          </button>
        }
      />
    );
  } else {
    body = <ProductView product={product} slug={slug} />;
  }

  return (
    <Layout activeTab="store">
      <PageShell>{body}</PageShell>
    </Layout>
  );
}

// ── Shell + shared bits ───────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mkt relative min-h-[calc(100dvh-80px)] overflow-hidden bg-parchment">
      <div
        aria-hidden
        className="mkt-float mkt-glow-pulse pointer-events-none absolute -top-32 right-0 h-[30rem] w-[30rem] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(244,163,0,0.16), transparent 64%)',
        }}
      />
      <div className="relative z-10 mx-auto max-w-screen-xl 3xl:max-w-[1600px] px-4 py-10 sm:px-6 md:px-8 md:py-14">
        {children}
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
      <div className="text-ink/30">{icon}</div>
      <h1 className="font-serif text-2xl text-forest">{title}</h1>
      <p className="max-w-md font-sans text-sm text-ink/60">{subtitle}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        {action}
        <Link href="/store" className="mkt-btn-ghost">
          <ArrowLeft className="h-4 w-4" />
          <span>Back to store</span>
        </Link>
      </div>
    </div>
  );
}

// ── Product view (loaded) ──────────────────────────────────────────────────────

function ProductView({
  product,
  slug,
}: {
  product: ProductDetail;
  slug: string;
}) {
  const skus = useMemo<SkuView[]>(() => {
    const rows = Array.isArray(product.skus) ? product.skus : [];
    return rows.map((r) => toSkuView(r as Record<string, unknown>)).filter((s) => s.id);
  }, [product.skus]);

  const media = useMemo(() => toGalleryMedia(product), [product]);
  const buildable = useMemo(() => hasBuildGuide(product), [product]);

  // Default selection derived synchronously from the SKU list (first in-stock,
  // else first) so the buy box shows the correct price on the very first render —
  // no price-flash from an async effect that switches the selection afterwards.
  const defaultSkuId = useMemo(() => {
    if (skus.length === 0) return '';
    return (skus.find((s) => s.inStock) ?? skus[0]).id;
  }, [skus]);

  const [selectedSkuId, setSelectedSkuId] = useState<string>(defaultSkuId);
  // Re-sync only when the product (and therefore its default) actually changes.
  useEffect(() => {
    setSelectedSkuId(defaultSkuId);
  }, [defaultSkuId]);

  const selectedSku =
    skus.find((s) => s.id === selectedSkuId) ?? skus[0] ?? null;
  const multiSku = skus.length > 1;

  const [qty, setQty] = useState(1);
  useEffect(() => {
    setQty(1);
  }, [selectedSkuId]);

  // Cart context: route adds through the provider (not storeApi directly) so a
  // brand-new guest gets a minted guest cart and the header badge count updates.
  const { addItem } = useStoreCart();

  // Add-to-cart state machine: idle → adding → added (transient) | error.
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);

  // Auto-clear the transient "Added to cart" confirmation, with cleanup so the
  // timer never fires on an unmounted component.
  useEffect(() => {
    if (!added) return;
    const t = window.setTimeout(() => setAdded(false), 2200);
    return () => window.clearTimeout(t);
  }, [added]);

  const maxQty =
    selectedSku?.available != null && selectedSku.available > 0
      ? selectedSku.available
      : 99;
  const canAdd = !!selectedSku && selectedSku.inStock && !adding;

  const addToCart = useCallback(async () => {
    if (!selectedSku || !selectedSku.inStock) return;
    setAdding(true);
    setCartError(null);
    setAdded(false);
    try {
      // Route through the cart context: it mints a guest cart on the first add for
      // an unauthenticated visitor (avoiding the 401/403 the direct storeApi call
      // hit) and commits the recomputed cart to context state so the header badge
      // in Layout.tsx reflects the new count immediately.
      await addItem(selectedSku.id, qty);
      setAdded(true);
    } catch (err) {
      setCartError(
        err instanceof Error ? err.message : 'Could not add this to your cart.',
      );
    } finally {
      setAdding(false);
    }
  }, [selectedSku, qty, addItem]);

  const eyebrow = asStr(product.brand) ?? asStr(product.subtitle);
  // Buy-box paragraph: the dedicated short description, falling back only to the
  // subtitle — never the full long-form `description` (that belongs in a tab).
  const shortDesc = asStr(product.shortDescription) ?? asStr(product.subtitle);

  // Denormalised rating off the ProductDetail (named fields on ProductSummary).
  // Shown near the title when there is at least one rating.
  const ratingAverage = asNum(product.ratingAverage);
  const ratingCount = asNum(product.ratingCount) ?? 0;
  const productId = asStr(product.id) ?? '';

  // Tabs: admin-defined tab/section tree. Each tab.sections → BlockRenderer.
  const tabItems = useMemo(() => {
    const rawTabs = Array.isArray(product.tabs) ? product.tabs : [];
    return rawTabs
      .map((t, i) => {
        const tab = t as Record<string, unknown>;
        const title = asStr(tab.title) ?? `Section ${i + 1}`;
        // Defensive: only pass an actual array to BlockRenderer.
        const sections: ContentBlock[] = Array.isArray(tab.sections)
          ? (tab.sections as ContentBlock[])
          : [];
        return {
          key: String(tab.id ?? `tab-${i}`),
          label: title,
          content: <BlockRenderer blocks={sections} />,
        };
      })
      .filter((t) => t.key);
  }, [product.tabs]);

  // Active tab derived synchronously from the first tab, avoiding an extra
  // render cycle from an effect-driven initial sync.
  const defaultTabKey = tabItems.length > 0 ? tabItems[0].key : '';
  const [activeTabKey, setActiveTabKey] = useState(defaultTabKey);
  useEffect(() => {
    setActiveTabKey(defaultTabKey);
  }, [defaultTabKey]);

  // schema.org Product structured data (JSON-LD) for SEO / rich results.
  const productJsonLd = useMemo(
    () => buildProductJsonLd(product, skus, media),
    [product, skus, media],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <JsonLd data={productJsonLd} />

      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 font-sans text-[11px] uppercase tracking-[0.08em] text-ink/45">
        <Link href="/store" className="transition-colors hover:text-saffron-deep">
          Store
        </Link>
        <span aria-hidden>/</span>
        <span className="truncate text-ink/70">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10 3xl:gap-14">
        {/* Gallery */}
        <div>
          <MediaGallery media={media} mkt aspect="aspect-square" />
        </div>

        {/* Buy box */}
        <div className="flex flex-col gap-5">
          {eyebrow && (
            <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-saffron-deep">
              {eyebrow}
            </span>
          )}
          <h1 className="font-serif-display text-3xl font-bold leading-[1.02] tracking-[-0.02em] text-forest sm:text-4xl md:text-5xl">
            {product.name}
          </h1>

          {ratingCount > 0 && (
            <a
              href="#reviews"
              className="inline-flex items-center gap-2 transition-opacity hover:opacity-80"
            >
              <Stars value={ratingAverage ?? 0} size="h-4 w-4" />
              <span className="font-sans text-sm text-ink/65">
                {(ratingAverage ?? 0).toFixed(1)}
                <span className="text-ink/45">
                  {' '}· {ratingCount} {ratingCount === 1 ? 'review' : 'reviews'}
                </span>
              </span>
            </a>
          )}

          {shortDesc && (
            <p className="font-sans text-base leading-relaxed text-ink/70">
              {shortDesc}
            </p>
          )}

          {/* Price + stock */}
          <div className="flex flex-wrap items-baseline gap-3">
            {selectedSku?.effectivePrice != null ? (
              <>
                <Money
                  paise={selectedSku.effectivePrice}
                  className="font-sans text-2xl font-bold text-forest"
                />
                {selectedSku.salePrice != null &&
                  selectedSku.basePrice != null &&
                  selectedSku.salePrice < selectedSku.basePrice && (
                    <Money
                      paise={selectedSku.basePrice}
                      className="font-sans text-base text-ink/40 line-through"
                    />
                  )}
              </>
            ) : (
              <span className="font-sans text-sm text-ink/50">
                Pricing unavailable
              </span>
            )}
            {selectedSku && (
              <StockBadge qty={selectedSku.available} mkt showCount />
            )}
          </div>

          {/* Variant selector (only when multiple SKUs) */}
          {multiSku && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/55">
                Choose a variant
              </legend>
              <div className="flex flex-wrap gap-2">
                {skus.map((sku) => {
                  const active = sku.id === selectedSkuId;
                  return (
                    <button
                      key={sku.id}
                      type="button"
                      onClick={() => setSelectedSkuId(sku.id)}
                      aria-pressed={active}
                      // 0px radius per the DESIGN DIRECTIVE — interactive chips are
                      // neither pills nor circles, so they follow the matte mkt-card
                      // geometry (0 corners, 1px hairline, surface = alabaster).
                      className={cn(
                        'flex flex-col items-start gap-0.5 border px-4 py-2.5 text-left transition-colors',
                        active
                          ? 'border-saffron bg-saffron-glow/20'
                          : 'border-hairline bg-alabaster hover:border-saffron/50',
                        !sku.inStock && 'opacity-60',
                      )}
                    >
                      <span className="font-sans text-sm font-semibold text-forest">
                        {sku.name}
                      </span>
                      <span className="font-sans text-xs text-ink/55">
                        {sku.effectivePrice != null ? (
                          <Money paise={sku.effectivePrice} showDecimals={false} />
                        ) : (
                          '—'
                        )}
                        {!sku.inStock && ' · Out of stock'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {/* Quantity + add to cart */}
          <div className="mt-1 flex flex-col gap-3">
            <div className="flex items-center gap-3 sm:gap-4">
              {/* Pill stepper: rounded per the DESIGN.md §7 mkt-* marketing-layer
                  exception (matches the catalog page's filter pills inside `.mkt`). */}
              <div className="inline-flex shrink-0 items-center rounded-full border border-hairline bg-alabaster/60">
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1}
                  aria-label="Decrease quantity"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-forest transition-colors hover:bg-saffron-glow/25 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  −
                </button>
                <span className="w-10 text-center font-sans text-sm tabular-nums text-ink">
                  {qty}
                </span>
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                  disabled={qty >= maxQty}
                  aria-label="Increase quantity"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-forest transition-colors hover:bg-saffron-glow/25 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                onClick={() => void addToCart()}
                disabled={!canAdd}
                className={cn('mkt-btn flex-1', !canAdd && 'cursor-not-allowed opacity-60')}
              >
                {adding ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Adding…</span>
                  </>
                ) : added ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Added to cart</span>
                  </>
                ) : selectedSku && !selectedSku.inStock ? (
                  <span>Out of stock</span>
                ) : (
                  <>
                    <ShoppingCart className="h-4 w-4" />
                    <span>Add to cart</span>
                  </>
                )}
              </button>
            </div>

            {cartError && (
              <p className="font-sans text-xs text-terracotta" role="alert">
                {cartError}
              </p>
            )}
          </div>

          {/* DIY guide CTA */}
          {buildable && (
            <Link
              href={`/store/${encodeURIComponent(slug)}/build`}
              className="mkt-btn-ghost mt-1 w-full"
            >
              <Hammer className="h-4 w-4" />
              <span>Build it yourself</span>
            </Link>
          )}
        </div>
      </div>

      {/* Dynamic admin-defined tabs */}
      {tabItems.length > 0 && (
        <div className="mt-14 border-t border-hairline/70 pt-10">
          <Tabs
            mkt
            tabs={tabItems}
            activeKey={activeTabKey}
            onChange={setActiveTabKey}
            panelClassName="mkt-card mt-2 p-6 md:p-8"
          />
        </div>
      )}

      {/* Customer reviews */}
      {productId && (
        <div id="reviews" className="mt-14 scroll-mt-24 border-t border-hairline/70 pt-10">
          <ReviewsSection productId={productId} productName={product.name} />
        </div>
      )}
    </motion.div>
  );
}

// ── Reviews section ────────────────────────────────────────────────────────────

const REVIEWS_PAGE_SIZE = 5;

type ReviewSort = 'recent' | 'helpful' | 'rating_desc';

const REVIEW_SORTS: { value: ReviewSort; label: string }[] = [
  { value: 'recent', label: 'Most recent' },
  { value: 'helpful', label: 'Most helpful' },
  { value: 'rating_desc', label: 'Highest rated' },
];

const EMPTY_BREAKDOWN: ReviewSummary['breakdown'] = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

function fmtReviewDate(d: string | null | undefined): string {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ReviewsSection({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const { isAuthed } = useStoreAuth();

  // List + summary state
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [summary, setSummary] = useState<ReviewSummary>({
    average: 0,
    count: 0,
    breakdown: EMPTY_BREAKDOWN,
  });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sort, setSort] = useState<ReviewSort>('recent');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Helpful-vote optimistic tracking (best-effort idempotency client-side too).
  const [voted, setVoted] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await storeApi.listProductReviews(productId, {
        page,
        limit: REVIEWS_PAGE_SIZE,
        sort,
      });
      const data = Array.isArray(res.data) ? res.data : [];
      setReviews(data);
      const metaTotal =
        typeof res.meta?.total === 'number' ? res.meta.total : data.length;
      const metaPages =
        typeof res.meta?.totalPages === 'number'
          ? res.meta.totalPages
          : Math.max(1, Math.ceil(metaTotal / REVIEWS_PAGE_SIZE));
      setTotalPages(metaPages);
      if (res.summary) {
        setSummary({
          average: asNum(res.summary.average) ?? 0,
          count: asNum(res.summary.count) ?? 0,
          breakdown: res.summary.breakdown ?? EMPTY_BREAKDOWN,
        });
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'We could not load reviews right now. Please try again.',
      );
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [productId, page, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const onHelpful = useCallback(
    async (reviewId: string) => {
      // The "helpful" endpoint is behind CustomerJwtGuard — only logged-in
      // customers may vote. Guard here too so an anonymous click never fires a
      // request that would 401; the UI shows a sign-in prompt for guests instead.
      if (!isAuthed) return;
      if (voted[reviewId]) return;
      // Optimistic bump + lock; reconcile with the server count on success.
      setVoted((v) => ({ ...v, [reviewId]: true }));
      setReviews((rows) =>
        rows.map((r) =>
          r.id === reviewId ? { ...r, helpfulCount: (r.helpfulCount ?? 0) + 1 } : r,
        ),
      );
      try {
        const res = await storeApi.markReviewHelpful(reviewId);
        if (typeof res.helpfulCount === 'number') {
          setReviews((rows) =>
            rows.map((r) =>
              r.id === reviewId ? { ...r, helpfulCount: res.helpfulCount as number } : r,
            ),
          );
        }
      } catch {
        // Roll back the optimistic bump on failure; allow a retry.
        setVoted((v) => ({ ...v, [reviewId]: false }));
        setReviews((rows) =>
          rows.map((r) =>
            r.id === reviewId
              ? { ...r, helpfulCount: Math.max(0, (r.helpfulCount ?? 1) - 1) }
              : r,
          ),
        );
      }
    },
    [voted, isAuthed],
  );

  // After a successful submission, jump to the freshest sort so the author sees
  // the list refresh (their own review stays PENDING and won't appear yet). We do
  // NOT call load() here: it is a closure over the CURRENT page/sort, so invoking
  // it now would fire a redundant fetch with the pre-update values (setState is
  // async/batched). Setting page→1 + sort→'recent' changes the load() identity,
  // and the useEffect on [load] re-runs the (correct) fetch once React re-renders.
  const onSubmitted = useCallback(() => {
    setPage(1);
    setSort('recent');
  }, []);

  const breakdown = summary.breakdown ?? EMPTY_BREAKDOWN;
  const total = summary.count || 0;

  return (
    <div>
      <h2 className="font-serif-display text-3xl font-bold tracking-[-0.02em] text-forest">
        Customer reviews
      </h2>

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[20rem_1fr]">
        {/* ── Summary + write-a-review ──────────────────────────── */}
        <div className="flex flex-col gap-8">
          <div className="mkt-card p-6">
            {total > 0 ? (
              <>
                <div className="flex items-end gap-3">
                  <span className="font-serif-display text-5xl font-bold leading-none text-forest">
                    {summary.average.toFixed(1)}
                  </span>
                  <div className="pb-1">
                    <Stars value={summary.average} size="h-4 w-4" />
                    <p className="mt-1 font-sans text-xs text-ink/55">
                      {total} {total === 1 ? 'review' : 'reviews'}
                    </p>
                  </div>
                </div>

                {/* Per-star breakdown bars */}
                <div className="mt-6 flex flex-col gap-2">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const c =
                      breakdown[star as 5 | 4 | 3 | 2 | 1] ?? 0;
                    const pct = total > 0 ? (c / total) * 100 : 0;
                    return (
                      <div key={star} className="flex items-center gap-2.5">
                        <span className="w-6 shrink-0 font-sans text-xs tabular-nums text-ink/55">
                          {star}★
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-parchment-dark/60">
                          <div
                            className="h-full rounded-full bg-saffron"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-8 shrink-0 text-right font-sans text-xs tabular-nums text-ink/45">
                          {c}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <Stars value={0} size="h-5 w-5" />
                <p className="font-sans text-sm text-ink/60">
                  No reviews yet — be the first to share your experience.
                </p>
              </div>
            )}
          </div>

          {/* Write a review (logged-in customers only) */}
          {isAuthed ? (
            <WriteReviewForm
              productId={productId}
              productName={productName}
              onSubmitted={onSubmitted}
            />
          ) : (
            <div className="mkt-card flex flex-col gap-3 p-6">
              <h3 className="font-serif text-lg text-forest">Share your thoughts</h3>
              <p className="font-sans text-sm text-ink/60">
                Sign in to your store account to write a review for this product.
              </p>
              <Link href="/account" className="mkt-btn-ghost w-full">
                <span>Sign in to review</span>
              </Link>
            </div>
          )}
        </div>

        {/* ── Review list ───────────────────────────────────────── */}
        <div>
          {/* Sort control */}
          {total > 0 && (
            <div className="mb-5 flex items-center justify-end gap-3">
              <label
                htmlFor="reviews-sort"
                className="font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/50"
              >
                Sort
              </label>
              <select
                id="reviews-sort"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as ReviewSort);
                  setPage(1);
                }}
                className="mkt-input px-4 py-2 text-forest"
              >
                {REVIEW_SORTS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-saffron" aria-label="Loading reviews" />
            </div>
          ) : error ? (
            <div className="mkt-card flex flex-col items-center gap-3 p-10 text-center">
              <p className="font-sans text-sm text-ink/70">{error}</p>
              <button type="button" onClick={() => void load()} className="mkt-btn-ghost">
                <span>Try again</span>
              </button>
            </div>
          ) : reviews.length === 0 ? (
            <div className="mkt-card flex flex-col items-center gap-3 p-12 text-center">
              <MessageSquare className="h-8 w-8 text-ink/25" aria-hidden />
              <p className="font-sans text-sm text-ink/60">
                No reviews yet. Yours could be the first.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-5">
              {reviews.map((r) => {
                const author = asStr(r.authorName) ?? 'Verified customer';
                const dateLabel = fmtReviewDate(r.createdAt);
                return (
                  <li key={r.id} className="mkt-card p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Stars value={r.rating} size="h-4 w-4" />
                        {r.isVerifiedPurchase && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-forest/[0.07] px-2.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.06em] text-forest">
                            <BadgeCheck className="h-3.5 w-3.5" />
                            Verified purchase
                          </span>
                        )}
                      </div>
                      {dateLabel && (
                        <span className="font-sans text-[11px] uppercase tracking-[0.06em] text-ink/45">
                          {dateLabel}
                        </span>
                      )}
                    </div>

                    {asStr(r.title) && (
                      <h4 className="mt-3 font-serif text-lg leading-snug text-forest">
                        {r.title}
                      </h4>
                    )}
                    {asStr(r.body) && (
                      <p className="mt-2 whitespace-pre-line font-sans text-sm leading-relaxed text-ink/70">
                        {r.body}
                      </p>
                    )}

                    <div className="mt-4 flex items-center gap-3">
                      <span className="font-sans text-xs text-ink/55">{author}</span>
                      <span aria-hidden className="text-ink/25">·</span>
                      {isAuthed ? (
                        // Logged-in customers can vote (CustomerJwtGuard route).
                        <button
                          type="button"
                          onClick={() => void onHelpful(r.id)}
                          disabled={!!voted[r.id]}
                          className={cn(
                            'inline-flex items-center gap-1.5 font-sans text-xs transition-colors',
                            voted[r.id]
                              ? 'cursor-default text-saffron-deep'
                              : 'text-ink/55 hover:text-saffron-deep',
                          )}
                        >
                          <ThumbsUp
                            className={cn('h-3.5 w-3.5', voted[r.id] && 'fill-saffron-deep')}
                          />
                          <span>
                            Helpful{r.helpfulCount > 0 ? ` (${r.helpfulCount})` : ''}
                          </span>
                        </button>
                      ) : (
                        // Guests: show the (non-interactive) count and a sign-in
                        // prompt instead of a button that would 401 on click.
                        <Link
                          href="/account"
                          className="inline-flex items-center gap-1.5 font-sans text-xs text-ink/55 transition-colors hover:text-saffron-deep"
                          title="Sign in to mark a review helpful"
                        >
                          <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
                          <span>
                            Helpful{r.helpfulCount > 0 ? ` (${r.helpfulCount})` : ''}
                            {' · Sign in'}
                          </span>
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Pagination (simple prev/next inline to match the mkt buy surface) */}
          {!loading && !error && totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="mkt-btn-ghost !py-2 !px-4 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span>Previous</span>
              </button>
              <span className="font-sans text-xs uppercase tracking-[0.08em] text-ink/50">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="mkt-btn-ghost !py-2 !px-4 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span>Next</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Write-a-review form ────────────────────────────────────────────────────────

function WriteReviewForm({
  productId,
  productName,
  onSubmitted,
}: {
  productId: string;
  productName: string;
  onSubmitted: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (rating < 1 || rating > 5) {
        setError('Please choose a star rating from 1 to 5.');
        return;
      }
      // The backend CreateReviewDto requires a non-empty `body`. Guard client-side
      // so the customer gets a clear, friendly message instead of a raw 400
      // validation error (and so an empty review never round-trips).
      const trimmedBody = body.trim();
      if (!trimmedBody) {
        setError('Please write a few words about your experience.');
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        await storeApi.submitReview(productId, {
          rating,
          title: title.trim() || undefined,
          body: trimmedBody,
        });
        setDone(true);
        setRating(0);
        setTitle('');
        setBody('');
        onSubmitted();
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : 'We could not submit your review. Please try again.',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [productId, rating, title, body, onSubmitted],
  );

  if (done) {
    return (
      <div className="mkt-card flex flex-col items-start gap-2 p-6">
        <div className="inline-flex items-center gap-2 text-forest">
          <Check className="h-5 w-5" />
          <h3 className="font-serif text-lg">Thanks for your review</h3>
        </div>
        <p className="font-sans text-sm text-ink/60">
          Your review is pending moderation and will appear once it has been
          approved.
        </p>
        <button
          type="button"
          onClick={() => setDone(false)}
          className="mt-1 font-sans text-xs font-semibold uppercase tracking-[0.08em] text-saffron-deep transition-opacity hover:opacity-80"
        >
          Write another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mkt-card flex flex-col gap-4 p-6">
      <h3 className="font-serif text-lg text-forest">Write a review</h3>
      <p className="-mt-2 font-sans text-xs text-ink/55">
        Share your experience with {productName}.
      </p>

      <div className="flex flex-col gap-1.5">
        <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink/55">
          Your rating
        </span>
        <StarInput value={rating} onChange={setRating} disabled={submitting} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="review-title"
          className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink/55"
        >
          Title <span className="text-ink/35">(optional)</span>
        </label>
        <input
          id="review-title"
          type="text"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Sum it up in a line"
          disabled={submitting}
          className="mkt-input px-4 py-2.5 disabled:opacity-60"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="review-body"
          className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink/55"
        >
          Review <span className="text-terracotta">*</span>
        </label>
        <textarea
          id="review-body"
          rows={4}
          value={body}
          maxLength={4000}
          required
          aria-required="true"
          onChange={(e) => setBody(e.target.value)}
          placeholder="What did you like or dislike? How did it perform?"
          disabled={submitting}
          className="mkt-input resize-none px-4 py-3 disabled:opacity-60"
        />
      </div>

      {error && (
        <p className="font-sans text-xs text-terracotta" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || rating < 1 || !body.trim()}
        className={cn(
          'mkt-btn',
          (submitting || rating < 1 || !body.trim()) && 'cursor-not-allowed opacity-60',
        )}
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Submitting…</span>
          </>
        ) : (
          <span>Submit review</span>
        )}
      </button>
    </form>
  );
}
