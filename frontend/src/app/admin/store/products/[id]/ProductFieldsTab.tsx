'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import {
  Label, inputCls, ErrorBanner, PrimaryBtn, SectionCard,
} from './_ui';
import type { ProductDetail } from './types';
import { Archive, Save } from 'lucide-react';

const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
const PRODUCT_TYPES = ['STANDARD', 'BUNDLE', 'DIGITAL'] as const;

interface CategoryNode {
  id: string;
  name: string;
  children?: CategoryNode[];
}

function flatten(nodes: CategoryNode[], depth = 0): { id: string; name: string; depth: number }[] {
  const out: { id: string; name: string; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, depth });
    if (n.children?.length) out.push(...flatten(n.children, depth + 1));
  }
  return out;
}

export default function ProductFieldsTab({
  product,
  onChanged,
  onArchived,
}: {
  product: ProductDetail;
  onChanged: () => Promise<void> | void;
  onArchived: () => void;
}) {
  const [form, setForm] = useState({
    name: product.name ?? '',
    subtitle: product.subtitle ?? '',
    brand: product.brand ?? '',
    shortDescription: product.shortDescription ?? '',
    // status/type kept as plain strings (server validates via @IsEnum); the
    // <select> onChange yields a string, so widen the initial value too.
    status: String(product.status ?? 'DRAFT'),
    type: String(product.type ?? 'STANDARD'),
    categoryId: product.categoryId ?? '',
    tags: (product.tags ?? []).join(', '),
    isFeatured: !!product.isFeatured,
    sortOrder: product.sortOrder ?? 0,
    seoTitle: product.seoTitle ?? '',
    seoDescription: product.seoDescription ?? '',
  });
  const [categories, setCategories] = useState<{ id: string; name: string; depth: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);

  const loadCats = useCallback(async () => {
    try {
      const tree = (await api.adminGetStoreCategoryTree()) as CategoryNode[];
      setCategories(flatten(Array.isArray(tree) ? tree : []));
    } catch {
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    loadCats();
  }, [loadCats]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    setSavedMsg(false);
    try {
      const tags = String(form.tags)
        .split(',')
        .map((t: string) => t.trim())
        .filter(Boolean);
      // Send categoryId explicitly as null when cleared so the backend disconnects
      // it (UpdateProductDto accepts string | null and re-syncs the name cache).
      await api.adminUpdateStoreProduct(product.id, {
        name: form.name.trim(),
        subtitle: form.subtitle.trim() || undefined,
        brand: form.brand.trim() || undefined,
        shortDescription: form.shortDescription.trim() || undefined,
        status: form.status,
        type: form.type,
        categoryId: form.categoryId ? form.categoryId : null,
        tags,
        isFeatured: form.isFeatured,
        sortOrder: Number(form.sortOrder) || 0,
        seoTitle: form.seoTitle.trim() || undefined,
        seoDescription: form.seoDescription.trim() || undefined,
      });
      await onChanged();
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2500);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!confirm('Archive this product? It will be hidden from the storefront. You can restore it by setting its status back to ACTIVE.')) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.adminArchiveStoreProduct(product.id);
      onArchived();
    } catch (e) {
      setError((e as Error)?.message || 'Failed to archive product');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-6 max-w-3xl">
      <ErrorBanner message={error} />

      <SectionCard title="Core Details">
        <div className="space-y-5">
          <div>
            <Label required>Name</Label>
            <input
              type="text"
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <p className="text-[10px] text-ink/40 mt-1">
              Slug <code className="bg-alabaster px-1">/{product.slug}</code> is fixed once generated.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Subtitle</Label>
              <input
                type="text"
                className={inputCls}
                value={form.subtitle}
                onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
              />
            </div>
            <div>
              <Label>Brand</Label>
              <input
                type="text"
                className={inputCls}
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Status</Label>
              <select
                className={inputCls}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {PRODUCT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Type</Label>
              <select
                className={inputCls}
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Category</Label>
              <select
                className={inputCls}
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
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
            <Label>Short Description</Label>
            <textarea
              rows={3}
              className={`${inputCls} resize-none`}
              value={form.shortDescription}
              onChange={(e) => setForm({ ...form, shortDescription: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Tags (comma-separated)</Label>
              <input
                type="text"
                className={inputCls}
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="microcontroller, wifi, iot"
              />
            </div>
            <div>
              <Label>Sort Order</Label>
              <input
                type="number"
                className={inputCls}
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input
              type="checkbox"
              checked={form.isFeatured}
              onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })}
              className="accent-saffron"
            />
            Feature this product on the storefront
          </label>
        </div>
      </SectionCard>

      <SectionCard title="SEO">
        <div className="space-y-5">
          <div>
            <Label>SEO Title</Label>
            <input
              type="text"
              className={inputCls}
              value={form.seoTitle}
              onChange={(e) => setForm({ ...form, seoTitle: e.target.value })}
            />
          </div>
          <div>
            <Label>SEO Description</Label>
            <textarea
              rows={2}
              className={`${inputCls} resize-none`}
              value={form.seoDescription}
              onChange={(e) => setForm({ ...form, seoDescription: e.target.value })}
            />
          </div>
        </div>
      </SectionCard>

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={archive}
          disabled={saving || product.status === 'ARCHIVED'}
          className="px-5 py-3 border border-terracotta/40 text-terracotta text-[10px] uppercase tracking-widest font-bold hover:bg-terracotta hover:text-white disabled:opacity-40 transition-colors flex items-center gap-2"
        >
          <Archive className="w-3.5 h-3.5" />
          {product.status === 'ARCHIVED' ? 'Archived' : 'Archive Product'}
        </button>
        <div className="flex items-center gap-3">
          {savedMsg && (
            <span className="text-[10px] uppercase tracking-widest text-success font-bold">Saved</span>
          )}
          <PrimaryBtn type="submit" disabled={saving}>
            <span className="flex items-center gap-2">
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving…' : 'Save Changes'}
            </span>
          </PrimaryBtn>
        </div>
      </div>
    </form>
  );
}
