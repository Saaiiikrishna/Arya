'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { Modal, Money } from '@/components/store';
import {
  Label, inputCls, inputClsSm, ErrorBanner, PrimaryBtn, SectionCard, GhostBtn,
  rupeesToPaise, paiseToRupees,
} from './_ui';
import type { TabProps, ProductSku } from './types';
import { Plus, Pencil, X, Tag, Layers, Trash2 } from 'lucide-react';

interface VariantAttr {
  key: string;
  value: string;
}

const EMPTY_SKU = {
  skuCode: '',
  barcode: '',
  name: '',
  hsnCode: '',
  taxClassId: '',
  basePrice: '',
  salePrice: '',
  weightGrams: '',
  lengthMm: '',
  widthMm: '',
  heightMm: '',
  reorderPoint: '',
  reorderQty: '',
  isActive: true,
};

function attrsToList(v: Record<string, unknown> | undefined | null): VariantAttr[] {
  if (!v || typeof v !== 'object') return [];
  return Object.entries(v).map(([key, value]) => ({ key, value: String(value) }));
}

export default function SkusTab({ product, onChanged }: TabProps) {
  const skus: ProductSku[] = product.skus ?? [];

  const [taxClasses, setTaxClasses] = useState<{ id: string; name: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_SKU });
  const [attrs, setAttrs] = useState<VariantAttr[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Price-tier sub-form (per SKU)
  const [tierFor, setTierFor] = useState<string | null>(null);
  const [tierForm, setTierForm] = useState({ minQty: '', unitPrice: '' });
  const [tierSaving, setTierSaving] = useState(false);
  const [tierError, setTierError] = useState<string | null>(null);

  const loadTaxClasses = useCallback(async () => {
    try {
      const tc = await api.adminListTaxClasses();
      setTaxClasses(Array.isArray(tc) ? tc : []);
    } catch {
      setTaxClasses([]);
    }
  }, []);

  useEffect(() => {
    loadTaxClasses();
  }, [loadTaxClasses]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_SKU });
    setAttrs([]);
    setError(null);
    setShowForm(true);
  };

  const openEdit = (sku: ProductSku) => {
    setEditingId(sku.id);
    setForm({
      skuCode: sku.skuCode ?? '',
      barcode: sku.barcode ?? '',
      name: sku.name ?? '',
      hsnCode: sku.hsnCode ?? '',
      taxClassId: sku.taxClassId ?? '',
      basePrice: paiseToRupees(sku.basePrice),
      salePrice: paiseToRupees(sku.salePrice),
      weightGrams: sku.weightGrams != null ? String(sku.weightGrams) : '',
      lengthMm: sku.lengthMm != null ? String(sku.lengthMm) : '',
      widthMm: sku.widthMm != null ? String(sku.widthMm) : '',
      heightMm: sku.heightMm != null ? String(sku.heightMm) : '',
      reorderPoint: sku.reorderPoint != null ? String(sku.reorderPoint) : '',
      reorderQty: sku.reorderQty != null ? String(sku.reorderQty) : '',
      isActive: sku.isActive !== false,
    });
    setAttrs(attrsToList(sku.variantAttributes));
    setError(null);
    setShowForm(true);
  };

  const intOrUndef = (v: string): number | undefined => {
    if (v === '') return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : Math.round(n);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.skuCode.trim()) {
      setError('SKU code is required');
      return;
    }
    const basePaise = rupeesToPaise(form.basePrice);
    if (basePaise === null || basePaise < 0) {
      setError('Base price (rupees) is required and must be ≥ 0');
      return;
    }
    const salePaise = form.salePrice === '' ? undefined : rupeesToPaise(form.salePrice);
    if (salePaise !== undefined && salePaise !== null && salePaise < 0) {
      setError('Sale price must be ≥ 0');
      return;
    }

    // Build the bounded variantAttributes map (flat string values).
    const variantAttributes: Record<string, string> = {};
    for (const a of attrs) {
      const k = a.key.trim();
      if (k) variantAttributes[k] = a.value;
    }

    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        skuCode: form.skuCode.trim(),
        basePrice: basePaise / 100, // DTO expects RUPEES (converted to paise server-side)
        isActive: form.isActive,
        variantAttributes,
      };
      if (form.barcode.trim()) body.barcode = form.barcode.trim();
      if (form.name.trim()) body.name = form.name.trim();
      if (form.hsnCode.trim()) body.hsnCode = form.hsnCode.trim();
      if (form.taxClassId) body.taxClassId = form.taxClassId;
      if (salePaise !== undefined && salePaise !== null) body.salePrice = salePaise / 100;
      else if (editingId && form.salePrice === '') body.salePrice = null;
      const wg = intOrUndef(form.weightGrams);
      if (wg !== undefined) body.weightGrams = wg;
      const lm = intOrUndef(form.lengthMm);
      if (lm !== undefined) body.lengthMm = lm;
      const wm = intOrUndef(form.widthMm);
      if (wm !== undefined) body.widthMm = wm;
      const hm = intOrUndef(form.heightMm);
      if (hm !== undefined) body.heightMm = hm;
      const rp = intOrUndef(form.reorderPoint);
      if (rp !== undefined) body.reorderPoint = rp;
      const rq = intOrUndef(form.reorderQty);
      if (rq !== undefined) body.reorderQty = rq;

      if (editingId) {
        await api.adminUpdateSku(editingId, body);
      } else {
        await api.adminCreateSku(product.id, body);
      }
      setShowForm(false);
      await onChanged();
    } catch (e) {
      setError((e as Error)?.message || 'Failed to save SKU');
    } finally {
      setSaving(false);
    }
  };

  const addTier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tierFor) return;
    const minQty = Number(tierForm.minQty);
    const unitPaise = rupeesToPaise(tierForm.unitPrice);
    if (!Number.isInteger(minQty) || minQty < 1) {
      setTierError('Min quantity must be a whole number ≥ 1');
      return;
    }
    if (unitPaise === null || unitPaise < 0) {
      setTierError('Unit price (rupees) is required and must be ≥ 0');
      return;
    }
    setTierSaving(true);
    setTierError(null);
    try {
      await api.adminAddPriceTier(tierFor, { minQty, unitPrice: unitPaise / 100 });
      setTierForm({ minQty: '', unitPrice: '' });
      setTierFor(null);
      await onChanged();
    } catch (e) {
      setTierError((e as Error)?.message || 'Failed to add price tier');
    } finally {
      setTierSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="SKUs & Variants"
        action={
          <PrimaryBtn onClick={openCreate}>
            <span className="flex items-center gap-2">
              <Plus className="w-3.5 h-3.5" /> Add SKU
            </span>
          </PrimaryBtn>
        }
      >
        {skus.length === 0 ? (
          <p className="text-ink/40 text-sm font-serif italic py-6 text-center">
            No SKUs yet. A product needs at least one SKU to be sellable.
          </p>
        ) : (
          <div className="space-y-4">
            {skus.map((sku) => {
              const attrList = attrsToList(sku.variantAttributes);
              return (
                <div key={sku.id} className={`border border-hairline ${sku.isActive === false ? 'opacity-50' : ''}`}>
                  <div className="flex items-start justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="bg-alabaster px-1.5 py-0.5 text-xs font-bold">{sku.skuCode}</code>
                        {sku.name && <span className="text-sm font-semibold">{sku.name}</span>}
                        {sku.isActive === false && (
                          <span className="px-1.5 py-0.5 text-[8px] uppercase tracking-widest font-bold border bg-ink/5 text-ink/40 border-ink/15">
                            Inactive
                          </span>
                        )}
                      </div>
                      {attrList.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap mt-2">
                          {attrList.map((a) => (
                            <span
                              key={a.key}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-bold border border-hairline bg-alabaster text-ink/60"
                            >
                              <Tag className="w-2.5 h-2.5" />
                              {a.key}: {a.value}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-4 mt-3 text-xs text-ink/50">
                        {sku.hsnCode && <span>HSN {sku.hsnCode}</span>}
                        {sku.taxClass?.name && <span>{sku.taxClass.name}</span>}
                        {sku.weightGrams != null && <span>{sku.weightGrams}g</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-serif font-bold text-lg">
                        <Money paise={sku.basePrice} />
                      </div>
                      {sku.salePrice != null && sku.salePrice < sku.basePrice && (
                        <div className="text-xs text-terracotta font-semibold">
                          Sale <Money paise={sku.salePrice} />
                        </div>
                      )}
                      <button
                        onClick={() => openEdit(sku)}
                        className="mt-2 px-3 py-1.5 border border-hairline text-[9px] uppercase tracking-widest font-bold hover:border-forest hover:text-forest transition-colors inline-flex items-center gap-1"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                    </div>
                  </div>

                  {/* Price tiers */}
                  <div className="border-t border-hairline/60 bg-alabaster/40 px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] uppercase tracking-widest text-ink/45 font-bold flex items-center gap-1.5">
                        <Layers className="w-3 h-3" /> Quantity Price Breaks
                      </span>
                      <button
                        onClick={() => {
                          setTierFor(tierFor === sku.id ? null : sku.id);
                          setTierForm({ minQty: '', unitPrice: '' });
                          setTierError(null);
                        }}
                        className="text-[9px] uppercase tracking-widest text-forest font-bold hover:underline inline-flex items-center gap-1"
                      >
                        {tierFor === sku.id ? (
                          <>
                            <X className="w-3 h-3" /> Cancel
                          </>
                        ) : (
                          <>
                            <Plus className="w-3 h-3" /> Add Break
                          </>
                        )}
                      </button>
                    </div>

                    {(sku.priceTiers ?? []).length === 0 ? (
                      <p className="text-[11px] text-ink/35 italic">No quantity breaks — single unit price applies.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(sku.priceTiers ?? []).map((t) => (
                          <span
                            key={t.id}
                            className="inline-flex items-center gap-1.5 border border-hairline bg-white px-2 py-1 text-[11px]"
                          >
                            <span className="font-bold">{t.minQty}+</span>
                            <Money paise={t.unitPrice} className="text-ink/70" />
                          </span>
                        ))}
                      </div>
                    )}

                    {tierFor === sku.id && (
                      <form onSubmit={addTier} className="mt-3 flex items-end gap-2 flex-wrap">
                        <div>
                          <Label>Min Qty</Label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            className={`${inputClsSm} w-28`}
                            value={tierForm.minQty}
                            onChange={(e) => setTierForm({ ...tierForm, minQty: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label>Unit Price (₹)</Label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className={`${inputClsSm} w-36`}
                            value={tierForm.unitPrice}
                            onChange={(e) => setTierForm({ ...tierForm, unitPrice: e.target.value })}
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={tierSaving}
                          className="px-4 py-2 bg-forest text-parchment text-[9px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors"
                        >
                          {tierSaving ? 'Adding…' : 'Add'}
                        </button>
                        {tierError && <span className="text-[11px] text-terracotta w-full">{tierError}</span>}
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* SKU create/edit modal */}
      <Modal
        open={showForm}
        onClose={() => !saving && setShowForm(false)}
        title={editingId ? 'Edit SKU' : 'Add SKU'}
        size="max-w-2xl"
        dismissible={!saving}
        footer={
          <>
            <GhostBtn onClick={() => setShowForm(false)} disabled={saving}>
              Cancel
            </GhostBtn>
            <PrimaryBtn type="submit" form="sku-form" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save SKU' : 'Create SKU'}
            </PrimaryBtn>
          </>
        }
      >
        <form id="sku-form" onSubmit={save} className="space-y-5">
          <ErrorBanner message={error} />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label required>SKU Code</Label>
              <input
                type="text"
                className={inputCls}
                value={form.skuCode}
                onChange={(e) => setForm({ ...form, skuCode: e.target.value })}
                placeholder="ESP32-WROOM-4MB"
              />
            </div>
            <div>
              <Label>Barcode</Label>
              <input
                type="text"
                className={inputCls}
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Variant Label (name)</Label>
            <input
              type="text"
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="4MB Flash / Black"
            />
          </div>

          {/* Variant attributes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Variant Attributes</Label>
              <button
                type="button"
                onClick={() => setAttrs([...attrs, { key: '', value: '' }])}
                className="text-[9px] uppercase tracking-widest text-forest font-bold hover:underline inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add Attribute
              </button>
            </div>
            {attrs.length === 0 ? (
              <p className="text-[11px] text-ink/35 italic">No attributes (e.g. flash: 4MB, color: black).</p>
            ) : (
              <div className="space-y-2">
                {attrs.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="key"
                      className={`${inputClsSm} flex-1`}
                      value={a.key}
                      onChange={(e) => {
                        const next = [...attrs];
                        next[i] = { ...next[i], key: e.target.value };
                        setAttrs(next);
                      }}
                    />
                    <span className="text-ink/30">:</span>
                    <input
                      type="text"
                      placeholder="value"
                      className={`${inputClsSm} flex-1`}
                      value={a.value}
                      onChange={(e) => {
                        const next = [...attrs];
                        next[i] = { ...next[i], value: e.target.value };
                        setAttrs(next);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setAttrs(attrs.filter((_, idx) => idx !== i))}
                      className="text-ink/40 hover:text-terracotta transition-colors p-1"
                      aria-label="Remove attribute"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label required>Base Price (₹)</Label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={inputCls}
                value={form.basePrice}
                onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
              />
            </div>
            <div>
              <Label>Sale Price (₹)</Label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={inputCls}
                value={form.salePrice}
                onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
                placeholder="leave blank for no sale"
              />
            </div>
          </div>

          {/* Tax */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>HSN Code</Label>
              <input
                type="text"
                className={inputCls}
                value={form.hsnCode}
                onChange={(e) => setForm({ ...form, hsnCode: e.target.value })}
              />
            </div>
            <div>
              <Label>Tax Class</Label>
              <select
                className={inputCls}
                value={form.taxClassId}
                onChange={(e) => setForm({ ...form, taxClassId: e.target.value })}
              >
                <option value="">None</option>
                {taxClasses.map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    {tc.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Logistics */}
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label>Weight (g)</Label>
              <input
                type="number"
                min={0}
                className={inputClsSm}
                value={form.weightGrams}
                onChange={(e) => setForm({ ...form, weightGrams: e.target.value })}
              />
            </div>
            <div>
              <Label>Length (mm)</Label>
              <input
                type="number"
                min={0}
                className={inputClsSm}
                value={form.lengthMm}
                onChange={(e) => setForm({ ...form, lengthMm: e.target.value })}
              />
            </div>
            <div>
              <Label>Width (mm)</Label>
              <input
                type="number"
                min={0}
                className={inputClsSm}
                value={form.widthMm}
                onChange={(e) => setForm({ ...form, widthMm: e.target.value })}
              />
            </div>
            <div>
              <Label>Height (mm)</Label>
              <input
                type="number"
                min={0}
                className={inputClsSm}
                value={form.heightMm}
                onChange={(e) => setForm({ ...form, heightMm: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Reorder Point</Label>
              <input
                type="number"
                min={0}
                className={inputClsSm}
                value={form.reorderPoint}
                onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })}
              />
            </div>
            <div>
              <Label>Reorder Qty</Label>
              <input
                type="number"
                min={0}
                className={inputClsSm}
                value={form.reorderQty}
                onChange={(e) => setForm({ ...form, reorderQty: e.target.value })}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="accent-saffron"
            />
            SKU is active (sellable)
          </label>
        </form>
      </Modal>
    </div>
  );
}
