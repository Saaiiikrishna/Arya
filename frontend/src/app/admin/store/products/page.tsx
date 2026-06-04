'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { storeApi } from '@/lib/storeApi';
import { Modal, Pagination, Money } from '@/components/store';
import {
  Package, Plus, Search, ChevronRight, Star, AlertCircle, X,
} from 'lucide-react';

/**
 * Admin Product Manager — list panel.
 *
 * LISTING SOURCE (documented constraint): the backend exposes NO admin
 * product-list route — only `POST /admin/store/products`, `GET /admin/store/products/:id`,
 * and the PUBLIC `GET /api/store/products` (ACTIVE, non-DIGITAL only). With api.ts
 * frozen, the public list (via `storeApi.listProducts`) is the only paginated
 * source available. It therefore shows PUBLISHED (ACTIVE) products; DRAFT and
 * ARCHIVED products are reachable by id from the detail editor. A newly created
 * DRAFT routes the admin straight into its detail page so it is never lost.
 */

const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
const PRODUCT_TYPES = ['STANDARD', 'BUNDLE', 'DIGITAL'] as const;
const PAGE_SIZE = 20;

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  subtitle?: string | null;
  brand?: string | null;
  category?: string | Record<string, unknown> | null;
  tags?: string[];
  isFeatured?: boolean;
  priceFrom?: number | null;
  priceTo?: number | null;
  thumbnail?: { url?: string | null; altText?: string | null } | null;
}

interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  children?: CategoryNode[];
}

const EMPTY_CREATE = {
  name: '',
  subtitle: '',
  brand: '',
  shortDescription: '',
  status: 'DRAFT',
  type: 'STANDARD',
  categoryId: '',
  tags: '',
  isFeatured: false,
};

/** Flatten the category tree into [{id, name, depth}] for the select. */
function flattenCategories(nodes: CategoryNode[], depth = 0): { id: string; name: string; depth: number }[] {
  const out: { id: string; name: string; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, depth });
    if (n.children?.length) out.push(...flattenCategories(n.children, depth + 1));
  }
  return out;
}

export default function AdminProductsPage() {
  const router = useRouter();

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');

  const [categories, setCategories] = useState<{ id: string; name: string; depth: number; slug?: string }[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      const tree = (await api.adminGetStoreCategoryTree()) as CategoryNode[];
      const flat = flattenCategories(Array.isArray(tree) ? tree : []);
      // Keep the slug alongside id+name so the list filter (which the public
      // endpoint keys by slug) can resolve a selected category to its slug.
      const withSlug = flat.map((f) => {
        const findSlug = (nodes: CategoryNode[]): string | undefined => {
          for (const n of nodes) {
            if (n.id === f.id) return n.slug;
            if (n.children) {
              const s = findSlug(n.children);
              if (s) return s;
            }
          }
          return undefined;
        };
        return { ...f, slug: findSlug(Array.isArray(tree) ? tree : []) };
      });
      setCategories(withSlug);
    } catch {
      // Non-fatal: the create form + filter degrade to "no categories".
      setCategories([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await storeApi.listProducts({
        page,
        limit: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(featuredOnly ? { featured: true } : {}),
        ...(categoryFilter ? { category: categoryFilter } : {}),
      });
      setRows((res.data as ProductRow[]) ?? []);
      setMeta({
        page: res.meta?.page ?? 1,
        totalPages: res.meta?.totalPages ?? 1,
        total: res.meta?.total ?? 0,
      });
    } catch (e) {
      setError((e as Error)?.message || 'Failed to load products');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, featuredOnly, categoryFilter]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    load();
  }, [load]);

  const applySearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim()) {
      setCreateError('Product name is required');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const tags = createForm.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const body = {
        name: createForm.name.trim(),
        status: createForm.status,
        type: createForm.type,
        isFeatured: createForm.isFeatured,
        ...(createForm.subtitle.trim() && { subtitle: createForm.subtitle.trim() }),
        ...(createForm.brand.trim() && { brand: createForm.brand.trim() }),
        ...(createForm.shortDescription.trim() && {
          shortDescription: createForm.shortDescription.trim(),
        }),
        ...(createForm.categoryId && { categoryId: createForm.categoryId }),
        ...(tags.length && { tags }),
      };
      const created = await api.adminCreateStoreProduct(body);
      setShowCreate(false);
      setCreateForm({ ...EMPTY_CREATE });
      // Route straight into the detail editor — DRAFTs never appear in the
      // ACTIVE-only public list, so this is how the admin keeps working on it.
      if (created?.id) {
        router.push(`/admin/store/products/${created.id}`);
      } else {
        await load();
      }
    } catch (e) {
      setCreateError((e as Error)?.message || 'Failed to create product');
    } finally {
      setCreating(false);
    }
  };

  const categoryLabel = (c: ProductRow['category']): string | null => {
    if (!c) return null;
    if (typeof c === 'string') return c;
    return (c as { name?: string }).name ?? null;
  };

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-10 flex justify-between items-end gap-6">
        <div>
          <Link
            href="/admin/dashboard"
            className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block"
          >
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Products</h1>
          <p className="text-ink/50 mt-2 font-serif italic">
            Catalog manager — products, SKUs, tabs, media &amp; DIY
          </p>
        </div>
        <button
          onClick={() => {
            setCreateForm({ ...EMPTY_CREATE });
            setCreateError(null);
            setShowCreate(true);
          }}
          className="px-6 py-3 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep transition-colors flex items-center gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" /> New Product
        </button>
      </header>

      {/* Listing-scope note */}
      <div className="mb-6 flex items-start gap-2 border border-hairline bg-alabaster px-4 py-3 text-xs text-ink/55">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-forest/50" />
        <span>
          This list shows <strong className="text-ink/70">published (ACTIVE)</strong> products. Newly
          created drafts open directly in their editor; reach any DRAFT or ARCHIVED product from its
          detail page.
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <form onSubmit={applySearch} className="flex items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/30" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, subtitle or brand…"
              className="w-full border border-hairline pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-forest bg-white"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2.5 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors"
          >
            Search
          </button>
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setSearchInput('');
                setPage(1);
              }}
              className="text-ink/40 hover:text-terracotta transition-colors"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </form>

        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className="border border-hairline px-3 py-2.5 text-sm focus:outline-none focus:border-forest bg-white"
        >
          <option value="">All categories</option>
          {categories
            .filter((c) => c.slug)
            .map((c) => (
              <option key={c.id} value={c.slug}>
                {`${'  '.repeat(c.depth)}${c.name}`}
              </option>
            ))}
        </select>

        <button
          onClick={() => {
            setFeaturedOnly((v) => !v);
            setPage(1);
          }}
          className={`px-4 py-2.5 text-[10px] uppercase tracking-widest font-bold border transition-colors flex items-center gap-1.5 ${
            featuredOnly
              ? 'border-saffron bg-saffron text-parchment'
              : 'border-hairline bg-white text-ink/60 hover:border-forest/30'
          }`}
        >
          <Star className="w-3.5 h-3.5" /> Featured
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="p-16 text-center">
          <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Products</p>
        </div>
      ) : error ? (
        <div className="border border-terracotta/30 bg-terracotta/5 p-8 text-center">
          <AlertCircle className="w-7 h-7 mx-auto mb-3 text-terracotta" />
          <p className="text-sm text-terracotta mb-4">{error}</p>
          <button
            onClick={() => load()}
            className="px-5 py-2.5 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="border border-hairline bg-white">
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
              <div className="col-span-5">Product</div>
              <div className="col-span-2">Category</div>
              <div className="col-span-2">Price From</div>
              <div className="col-span-1 text-center">Featured</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {rows.length === 0 ? (
              <div className="p-16 text-center text-ink/40">
                <Package className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="font-serif italic">
                  {search || categoryFilter || featuredOnly
                    ? 'No published products match these filters.'
                    : 'No published products yet.'}
                </p>
              </div>
            ) : (
              rows.map((p) => (
                <div
                  key={p.id}
                  className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm"
                >
                  <div className="col-span-5 flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 border border-hairline bg-parchment shrink-0 overflow-hidden flex items-center justify-center">
                      {p.thumbnail?.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.thumbnail.url}
                          alt={p.thumbnail.altText ?? p.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Package className="w-4 h-4 text-ink/25" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold truncate">{p.name}</div>
                      <div className="text-[10px] text-ink/40 truncate">
                        {p.brand ? `${p.brand} · ` : ''}
                        <code className="bg-alabaster px-1">{p.slug}</code>
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 text-xs text-ink/60 truncate">
                    {categoryLabel(p.category) || <span className="text-ink/25">—</span>}
                  </div>
                  <div className="col-span-2 text-sm font-semibold">
                    {p.priceFrom != null ? (
                      <Money paise={p.priceFrom} />
                    ) : (
                      <span className="text-ink/25 text-xs uppercase tracking-widest">No SKU</span>
                    )}
                  </div>
                  <div className="col-span-1 text-center">
                    {p.isFeatured ? (
                      <Star className="w-4 h-4 text-saffron inline" fill="currentColor" />
                    ) : (
                      <span className="text-ink/20">—</span>
                    )}
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <Link
                      href={`/admin/store/products/${p.id}`}
                      className="px-3 py-1.5 border border-hairline text-[10px] uppercase tracking-widest font-bold hover:border-forest hover:text-forest transition-colors flex items-center gap-1"
                    >
                      Edit <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>

          {meta.totalPages > 1 && (
            <div className="mt-8">
              <Pagination page={meta.page} totalPages={meta.totalPages} onPageChange={setPage} />
            </div>
          )}
          <p className="text-center text-[10px] uppercase tracking-widest text-ink/35 mt-4">
            {meta.total} published product{meta.total !== 1 ? 's' : ''}
          </p>
        </>
      )}

      {/* Create modal */}
      <Modal
        open={showCreate}
        onClose={() => !creating && setShowCreate(false)}
        title="New Product"
        size="max-w-2xl"
        dismissible={!creating}
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              disabled={creating}
              className="px-6 py-3 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-product-form"
              disabled={creating}
              className="px-8 py-3 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating…' : 'Create & Edit'}
            </button>
          </>
        }
      >
        <form id="create-product-form" onSubmit={handleCreate} className="space-y-5">
          {createError && (
            <div className="flex items-center gap-2 border border-terracotta/40 bg-terracotta/5 px-3 py-2 text-xs text-terracotta">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {createError}
            </div>
          )}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">
              Name *
            </label>
            <input
              type="text"
              autoFocus
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              placeholder="e.g., ESP32-WROOM Dev Board"
              className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
            />
            <p className="text-[10px] text-ink/40 mt-1">
              A URL slug is generated automatically from the name.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">
                Subtitle
              </label>
              <input
                type="text"
                value={createForm.subtitle}
                onChange={(e) => setCreateForm({ ...createForm, subtitle: e.target.value })}
                className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">
                Brand
              </label>
              <input
                type="text"
                value={createForm.brand}
                onChange={(e) => setCreateForm({ ...createForm, brand: e.target.value })}
                className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">
                Status
              </label>
              <select
                value={createForm.status}
                onChange={(e) => setCreateForm({ ...createForm, status: e.target.value })}
                className="w-full border border-hairline px-3 py-3 text-sm focus:outline-none focus:border-forest bg-white"
              >
                {PRODUCT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">
                Type
              </label>
              <select
                value={createForm.type}
                onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}
                className="w-full border border-hairline px-3 py-3 text-sm focus:outline-none focus:border-forest bg-white"
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">
                Category
              </label>
              <select
                value={createForm.categoryId}
                onChange={(e) => setCreateForm({ ...createForm, categoryId: e.target.value })}
                className="w-full border border-hairline px-3 py-3 text-sm focus:outline-none focus:border-forest bg-white"
              >
                <option value="">None</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {`${'  '.repeat(c.depth)}${c.name}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">
              Short Description
            </label>
            <textarea
              rows={2}
              value={createForm.shortDescription}
              onChange={(e) => setCreateForm({ ...createForm, shortDescription: e.target.value })}
              className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={createForm.tags}
              onChange={(e) => setCreateForm({ ...createForm, tags: e.target.value })}
              placeholder="microcontroller, wifi, iot"
              className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input
              type="checkbox"
              checked={createForm.isFeatured}
              onChange={(e) => setCreateForm({ ...createForm, isFeatured: e.target.checked })}
              className="accent-saffron"
            />
            Feature this product
          </label>
        </form>
      </Modal>
    </div>
  );
}
