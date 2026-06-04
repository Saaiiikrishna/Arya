'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Modal, Pagination, Money } from '@/components/store';
import {
  Package, Plus, Search, ChevronRight, Star, AlertCircle, X,
} from 'lucide-react';

/**
 * Admin Product Manager — list panel.
 *
 * LISTING SOURCE: the dedicated admin list route `GET /admin/store/products`
 * (via `api.adminListProducts`) returns products of ALL statuses
 * (DRAFT/ACTIVE/ARCHIVED) — unlike the public `GET /api/store/products`, which is
 * ACTIVE + non-DIGITAL only. Drafts and archived products are therefore visible
 * directly in this list, with a status filter to narrow the view. Each row
 * carries a presigned thumbnail (first confirmed product image).
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
  // The admin list projection returns the denormalized `category` TEXT column —
  // always a plain string or null (never a nested object) for this endpoint.
  category?: string | null;
  tags?: string[];
  status?: string;
  type?: string;
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

/**
 * Tonal status pill colours (DESIGN.md: no shadows, 0px radius, hairline depth).
 * The `/<n>` opacity utilities (e.g. `border-forest/40`, `bg-forest/5`) depend on
 * the base tokens — `forest`, `terracotta`, `hairline`, `alabaster`, `ink` — being
 * defined in the Tailwind config as colours that support the `/<opacity>` modifier.
 * Source of truth: tailwind.config + DESIGN.md palette. If a token is renamed, the
 * opacity variant silently produces no output, so keep these in sync with the config.
 */
const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'border-forest/40 text-forest bg-forest/5',
  DRAFT: 'border-hairline text-ink/50 bg-alabaster',
  ARCHIVED: 'border-terracotta/40 text-terracotta bg-terracotta/5',
};

/** Flatten the category tree into [{id, name, depth, slug}] for the select. */
function flattenCategories(
  nodes: CategoryNode[],
  depth = 0,
): { id: string; name: string; depth: number; slug: string }[] {
  const out: { id: string; name: string; depth: number; slug: string }[] = [];
  for (const n of nodes) {
    // The slug is available on the original tree node at the moment of flattening,
    // so carry it through here — no separate O(N*M) re-traversal per flat node.
    out.push({ id: n.id, name: n.name, depth, slug: n.slug });
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
  const [statusFilter, setStatusFilter] = useState('');

  const [categories, setCategories] = useState<{ id: string; name: string; depth: number; slug: string }[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      const tree = (await api.adminGetStoreCategoryTree()) as CategoryNode[];
      // flattenCategories carries each node's slug through directly (O(N)); no
      // per-node re-traversal of the tree is needed.
      setCategories(flattenCategories(Array.isArray(tree) ? tree : []));
    } catch {
      // Non-fatal: the create form degrades to "no categories".
      setCategories([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Admin list: ALL statuses (DRAFT/ACTIVE/ARCHIVED), optionally narrowed by
      // the status filter. Search matches name/slug; pagination via meta.
      const res = await api.adminListProducts({
        page,
        limit: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
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
  }, [page, search, statusFilter]);

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
      // Route straight into the detail editor so the admin can keep building the
      // new product (add SKUs, media, tabs) without an extra navigation step.
      if (created?.id) {
        router.push(`/admin/store/products/${created.id}`);
      } else {
        // Unreachable in production — the backend always returns the created
        // product with its UUID. If the response shape ever changes (id nested
        // differently), surface a warning rather than silently just reloading.
        console.warn(
          'Create product: response had no `id`; reloading the list instead of navigating to the detail editor.',
        );
        await load();
      }
    } catch (e) {
      setCreateError((e as Error)?.message || 'Failed to create product');
    } finally {
      setCreating(false);
    }
  };

  // The admin list returns `category` as a plain denormalized string (or null);
  // no nested-object branch is reachable from this endpoint's response shape.
  const categoryLabel = (c: ProductRow['category']): string | null => c ?? null;

  return (
    <div className="text-ink animate-fade-in px-4 sm:px-6 lg:px-8 py-8 sm:py-12 max-w-[1200px] 3xl:max-w-[1600px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-10 flex flex-wrap justify-between items-end gap-6">
        <div>
          <Link
            href="/admin/dashboard"
            className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block"
          >
            ← Command Center
          </Link>
          <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold leading-none">Products</h1>
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <form onSubmit={applySearch} className="flex items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/30" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name or slug…"
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
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="border border-hairline px-3 py-2.5 text-sm focus:outline-none focus:border-forest bg-white"
        >
          <option value="">All statuses</option>
          {PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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
          <div className="border border-hairline bg-white overflow-x-auto">
            <div className="min-w-[820px]">
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
              <div className="col-span-4">Product</div>
              <div className="col-span-2">Category</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-1">Price From</div>
              <div className="col-span-1 text-center">Featured</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {rows.length === 0 ? (
              <div className="p-16 text-center text-ink/40">
                <Package className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="font-serif italic">
                  {search || statusFilter
                    ? 'No products match these filters.'
                    : 'No products yet.'}
                </p>
              </div>
            ) : (
              rows.map((p) => (
                <div
                  key={p.id}
                  className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm"
                >
                  <div className="col-span-4 flex items-center gap-3 min-w-0">
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
                  <div className="col-span-2">
                    {p.status ? (
                      <span
                        className={`inline-block px-2 py-1 text-[9px] uppercase tracking-widest font-bold border ${
                          STATUS_STYLES[p.status] ?? 'border-hairline text-ink/50 bg-alabaster'
                        }`}
                      >
                        {p.status}
                      </span>
                    ) : (
                      <span className="text-ink/20">—</span>
                    )}
                  </div>
                  <div className="col-span-1 text-sm font-semibold">
                    {p.priceFrom != null ? (
                      <Money paise={p.priceFrom} />
                    ) : (
                      <span className="text-ink/25 text-[10px] uppercase tracking-widest">No SKU</span>
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
          </div>

          {meta.totalPages > 1 && (
            <div className="mt-8">
              <Pagination page={meta.page} totalPages={meta.totalPages} onPageChange={setPage} />
            </div>
          )}
          <p className="text-center text-[10px] uppercase tracking-widest text-ink/35 mt-4">
            {meta.total} product{meta.total !== 1 ? 's' : ''}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
