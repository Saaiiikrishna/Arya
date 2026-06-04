'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Modal } from '@/components/store';
import {
  Label, inputCls, inputClsSm, ErrorBanner, PrimaryBtn, SectionCard, GhostBtn,
} from './_ui';
import type { TabProps, ProductSku, DiyGuide } from './types';
import {
  Plus, Trash2, ChevronUp, ChevronDown, Save, Wrench, Package2, X,
} from 'lucide-react';

/** RFC-4122 UUID shape — mirrors the backend `@IsUUID()` so we fail friendly client-side. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Monotonic counter for stable local row keys (steps / BOM / bundle members). */
let _rowSeq = 0;
const nextRowId = () => `r${++_rowSeq}`;

/**
 * DIY tab: upserts the product's DiyGuide (title/summary/difficulty/minutes +
 * ordered steps + BOM) via `adminUpsertDiyGuide` (steps + BOM are REPLACED
 * wholesale per upsert-diy.dto). A separate ComponentBundle creator mints a
 * sellable BUNDLE Sku from member SKUs (`adminCreateBundle`) and can be linked
 * to the guide via bundleId.
 */

type BomKind = 'SKU' | 'PRODUCT' | 'FREE_TEXT';

interface StepMedia {
  url: string;
  type: string;
  caption: string;
}
interface EditorStep {
  _localId: string;
  title: string;
  body: string;
  codeLanguage: string;
  code: string;
  media: StepMedia[];
}
interface EditorBom {
  _localId: string;
  kind: BomKind;
  skuId: string;
  productId: string;
  freeTextName: string;
  quantity: string;
  note: string;
}

interface GuideEditorState {
  title: string;
  summary: string;
  difficulty: string;
  estimatedMinutes: string;
  bundleId: string;
  isPublished: boolean;
  steps: EditorStep[];
  bom: EditorBom[];
}

function fromGuide(guide: DiyGuide | null | undefined): GuideEditorState {
  return {
    title: guide?.title ?? '',
    summary: guide?.summary ?? '',
    difficulty: guide?.difficulty ?? '',
    estimatedMinutes: guide?.estimatedMinutes != null ? String(guide.estimatedMinutes) : '',
    bundleId: guide?.bundleId ?? '',
    isPublished: !!guide?.isPublished,
    steps: (guide?.steps ?? []).map((s) => ({
      _localId: nextRowId(),
      title: s.title ?? '',
      body: s.body ?? '',
      codeLanguage: s.codeLanguage ?? '',
      code: s.code ?? '',
      media: Array.isArray(s.media)
        ? s.media.map((m) => ({
            url: String(m?.url ?? ''),
            type: String(m?.type ?? 'IMAGE'),
            caption: String(m?.caption ?? ''),
          }))
        : [],
    })),
    bom: (guide?.bomItems ?? []).map((b) => ({
      _localId: nextRowId(),
      kind: b.skuId ? 'SKU' : b.productId ? 'PRODUCT' : 'FREE_TEXT',
      skuId: b.skuId ?? '',
      productId: b.productId ?? '',
      freeTextName: b.freeTextName ?? '',
      quantity: String(b.quantity ?? 1),
      note: b.note ?? '',
    })),
  };
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function DiyTab({ product, onChanged }: TabProps) {
  const ownSkus: ProductSku[] = product.skus ?? [];
  const [g, setG] = useState(() => fromGuide(product.diyGuide));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);

  // ── Bundle creation ─────────────────────────────────────
  const [showBundle, setShowBundle] = useState(false);
  const [bundleForm, setBundleForm] = useState({
    name: '',
    description: '',
    skuCode: '',
    basePrice: '',
    salePrice: '',
    hsnCode: '',
  });
  const [bundleMembers, setBundleMembers] = useState<{ _localId: string; skuId: string; quantity: string }[]>([]);
  const [bundleSaving, setBundleSaving] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);

  // ── Step helpers ────────────────────────────────────────
  const addStep = () =>
    setG({
      ...g,
      steps: [...g.steps, { _localId: nextRowId(), title: '', body: '', codeLanguage: '', code: '', media: [] }],
    });
  const patchStep = (i: number, patch: Partial<EditorStep>) =>
    setG({ ...g, steps: g.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  const removeStep = (i: number) => setG({ ...g, steps: g.steps.filter((_, idx) => idx !== i) });
  const moveStep = (i: number, dir: -1 | 1) => setG({ ...g, steps: move(g.steps, i, i + dir) });

  // ── BOM helpers ─────────────────────────────────────────
  const addBom = () =>
    setG({
      ...g,
      bom: [
        ...g.bom,
        { _localId: nextRowId(), kind: 'SKU', skuId: '', productId: '', freeTextName: '', quantity: '1', note: '' },
      ],
    });
  const patchBom = (i: number, patch: Partial<EditorBom>) =>
    setG({ ...g, bom: g.bom.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) });
  const removeBom = (i: number) => setG({ ...g, bom: g.bom.filter((_, idx) => idx !== i) });

  const validate = (): string | null => {
    if (!g.title.trim()) return 'Guide title is required.';
    // estimatedMinutes maps to backend @IsInt() — reject decimals client-side.
    if (g.estimatedMinutes !== '') {
      const mins = Number(g.estimatedMinutes);
      if (!Number.isInteger(mins) || mins < 0)
        return 'Estimated minutes must be a whole number ≥ 0.';
    }
    // bundleId maps to backend @IsUUID() — fail friendly before the request.
    if (g.bundleId.trim() && !UUID_RE.test(g.bundleId.trim()))
      return 'Linked Bundle ID must be a valid UUID (or leave it blank).';
    for (const [i, s] of g.steps.entries()) {
      if (!s.title.trim()) return `Step ${i + 1} needs a title.`;
      if (!s.body.trim()) return `Step ${i + 1} needs a body.`;
      for (const m of s.media) {
        if (m.url.trim() && !/^https?:\/\//i.test(m.url.trim()))
          return `Step ${i + 1}: media URLs must be http(s).`;
      }
    }
    for (const [i, b] of g.bom.entries()) {
      const qty = Number(b.quantity);
      if (!Number.isInteger(qty) || qty < 1) return `BOM line ${i + 1}: quantity must be ≥ 1.`;
      if (b.kind === 'SKU' && !b.skuId) return `BOM line ${i + 1}: choose a SKU.`;
      if (b.kind === 'PRODUCT') {
        if (!b.productId.trim()) return `BOM line ${i + 1}: enter a product id.`;
        // productId maps to backend @IsUUID() — reject malformed input client-side.
        if (!UUID_RE.test(b.productId.trim())) return `BOM line ${i + 1}: product id must be a valid UUID.`;
      }
      if (b.kind === 'FREE_TEXT' && !b.freeTextName.trim())
        return `BOM line ${i + 1}: enter a free-text component name.`;
    }
    return null;
  };

  const saveGuide = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError(null);
    setSavedMsg(false);
    try {
      const payload: Record<string, unknown> = {
        title: g.title.trim(),
        isPublished: g.isPublished,
        steps: g.steps.map((s, i) => ({
          title: s.title.trim(),
          body: s.body,
          sortOrder: i,
          ...(s.codeLanguage.trim() ? { codeLanguage: s.codeLanguage.trim() } : {}),
          ...(s.code.trim() ? { code: s.code } : {}),
          ...(s.media.filter((m) => m.url.trim()).length
            ? {
                media: s.media
                  .filter((m) => m.url.trim())
                  .map((m) => ({
                    url: m.url.trim(),
                    type: m.type.trim() || 'IMAGE',
                    ...(m.caption.trim() ? { caption: m.caption.trim() } : {}),
                  })),
              }
            : {}),
        })),
        bom: g.bom.map((b, i) => ({
          quantity: Number(b.quantity),
          sortOrder: i,
          ...(b.kind === 'SKU' && b.skuId ? { skuId: b.skuId } : {}),
          ...(b.kind === 'PRODUCT' && b.productId.trim() ? { productId: b.productId.trim() } : {}),
          ...(b.kind === 'FREE_TEXT' && b.freeTextName.trim()
            ? { freeTextName: b.freeTextName.trim() }
            : {}),
          ...(b.note.trim() ? { note: b.note.trim() } : {}),
        })),
      };
      if (g.summary.trim()) payload.summary = g.summary.trim();
      if (g.difficulty.trim()) payload.difficulty = g.difficulty.trim();
      // estimatedMinutes is @IsInt() server-side — coerce to an integer.
      if (g.estimatedMinutes !== '') payload.estimatedMinutes = Math.round(Number(g.estimatedMinutes));
      if (g.bundleId.trim()) payload.bundleId = g.bundleId.trim();

      await api.adminUpsertDiyGuide(product.id, payload);
      await onChanged();
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2500);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to save DIY guide');
    } finally {
      setSaving(false);
    }
  };

  const createBundle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bundleForm.name.trim()) {
      setBundleError('Bundle name is required');
      return;
    }
    if (!bundleForm.skuCode.trim()) {
      setBundleError('Sellable SKU code is required');
      return;
    }
    // CreateBundleDto.basePrice / salePrice are RUPEES (the service converts to
    // integer paise). Parse rupees directly — do NOT round-trip through paise.
    const baseRupees = Number(bundleForm.basePrice);
    if (bundleForm.basePrice.trim() === '' || Number.isNaN(baseRupees) || baseRupees < 0) {
      setBundleError('Base price (rupees) is required and must be ≥ 0');
      return;
    }
    let saleRupees: number | undefined;
    if (bundleForm.salePrice.trim() !== '') {
      saleRupees = Number(bundleForm.salePrice);
      if (Number.isNaN(saleRupees) || saleRupees < 0) {
        setBundleError('Sale price must be a number ≥ 0');
        return;
      }
    }
    const members = bundleMembers.filter((m) => m.skuId);
    if (members.length === 0) {
      setBundleError('Add at least one member SKU');
      return;
    }
    for (const m of members) {
      const q = Number(m.quantity);
      if (!Number.isInteger(q) || q < 1) {
        setBundleError('Each member SKU needs a quantity ≥ 1');
        return;
      }
    }

    // Bundle creation mints a permanent, sellable BUNDLE Sku — confirm the
    // irreversible side-effect (matches the confirm pattern used elsewhere).
    if (
      !window.confirm(
        `Create bundle "${bundleForm.name.trim()}"? This mints a new sellable SKU "${bundleForm.skuCode.trim()}" and cannot be undone here.`,
      )
    ) {
      return;
    }

    setBundleSaving(true);
    setBundleError(null);
    try {
      const created = (await api.adminCreateBundle({
        productId: product.id,
        name: bundleForm.name.trim(),
        ...(bundleForm.description.trim() ? { description: bundleForm.description.trim() } : {}),
        skuCode: bundleForm.skuCode.trim(),
        basePrice: baseRupees,
        ...(saleRupees != null ? { salePrice: saleRupees } : {}),
        ...(bundleForm.hsnCode.trim() ? { hsnCode: bundleForm.hsnCode.trim() } : {}),
        items: members.map((m) => ({ skuId: m.skuId, quantity: Number(m.quantity) })),
      })) as { id?: string; bundle?: { id?: string } } | null;
      // Link the new bundle to the guide form so the next guide save persists it.
      const newBundleId = created?.id ?? created?.bundle?.id ?? '';
      if (newBundleId) setG((prev) => ({ ...prev, bundleId: newBundleId }));
      setShowBundle(false);
      setBundleForm({ name: '', description: '', skuCode: '', basePrice: '', salePrice: '', hsnCode: '' });
      setBundleMembers([]);
      await onChanged();
    } catch (e) {
      setBundleError((e as Error)?.message || 'Failed to create bundle');
    } finally {
      setBundleSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />

      {/* Guide fields */}
      <SectionCard title={<span className="flex items-center gap-2"><Wrench className="w-5 h-5 text-forest/60" /> DIY Guide</span>}>
        <div className="space-y-5">
          <div>
            <Label required>Guide Title</Label>
            <input
              type="text"
              className={inputCls}
              value={g.title}
              onChange={(e) => setG({ ...g, title: e.target.value })}
              placeholder="Build a WiFi Temperature Logger"
            />
          </div>
          <div>
            <Label>Summary</Label>
            <textarea
              rows={2}
              className={`${inputCls} resize-none`}
              value={g.summary}
              onChange={(e) => setG({ ...g, summary: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Difficulty</Label>
              <select
                className={inputCls}
                value={g.difficulty}
                onChange={(e) => setG({ ...g, difficulty: e.target.value })}
              >
                <option value="">—</option>
                {['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Est. Minutes</Label>
              <input
                type="number"
                min={0}
                step={1}
                className={inputCls}
                value={g.estimatedMinutes}
                onChange={(e) => setG({ ...g, estimatedMinutes: e.target.value })}
              />
            </div>
            <div>
              <Label>Linked Bundle ID</Label>
              <input
                type="text"
                className={inputCls}
                value={g.bundleId}
                onChange={(e) => setG({ ...g, bundleId: e.target.value })}
                placeholder="optional"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input
              type="checkbox"
              checked={g.isPublished}
              onChange={(e) => setG({ ...g, isPublished: e.target.checked })}
              className="accent-saffron"
            />
            Publish this guide on the /build view
          </label>
        </div>
      </SectionCard>

      {/* Steps */}
      <SectionCard
        title="Steps"
        action={
          <GhostBtn onClick={addStep}>
            <span className="inline-flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add Step
            </span>
          </GhostBtn>
        }
      >
        {g.steps.length === 0 ? (
          <p className="text-ink/40 text-sm font-serif italic py-4 text-center">No steps yet.</p>
        ) : (
          <div className="space-y-4">
            {g.steps.map((s, i) => (
              <div key={s._localId} className="border border-hairline">
                <div className="flex items-center justify-between bg-alabaster px-4 py-2.5 border-b border-hairline">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/60">
                    Step {i + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveStep(i, -1)}
                      disabled={i === 0}
                      className="p-1.5 text-ink/40 hover:text-forest disabled:opacity-30 transition-colors"
                      aria-label="Move step up"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => moveStep(i, 1)}
                      disabled={i === g.steps.length - 1}
                      className="p-1.5 text-ink/40 hover:text-forest disabled:opacity-30 transition-colors"
                      aria-label="Move step down"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => removeStep(i)}
                      className="p-1.5 text-ink/40 hover:text-terracotta transition-colors"
                      aria-label="Delete step"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <Label required>Title</Label>
                    <input
                      type="text"
                      className={inputClsSm}
                      value={s.title}
                      onChange={(e) => patchStep(i, { title: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label required>Body</Label>
                    <textarea
                      rows={3}
                      className={`${inputCls} resize-y`}
                      value={s.body}
                      onChange={(e) => patchStep(i, { body: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-[160px_1fr] gap-3">
                    <div>
                      <Label>Code Language</Label>
                      <input
                        type="text"
                        className={inputClsSm}
                        value={s.codeLanguage}
                        onChange={(e) => patchStep(i, { codeLanguage: e.target.value })}
                        placeholder="cpp"
                      />
                    </div>
                    <div>
                      <Label>Code (optional)</Label>
                      <textarea
                        rows={3}
                        className={`${inputCls} resize-y font-mono text-xs`}
                        value={s.code}
                        onChange={(e) => patchStep(i, { code: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Step media */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Step Media (http/https URLs)</Label>
                      <button
                        type="button"
                        onClick={() =>
                          patchStep(i, { media: [...s.media, { url: '', type: 'IMAGE', caption: '' }] })
                        }
                        className="text-[9px] uppercase tracking-widest text-forest font-bold hover:underline inline-flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> Add Media
                      </button>
                    </div>
                    {s.media.length === 0 ? (
                      <p className="text-[11px] text-ink/35 italic">No media for this step.</p>
                    ) : (
                      <div className="space-y-2">
                        {s.media.map((m, mi) => (
                          <div key={mi} className="flex items-center gap-2">
                            <input
                              type="url"
                              placeholder="https://…"
                              className={`${inputClsSm} flex-1`}
                              value={m.url}
                              onChange={(e) => {
                                const media = [...s.media];
                                media[mi] = { ...media[mi], url: e.target.value };
                                patchStep(i, { media });
                              }}
                            />
                            <select
                              className={`${inputClsSm} w-28`}
                              value={m.type}
                              onChange={(e) => {
                                const media = [...s.media];
                                media[mi] = { ...media[mi], type: e.target.value };
                                patchStep(i, { media });
                              }}
                            >
                              <option value="IMAGE">IMAGE</option>
                              <option value="VIDEO">VIDEO</option>
                            </select>
                            <input
                              type="text"
                              placeholder="caption"
                              className={`${inputClsSm} flex-1`}
                              value={m.caption}
                              onChange={(e) => {
                                const media = [...s.media];
                                media[mi] = { ...media[mi], caption: e.target.value };
                                patchStep(i, { media });
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => patchStep(i, { media: s.media.filter((_, idx) => idx !== mi) })}
                              className="text-ink/40 hover:text-terracotta transition-colors p-1"
                              aria-label="Remove media"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* BOM */}
      <SectionCard
        title="Bill of Materials"
        action={
          <GhostBtn onClick={addBom}>
            <span className="inline-flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add Component
            </span>
          </GhostBtn>
        }
      >
        {g.bom.length === 0 ? (
          <p className="text-ink/40 text-sm font-serif italic py-4 text-center">No components listed.</p>
        ) : (
          <div className="space-y-3">
            {g.bom.map((b, i) => (
              <div key={b._localId} className="border border-hairline p-3 grid grid-cols-[120px_1fr_90px_auto] gap-3 items-start">
                <div>
                  <Label>Source</Label>
                  <select
                    className={inputClsSm}
                    value={b.kind}
                    onChange={(e) => patchBom(i, { kind: e.target.value as BomKind })}
                  >
                    <option value="SKU">This product SKU</option>
                    <option value="PRODUCT">Product link</option>
                    <option value="FREE_TEXT">Free text</option>
                  </select>
                </div>
                <div>
                  <Label>Component</Label>
                  {b.kind === 'SKU' ? (
                    <select
                      className={inputClsSm}
                      value={b.skuId}
                      onChange={(e) => patchBom(i, { skuId: e.target.value })}
                    >
                      <option value="">Select a SKU…</option>
                      {ownSkus.map((sk) => (
                        <option key={sk.id} value={sk.id}>
                          {sk.skuCode}
                          {sk.name ? ` — ${sk.name}` : ''}
                        </option>
                      ))}
                    </select>
                  ) : b.kind === 'PRODUCT' ? (
                    <input
                      type="text"
                      placeholder="Product UUID"
                      className={inputClsSm}
                      value={b.productId}
                      onChange={(e) => patchBom(i, { productId: e.target.value })}
                    />
                  ) : (
                    <input
                      type="text"
                      placeholder="e.g. Soldering iron"
                      className={inputClsSm}
                      value={b.freeTextName}
                      onChange={(e) => patchBom(i, { freeTextName: e.target.value })}
                    />
                  )}
                  <input
                    type="text"
                    placeholder="Note (optional)"
                    className={`${inputClsSm} mt-2`}
                    value={b.note}
                    onChange={(e) => patchBom(i, { note: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Qty</Label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className={inputClsSm}
                    value={b.quantity}
                    onChange={(e) => patchBom(i, { quantity: e.target.value })}
                  />
                </div>
                <button
                  onClick={() => removeBom(i)}
                  className="text-ink/40 hover:text-terracotta transition-colors p-1 mt-7"
                  aria-label="Remove component"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        {ownSkus.length === 0 && (
          <p className="text-[11px] text-warning mt-3">
            This product has no SKUs yet — add SKUs first to reference them as BOM components.
          </p>
        )}
      </SectionCard>

      {/* Save guide */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => {
            setBundleError(null);
            setShowBundle(true);
          }}
          className="px-5 py-3 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors flex items-center gap-2"
        >
          <Package2 className="w-3.5 h-3.5" /> Create Component Bundle
        </button>
        <div className="flex items-center gap-3">
          {savedMsg && (
            <span className="text-[10px] uppercase tracking-widest text-success font-bold">Guide saved</span>
          )}
          <PrimaryBtn onClick={saveGuide} disabled={saving}>
            <span className="flex items-center gap-2">
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving…' : 'Save DIY Guide'}
            </span>
          </PrimaryBtn>
        </div>
      </div>

      {/* Bundle modal */}
      <Modal
        open={showBundle}
        onClose={() => !bundleSaving && setShowBundle(false)}
        title="Create Component Bundle"
        size="max-w-2xl"
        dismissible={!bundleSaving}
        footer={
          <>
            <GhostBtn onClick={() => setShowBundle(false)} disabled={bundleSaving}>
              Cancel
            </GhostBtn>
            <PrimaryBtn type="submit" form="bundle-form" disabled={bundleSaving}>
              {bundleSaving ? 'Creating…' : 'Create Bundle'}
            </PrimaryBtn>
          </>
        }
      >
        <form id="bundle-form" onSubmit={createBundle} className="space-y-5">
          <ErrorBanner message={bundleError} />
          {product.type !== 'BUNDLE' && (
            <div className="flex items-start gap-2 border border-marigold/40 bg-marigold/10 px-3 py-2 text-xs text-warning">
              <span>
                This product&apos;s type is <strong>{product.type}</strong>. Bundles are normally wrapped by a
                BUNDLE-type product. The backend may reject creation if a BUNDLE wrapper is required — set the
                product type to BUNDLE first if so.
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label required>Bundle Name</Label>
              <input
                type="text"
                className={inputCls}
                value={bundleForm.name}
                onChange={(e) => setBundleForm({ ...bundleForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label required>Sellable SKU Code</Label>
              <input
                type="text"
                className={inputCls}
                value={bundleForm.skuCode}
                onChange={(e) => setBundleForm({ ...bundleForm, skuCode: e.target.value })}
                placeholder="KIT-TEMP-LOGGER"
              />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <textarea
              rows={2}
              className={`${inputCls} resize-none`}
              value={bundleForm.description}
              onChange={(e) => setBundleForm({ ...bundleForm, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label required>Base Price (₹)</Label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={inputCls}
                value={bundleForm.basePrice}
                onChange={(e) => setBundleForm({ ...bundleForm, basePrice: e.target.value })}
              />
            </div>
            <div>
              <Label>Sale Price (₹)</Label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={inputCls}
                value={bundleForm.salePrice}
                onChange={(e) => setBundleForm({ ...bundleForm, salePrice: e.target.value })}
              />
            </div>
            <div>
              <Label>HSN Code</Label>
              <input
                type="text"
                className={inputCls}
                value={bundleForm.hsnCode}
                onChange={(e) => setBundleForm({ ...bundleForm, hsnCode: e.target.value })}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label required>Member SKUs</Label>
              <button
                type="button"
                onClick={() => setBundleMembers([...bundleMembers, { _localId: nextRowId(), skuId: '', quantity: '1' }])}
                className="text-[9px] uppercase tracking-widest text-forest font-bold hover:underline inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add Member
              </button>
            </div>
            {bundleMembers.length === 0 ? (
              <p className="text-[11px] text-ink/35 italic">
                Add member SKUs and the per-set quantity drawn down on each sale.
              </p>
            ) : (
              <div className="space-y-2">
                {bundleMembers.map((m, i) => (
                  <div key={m._localId} className="flex items-center gap-2">
                    <select
                      className={`${inputClsSm} flex-1`}
                      value={m.skuId}
                      onChange={(e) => {
                        const next = [...bundleMembers];
                        next[i] = { ...next[i], skuId: e.target.value };
                        setBundleMembers(next);
                      }}
                    >
                      <option value="">Select member SKU…</option>
                      {ownSkus.map((sk) => (
                        <option key={sk.id} value={sk.id}>
                          {sk.skuCode}
                          {sk.name ? ` — ${sk.name}` : ''}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className={`${inputClsSm} w-24`}
                      value={m.quantity}
                      onChange={(e) => {
                        const next = [...bundleMembers];
                        next[i] = { ...next[i], quantity: e.target.value };
                        setBundleMembers(next);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setBundleMembers(bundleMembers.filter((_, idx) => idx !== i))}
                      className="text-ink/40 hover:text-terracotta transition-colors p-1"
                      aria-label="Remove member"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-ink/40 mt-2">
              Member SKUs are limited to this product&apos;s own SKUs in this editor.
            </p>
          </div>
        </form>
      </Modal>
    </div>
  );
}
