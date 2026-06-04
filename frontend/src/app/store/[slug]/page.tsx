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
} from 'lucide-react';
import Layout from '@/components/Layout';
import {
  Money,
  StockBadge,
  MediaGallery,
  Tabs,
  BlockRenderer,
} from '@/components/store';
import type { GalleryMedia, ContentBlock } from '@/components/store';
import { storeApi, ProductDetail } from '@/lib/storeApi';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { str, num } from '../_util';

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
  const basePrice = num(raw.basePrice);
  const salePrice = num(raw.salePrice);
  const effectivePrice = num(raw.effectivePrice) ?? salePrice ?? basePrice;
  return {
    id: String(raw.id ?? ''),
    name: str(raw.name) ?? str(raw.skuCode) ?? 'Default',
    skuCode: str(raw.skuCode),
    effectivePrice,
    basePrice,
    salePrice,
    available: num(stock.available),
    // Treat the explicit boolean `inStock === true` as authoritative; otherwise
    // fall back to a positive available count. A truthy non-boolean (e.g. the
    // string 'true') must NOT over-report as in stock, hence `=== true`.
    inStock: stock.inStock === true || (num(stock.available) ?? 0) > 0,
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
    const url = str((r as Record<string, unknown>).url);
    if (!url) continue;
    const type =
      (r as Record<string, unknown>).type === 'VIDEO' ? 'VIDEO' : 'IMAGE';
    out.push({
      url,
      type,
      caption: str((r as Record<string, unknown>).caption),
      altText: str((r as Record<string, unknown>).altText),
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
    <div className="mkt relative min-h-[calc(100vh-80px)] bg-parchment">
      <div
        aria-hidden
        className="mkt-float mkt-glow-pulse pointer-events-none absolute -top-32 right-0 h-[30rem] w-[30rem] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(244,163,0,0.16), transparent 64%)',
        }}
      />
      <div className="relative z-10 mx-auto max-w-screen-xl px-6 py-10 md:px-8 md:py-14">
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
      await storeApi.addCartItem({ skuId: selectedSku.id, qty });
      setAdded(true);
    } catch (err) {
      setCartError(
        err instanceof Error ? err.message : 'Could not add this to your cart.',
      );
    } finally {
      setAdding(false);
    }
  }, [selectedSku, qty]);

  const eyebrow = str(product.brand) ?? str(product.subtitle);
  // Buy-box paragraph: the dedicated short description, falling back only to the
  // subtitle — never the full long-form `description` (that belongs in a tab).
  const shortDesc = str(product.shortDescription) ?? str(product.subtitle);

  // Tabs: admin-defined tab/section tree. Each tab.sections → BlockRenderer.
  const tabItems = useMemo(() => {
    const rawTabs = Array.isArray(product.tabs) ? product.tabs : [];
    return rawTabs
      .map((t, i) => {
        const tab = t as Record<string, unknown>;
        const title = str(tab.title) ?? `Section ${i + 1}`;
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 font-sans text-[11px] uppercase tracking-[0.08em] text-ink/45">
        <Link href="/store" className="transition-colors hover:text-saffron-deep">
          Store
        </Link>
        <span aria-hidden>/</span>
        <span className="truncate text-ink/70">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
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
          <h1 className="font-serif-display text-4xl font-bold leading-[1.02] tracking-[-0.02em] text-forest md:text-5xl">
            {product.name}
          </h1>

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
                      // Rounded corners are the DESIGN.md §7 mkt-* premium-layer
                      // exception (this is a public marketing surface inside `.mkt`),
                      // not the 0px default that governs the rest of the app.
                      className={cn(
                        'flex flex-col items-start gap-0.5 rounded-xl border px-4 py-2.5 text-left transition-colors',
                        active
                          ? 'border-saffron bg-saffron-glow/20'
                          : 'border-hairline bg-white/50 hover:border-saffron/50',
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
            <div className="flex items-center gap-4">
              {/* Pill stepper: rounded per the DESIGN.md §7 mkt-* marketing-layer
                  exception (matches the catalog page's filter pills inside `.mkt`). */}
              <div className="inline-flex items-center rounded-full border border-hairline bg-white/60">
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
    </motion.div>
  );
}
