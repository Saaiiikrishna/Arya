'use client';

/**
 * Public DIY "build it yourself" page.
 *
 * Data: storeApi.getProductBuild(slug) → ProductBuild. The backend public
 * projection (diy.service.getBuildView) returns:
 *   { product, guide:{id,title,summary,difficulty,estimatedMinutes},
 *     steps:[{id,sortOrder,title,body,codeLanguage,code,media[]}],
 *     bom:[{kind:'SKU'|'PRODUCT'|'FREE_TEXT', ...}],
 *     bundle:{id,name,description,sku:{id,effectivePrice},virtualAvailable} | null }
 *
 * Money is INTEGER PAISE → <Money/>. Step bodies are author-controlled rich text;
 * any HTML they contain is rendered through the shared <BlockRenderer/> (RICH_TEXT)
 * so it is sanitised — never raw HTML. Step code uses <CodeBlock/>.
 *
 * Marketing surface (.mkt + DESIGN.md §7), Layout activeTab="store". 404 when the
 * product has no published guide.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  Clock,
  Gauge,
  Hammer,
  Loader2,
  Package,
  PackageX,
  Plus,
  ShoppingCart,
} from 'lucide-react';
import Layout from '@/components/Layout';
import {
  Money,
  StockBadge,
  CodeBlock,
  MediaGallery,
  BlockRenderer,
} from '@/components/store';
import type { GalleryMedia } from '@/components/store';
import { storeApi, ProductBuild } from '@/lib/storeApi';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { asStr as str, asNum as num, asObj as obj } from '../../_util';

// ── View models ───────────────────────────────────────────────────────────────

interface StepView {
  id: string;
  index: number;
  title: string | null;
  body: string | null;
  code: string | null;
  codeLanguage: string | null;
  media: GalleryMedia[];
}

interface BomComponent {
  id: string;
  kind: 'SKU' | 'PRODUCT' | 'FREE_TEXT';
  name: string;
  quantity: number;
  note: string | null;
  // SKU-only
  skuId: string | null;
  skuCode: string | null;
  effectivePrice: number | null;
  available: number | null;
  inStock: boolean;
  // PRODUCT cross-link only
  slug: string | null;
}

interface BundleView {
  id: string;
  name: string;
  description: string | null;
  skuId: string | null;
  price: number | null;
  available: number | null;
}

function toStepMedia(raw: unknown): GalleryMedia[] {
  if (!Array.isArray(raw)) return [];
  const out: GalleryMedia[] = [];
  for (const item of raw) {
    const m = obj(item);
    if (!m) continue;
    const url = str(m.url);
    if (!url) continue;
    out.push({
      url,
      type: m.type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
      caption: str(m.caption),
      altText: str(m.altText) ?? str(m.alt),
    });
  }
  return out;
}

function toBomComponent(raw: Record<string, unknown>): BomComponent {
  const kindRaw = str(raw.kind);
  const kind: BomComponent['kind'] =
    kindRaw === 'PRODUCT' ? 'PRODUCT' : kindRaw === 'FREE_TEXT' ? 'FREE_TEXT' : 'SKU';
  return {
    id: String(raw.id ?? ''),
    kind,
    name: str(raw.name) ?? str(raw.skuCode) ?? str(raw.freeTextName) ?? 'Component',
    quantity: num(raw.quantity) ?? 1,
    note: str(raw.note),
    skuId: str(raw.skuId),
    skuCode: str(raw.skuCode),
    effectivePrice: num(raw.effectivePrice),
    available: num(raw.available),
    inStock: raw.inStock === true || (num(raw.available) ?? 0) > 0,
    slug: str(raw.slug),
  };
}

function toBundleView(raw: Record<string, unknown> | null): BundleView | null {
  if (!raw) return null;
  const sku = obj(raw.sku);
  return {
    id: String(raw.id ?? ''),
    name: str(raw.name) ?? 'Full kit',
    description: str(raw.description),
    skuId: sku ? str(sku.id) : null,
    price: sku ? num(sku.effectivePrice) : null,
    available: num(raw.virtualAvailable) ?? num(raw.available),
  };
}

/** The guide id can live at build.guide.id (real shape) or build.guideId. */
function guideIdOf(build: ProductBuild): string | null {
  const guide = obj((build as Record<string, unknown>).guide);
  return (guide ? str(guide.id) : null) ?? str(build.guideId);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BuildPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  const [build, setBuild] = useState<ProductBuild | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const data = await storeApi.getProductBuild(slug);
      // The DIY endpoint is the authoritative gate: per COMMERCE_ARCHITECTURE
      // §4.5 it 404s when a product has no published guide. This client-side
      // guideId check is a defensive fallback for a guideless HTTP 200 only.
      if (!guideIdOf(data)) {
        setNotFound(true);
      } else {
        setBuild(data);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setError(
          err instanceof Error ? err.message : 'Failed to load this build guide.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Layout activeTab="store">
        <PageShell>
          <div className="flex min-h-[40vh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-forest/60" aria-label="Loading" />
          </div>
        </PageShell>
      </Layout>
    );
  }

  if (notFound) {
    return (
      <Layout activeTab="store">
        <PageShell>
          <EmptyState
            icon={<PackageX className="h-10 w-10" aria-hidden />}
            title="No build guide here"
            subtitle="This product does not have a do-it-yourself guide. Browse the store for kits that do."
            backHref={`/store/${encodeURIComponent(slug)}`}
            backLabel="Back to product"
          />
        </PageShell>
      </Layout>
    );
  }

  if (error || !build) {
    return (
      <Layout activeTab="store">
        <PageShell>
          <EmptyState
            icon={<PackageX className="h-10 w-10" aria-hidden />}
            title="Something went wrong"
            subtitle={error ?? 'We could not load this build guide.'}
            backHref={`/store/${encodeURIComponent(slug)}`}
            backLabel="Back to product"
            action={
              <button type="button" onClick={() => void load()} className="mkt-btn">
                <span>Try again</span>
              </button>
            }
          />
        </PageShell>
      </Layout>
    );
  }

  return (
    <Layout activeTab="store">
      <PageShell>
        <BuildView build={build} slug={slug} />
      </PageShell>
    </Layout>
  );
}

// ── Shell + empty state ────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mkt relative min-h-[calc(100dvh-80px)] overflow-hidden bg-parchment">
      <div
        aria-hidden
        className="mkt-float mkt-glow-pulse pointer-events-none absolute -top-32 -left-20 h-[28rem] w-[28rem] rounded-full"
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
  backHref,
  backLabel,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  backHref: string;
  backLabel: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
      <div className="text-ink/30">{icon}</div>
      <h1 className="font-serif text-2xl text-forest">{title}</h1>
      <p className="max-w-md font-sans text-sm text-ink/60">{subtitle}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        {action}
        <Link href={backHref} className="mkt-btn-ghost">
          <ArrowLeft className="h-4 w-4" />
          <span>{backLabel}</span>
        </Link>
      </div>
    </div>
  );
}

// ── Build view (loaded) ─────────────────────────────────────────────────────────

function BuildView({ build, slug }: { build: ProductBuild; slug: string }) {
  const guideId = guideIdOf(build);
  const guide = obj((build as Record<string, unknown>).guide) ?? {};
  const product = obj((build as Record<string, unknown>).product) ?? {};

  const guideTitle =
    str(guide.title) ?? str(product.name) ?? 'Build it yourself';
  const guideSummary = str(guide.summary);
  const difficulty = str(guide.difficulty);
  const estimatedMinutes = num(guide.estimatedMinutes);
  const productName = str(product.name);

  const steps = useMemo<StepView[]>(() => {
    const rows = Array.isArray(build.steps) ? build.steps : [];
    return rows.map((r, i) => {
      const s = obj(r) ?? {};
      return {
        id: String(s.id ?? `step-${i}`),
        index: i + 1,
        title: str(s.title),
        body: str(s.body),
        code: str(s.code),
        codeLanguage: str(s.codeLanguage),
        media: toStepMedia(s.media),
      };
    });
  }, [build.steps]);

  const bom = useMemo<BomComponent[]>(() => {
    const rows = Array.isArray(build.bom) ? build.bom : [];
    return rows.map((r) => toBomComponent(obj(r) ?? {})).filter((c) => c.id);
  }, [build.bom]);

  // `bundle` is a declared field on ProductBuild; access it directly to match how
  // `build.bom` and `build.steps` are read above (no redundant cast).
  const bundle = useMemo(() => toBundleView(obj(build.bundle)), [build.bundle]);

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
        <Link
          href={`/store/${encodeURIComponent(slug)}`}
          className="truncate transition-colors hover:text-saffron-deep"
        >
          {productName ?? 'Product'}
        </Link>
        <span aria-hidden>/</span>
        <span className="text-ink/70">Build</span>
      </nav>

      {/* Header */}
      <header className="mb-10 flex flex-col gap-4">
        <div className="mkt-pill w-fit">
          <Hammer className="h-3.5 w-3.5 text-saffron-deep" />
          <span className="font-sans text-[10px] font-bold uppercase tracking-[0.18em] text-forest/80">
            Do it yourself
          </span>
        </div>
        <h1 className="font-serif text-3xl font-bold leading-[1.0] tracking-[-0.02em] text-forest sm:text-4xl md:text-5xl">
          {guideTitle}
        </h1>
        {guideSummary && (
          <p className="max-w-2xl font-sans text-base leading-relaxed text-ink/70">
            {guideSummary}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {difficulty && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/60 px-3 py-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-forest">
              <Gauge className="h-3.5 w-3.5 text-saffron-deep" aria-hidden />
              {difficulty}
            </span>
          )}
          {estimatedMinutes != null && estimatedMinutes > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/60 px-3 py-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-forest">
              <Clock className="h-3.5 w-3.5 text-saffron-deep" aria-hidden />
              ~{estimatedMinutes} min
            </span>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_22rem] lg:gap-10 3xl:gap-14">
        {/* Steps */}
        <div className="flex flex-col gap-8">
          <h2 className="font-serif text-2xl text-forest">Steps</h2>
          {steps.length === 0 ? (
            <p className="font-sans text-sm italic text-ink/40">
              No steps have been published yet.
            </p>
          ) : (
            <ol className="flex flex-col gap-8">
              {steps.map((step) => (
                <li key={step.id} className="mkt-card p-6 md:p-7">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-forest font-sans text-sm font-bold text-parchment">
                      {step.index}
                    </span>
                    {step.title && (
                      <h3 className="font-serif text-xl text-forest">
                        {step.title}
                      </h3>
                    )}
                  </div>

                  <div className="mt-5 flex flex-col gap-5">
                    {step.media.length > 0 && (
                      <MediaGallery media={step.media} mkt aspect="aspect-video" />
                    )}

                    {step.body && (
                      // Step body is author-authored rich text → route through the
                      // shared BlockRenderer (RICH_TEXT) so HTML is sanitised.
                      <BlockRenderer
                        blocks={[{ type: 'RICH_TEXT', content: { html: step.body } }]}
                      />
                    )}

                    {step.code && (
                      <CodeBlock
                        code={step.code}
                        language={step.codeLanguage ?? undefined}
                        showLineNumbers
                        className="rounded-xl"
                      />
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* BOM + kit purchase rail */}
        <aside className="flex flex-col gap-6 lg:sticky lg:top-28 lg:self-start">
          {/* guideId is non-null here: BuildView is only mounted after the page
              gates on guideIdOf(build) (the load() 404 guard). */}
          {bundle && guideId && (
            <BundlePurchase guideId={guideId} bundle={bundle} />
          )}

          {guideId && <BomList guideId={guideId} bom={bom} />}
        </aside>
      </div>
    </motion.div>
  );
}

// ── Bundle "buy the full kit" card ───────────────────────────────────────────────

function BundlePurchase({
  guideId,
  bundle,
}: {
  guideId: string;
  bundle: BundleView;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [err, setErr] = useState<string | null>(null);
  // Purchasability semantics (COMMERCE_ARCHITECTURE §8.6): bundle availability is
  // min(floor(memberAvailable/memberQty)). A concrete 0 means depleted → block the
  // button. A null/unknown means "let the server decide" — we keep the button
  // enabled and rely on the backend to reject a bad reservation with an error.
  const purchasable = bundle.available == null || bundle.available > 0;

  const buy = useCallback(async () => {
    setState('busy');
    setErr(null);
    try {
      await storeApi.addDiyToCart({ guideId, mode: 'BUNDLE' });
      setState('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add the kit to your cart.');
      setState('idle');
    }
  }, [guideId]);

  // Auto-revert the transient "done" confirmation, cleaned up on unmount.
  useEffect(() => {
    if (state !== 'done') return;
    const t = window.setTimeout(() => setState('idle'), 2200);
    return () => window.clearTimeout(t);
  }, [state]);

  return (
    <div className="mkt-card overflow-hidden">
      <div className="bg-forest px-6 py-5 text-parchment">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-marigold" aria-hidden />
          <span className="font-sans text-[10px] font-bold uppercase tracking-[0.16em] text-parchment/80">
            Everything in one box
          </span>
        </div>
        <h3 className="mt-2 font-serif text-xl">{bundle.name}</h3>
        {bundle.description && (
          <p className="mt-1 font-sans text-sm leading-relaxed text-parchment/75">
            {bundle.description}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-baseline justify-between gap-3">
          {bundle.price != null ? (
            <Money
              paise={bundle.price}
              className="font-sans text-2xl font-bold text-forest"
            />
          ) : (
            <span className="font-sans text-sm text-ink/50">Price on request</span>
          )}
          <StockBadge qty={bundle.available} mkt />
        </div>

        <button
          type="button"
          onClick={() => void buy()}
          disabled={!purchasable || state === 'busy'}
          className={cn(
            'mkt-btn w-full',
            (!purchasable || state === 'busy') && 'cursor-not-allowed opacity-60',
          )}
        >
          {state === 'busy' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Adding…</span>
            </>
          ) : state === 'done' ? (
            <>
              <Check className="h-4 w-4" />
              <span>Kit added</span>
            </>
          ) : (
            <>
              <ShoppingCart className="h-4 w-4" />
              <span>Buy the full kit</span>
            </>
          )}
        </button>

        {err && (
          <p className="font-sans text-xs text-terracotta" role="alert">
            {err}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Bill of materials ──────────────────────────────────────────────────────────

/**
 * A single BOM row: owns its own add-to-cart state machine so each row's busy /
 * done / error state is self-contained (no shared keyed maps to keep in sync).
 */
function BomRow({ c }: { c: BomComponent }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [err, setErr] = useState<string | null>(null);

  const isSku = c.kind === 'SKU' && !!c.skuId;
  const canAdd = isSku && c.inStock && state !== 'busy';

  const add = useCallback(async () => {
    if (!c.skuId) return;
    setState('busy');
    setErr(null);
    try {
      await storeApi.addCartItem({
        skuId: c.skuId,
        qty: c.quantity > 0 ? c.quantity : 1,
      });
      setState('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add this component.');
      setState('idle');
    }
  }, [c.skuId, c.quantity]);

  // Auto-revert the transient "done" confirmation, cleaned up on unmount.
  useEffect(() => {
    if (state !== 'done') return;
    const t = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(t);
  }, [state]);

  return (
    <li className="flex flex-col gap-1.5 py-4 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {c.kind === 'PRODUCT' && c.slug ? (
            <Link
              href={`/store/${encodeURIComponent(c.slug)}`}
              className="font-sans text-sm font-semibold text-forest hover:text-saffron-deep"
            >
              {c.name}
            </Link>
          ) : (
            <span className="font-sans text-sm font-semibold text-forest">
              {c.name}
            </span>
          )}
          <span className="font-sans text-xs text-ink/50">
            Qty {c.quantity}
            {c.skuCode ? ` · ${c.skuCode}` : ''}
          </span>
          {c.note && (
            <span className="font-sans text-xs italic text-ink/45">{c.note}</span>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {isSku && c.effectivePrice != null && (
            <Money
              paise={c.effectivePrice}
              className="font-sans text-sm font-bold text-forest"
            />
          )}
          {isSku && <StockBadge qty={c.available} mkt />}
          {c.kind === 'FREE_TEXT' && (
            <span className="font-sans text-[10px] uppercase tracking-[0.06em] text-ink/40">
              Source yourself
            </span>
          )}
        </div>
      </div>

      {isSku && (
        <button
          type="button"
          onClick={() => void add()}
          disabled={!canAdd}
          className={cn(
            'mt-1 inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors',
            canAdd
              ? 'border-saffron/60 text-saffron-deep hover:bg-saffron-glow/25'
              : 'cursor-not-allowed border-hairline text-ink/35',
          )}
        >
          {state === 'busy' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Adding
            </>
          ) : state === 'done' ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Added
            </>
          ) : c.inStock ? (
            <>
              <Plus className="h-3.5 w-3.5" />
              Add to cart
            </>
          ) : (
            'Out of stock'
          )}
        </button>
      )}

      {err && (
        <p className="font-sans text-[11px] text-terracotta" role="alert">
          {err}
        </p>
      )}
    </li>
  );
}

function BomList({
  guideId,
  bom,
}: {
  guideId: string;
  bom: BomComponent[];
}) {
  const [allState, setAllState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [allErr, setAllErr] = useState<string | null>(null);

  const hasPurchasableSku = bom.some((c) => c.kind === 'SKU' && c.skuId);

  const addAll = useCallback(async () => {
    setAllState('busy');
    setAllErr(null);
    try {
      await storeApi.addDiyToCart({ guideId, mode: 'COMPONENTS' });
      setAllState('done');
    } catch (e) {
      setAllErr(
        e instanceof Error ? e.message : 'Could not add the components to your cart.',
      );
      setAllState('idle');
    }
  }, [guideId]);

  // Auto-revert the transient "done" confirmation, cleaned up on unmount.
  useEffect(() => {
    if (allState !== 'done') return;
    const t = window.setTimeout(() => setAllState('idle'), 2200);
    return () => window.clearTimeout(t);
  }, [allState]);

  return (
    <div className="mkt-card p-6">
      <h3 className="font-serif text-xl text-forest">Bill of materials</h3>
      <p className="mt-1 font-sans text-xs text-ink/55">
        Everything you need to build it from scratch.
      </p>

      {bom.length === 0 ? (
        <p className="mt-5 font-sans text-sm italic text-ink/40">
          No components have been listed yet.
        </p>
      ) : (
        <ul className="mt-5 flex flex-col divide-y divide-hairline/70">
          {bom.map((c) => (
            <BomRow key={c.id} c={c} />
          ))}
        </ul>
      )}

      {hasPurchasableSku && (
        <div className="mt-5 border-t border-hairline/70 pt-5">
          <button
            type="button"
            onClick={() => void addAll()}
            disabled={allState === 'busy'}
            className={cn(
              'mkt-btn-ghost w-full',
              allState === 'busy' && 'cursor-not-allowed opacity-60',
            )}
          >
            {allState === 'busy' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Adding…</span>
              </>
            ) : allState === 'done' ? (
              <>
                <Check className="h-4 w-4" />
                <span>All components added</span>
              </>
            ) : (
              <>
                <ShoppingCart className="h-4 w-4" />
                <span>Add all components</span>
              </>
            )}
          </button>
          {allErr && (
            <p className="mt-2 font-sans text-xs text-terracotta" role="alert">
              {allErr}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
