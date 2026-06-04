'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Tabs, Money } from '@/components/store';
import ProductFieldsTab from './ProductFieldsTab';
import SkusTab from './SkusTab';
import TabsBuilderTab from './TabsBuilderTab';
import MediaTab from './MediaTab';
import DiyTab from './DiyTab';
import type { ProductDetail, ProductSku } from './types';
import { ArrowLeft, AlertCircle, ExternalLink } from 'lucide-react';

/**
 * Admin Product detail / editor — 3-panel pattern, detail variant.
 *
 * The full nested product tree (`api.adminGetStoreProduct`) is loaded once and
 * passed to each tab. Tabs mutate via their own admin api calls and call
 * `onChanged()` to refetch the canonical tree so every panel stays in sync.
 */

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-marigold/15 text-warning border-marigold/40',
  ACTIVE: 'bg-success/10 text-success border-success/25',
  ARCHIVED: 'bg-ink/5 text-ink/50 border-ink/15',
};

export default function AdminProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next.js 16: route params are a Promise — unwrap with React.use().
  const { id } = use(params);
  const router = useRouter();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('fields');

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = (await api.adminGetStoreProduct(id)) as ProductDetail;
      setProduct(p);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to load product');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Product</p>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="text-ink px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
        <Link
          href="/admin/store/products"
          className="text-forest text-sm uppercase tracking-widest font-bold mb-8 inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Products
        </Link>
        <div className="border border-terracotta/30 bg-terracotta/5 p-10 text-center">
          <AlertCircle className="w-8 h-8 mx-auto mb-3 text-terracotta" />
          <p className="text-sm text-terracotta mb-4">{error || 'Product not found.'}</p>
          <button
            onClick={() => {
              setLoading(true);
              load();
            }}
            className="px-5 py-2.5 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const skuCount = product.skus?.length ?? 0;
  const tabCount = product.tabs?.length ?? 0;
  const mediaCount = product.media?.length ?? 0;
  const hasDiy = !!product.diyGuide;

  const tabItems = [
    {
      key: 'fields',
      label: 'Product',
      content: <ProductFieldsTab product={product} onChanged={load} onArchived={() => router.push('/admin/store/products')} />,
    },
    {
      key: 'skus',
      label: `SKUs${skuCount ? ` (${skuCount})` : ''}`,
      content: <SkusTab product={product} onChanged={load} />,
    },
    {
      key: 'tabs',
      label: `Content Tabs${tabCount ? ` (${tabCount})` : ''}`,
      content: <TabsBuilderTab product={product} onChanged={load} />,
    },
    {
      key: 'media',
      label: `Media${mediaCount ? ` (${mediaCount})` : ''}`,
      content: <MediaTab product={product} onChanged={load} />,
    },
    {
      key: 'diy',
      label: `DIY${hasDiy ? ' (active)' : ''}`,
      content: <DiyTab product={product} onChanged={load} />,
    },
  ];

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      <Link
        href="/admin/store/products"
        className="text-forest text-sm uppercase tracking-widest font-bold mb-6 inline-flex items-center gap-1"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Products
      </Link>

      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-8 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <span
              className={`px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${
                STATUS_STYLE[product.status] || STATUS_STYLE.DRAFT
              }`}
            >
              {product.status}
            </span>
            <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border bg-forest/5 text-forest border-forest/20">
              {product.type}
            </span>
          </div>
          <h1 className="font-serif text-4xl font-bold leading-tight">{product.name}</h1>
          <div className="mt-2 text-xs text-ink/50 flex items-center gap-3 flex-wrap">
            <code className="bg-alabaster px-2 py-0.5">/{product.slug}</code>
            {product.status === 'ACTIVE' && (
              <a
                href={`/store/products/${product.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-forest hover:text-saffron-deep inline-flex items-center gap-1 transition-colors"
              >
                View on storefront <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          {product.skus && product.skus.length > 0 && (
            <div className="text-xs text-ink/50">
              From{' '}
              <span className="font-bold text-ink/80">
                <Money
                  paise={Math.min(
                    ...product.skus.map((s: ProductSku) =>
                      s.salePrice != null && s.salePrice < s.basePrice ? s.salePrice : s.basePrice,
                    ),
                  )}
                />
              </span>
            </div>
          )}
        </div>
      </header>

      <Tabs tabs={tabItems} activeKey={activeTab} onChange={setActiveTab} />
    </div>
  );
}
