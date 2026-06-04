'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Settings as SettingsIcon, Link2, Building2, Percent, ScrollText,
  Plus, Pencil, Trash2, X, Save, Check,
} from 'lucide-react';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/storeHelpers';
import Tabs from '@/components/store/Tabs';
import Modal from '@/components/store/Modal';

/**
 * Admin store settings — configuration via the existing settings API
 * (updateSettings key→value) plus Tax Classes + HSN Tax Rates CRUD.
 *
 * Setting keys (canonical, mirror the backend services):
 *  - discordUrl / storeUrl / articlesUrl       → landing CTAs (public)
 *  - store.sellerGstin / store.sellerStateCode → tax/invoicing identity (tax.service)
 *  - store.defaultGstBps                        → fallback GST in basis points
 *  - store.courierProvider                      → 'manual' | 'shiprocket' (shipping.constants)
 *
 * Tax bps semantics: 1800 bps = 18%. Forms accept a percentage and convert to
 * bps on submit (round to integer), matching UpsertTaxClassDto / UpsertTaxRateDto.
 */

// ─── setting keys ───────────────────────────────────────────
const KEYS = {
  discordUrl: 'discordUrl',
  storeUrl: 'storeUrl',
  articlesUrl: 'articlesUrl',
  sellerGstin: 'store.sellerGstin',
  sellerStateCode: 'store.sellerStateCode',
  defaultGstBps: 'store.defaultGstBps',
  courierProvider: 'store.courierProvider',
} as const;

const COURIER_PROVIDERS = [
  { value: 'manual', label: 'Manual (admin enters AWB)' },
  { value: 'shiprocket', label: 'Shiprocket' },
];

type Tab = 'cta' | 'seller' | 'classes' | 'rates';

interface TaxClass {
  id: string;
  name: string;
  type: string;
  hsnCode: string | null;
  cgstBps: number;
  sgstBps: number;
  igstBps: number;
  isActive: boolean;
}
interface TaxRate {
  id: string;
  hsnCode: string;
  type: string;
  totalGstBps: number;
  description: string | null;
  effectiveFrom: string;
}

const inputCls = 'w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest bg-white';
const labelCls = 'block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold';

// bps ↔ percent helpers (1800 bps = 18%).
const bpsToPct = (bps: number) => bps / 100;
const pctToBps = (pct: number) => Math.round(pct * 100);

// GSTIN: 2-digit state code + 10-char PAN + entity digit + 'Z' + 1 check char.
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// "Saved" confirmation pill. Module-scoped (not defined inside the page
// component) so it is not re-created on every render.
function SavedPill({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-forest">
      <Check className="w-3.5 h-3.5" /> Saved
    </span>
  );
}

export default function AdminStoreSettingsPage() {
  const [tab, setTab] = useState<Tab>('cta');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── settings (key→value) ─────────────────────────────────
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [sellerError, setSellerError] = useState<string | null>(null);
  // Local draft for the Default GST (%) input. The canonical setting is stored as
  // basis points; keeping a free-text percent draft lets the admin type partial
  // values ('1', '1.', '18') without the bps round-trip rewriting the field
  // mid-keystroke. Committed to settings (as bps) on each parseable change.
  const [defaultGstPctDraft, setDefaultGstPctDraft] = useState('');

  // ─── tax classes ──────────────────────────────────────────
  const [taxClasses, setTaxClasses] = useState<TaxClass[]>([]);
  const [classModalOpen, setClassModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<TaxClass | null>(null);
  const [classForm, setClassForm] = useState({ name: '', hsnCode: '', totalPct: '', isActive: true });
  const [classSaving, setClassSaving] = useState(false);
  const [classError, setClassError] = useState<string | null>(null);

  // ─── tax rates ────────────────────────────────────────────
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<TaxRate | null>(null);
  const [rateForm, setRateForm] = useState({ hsnCode: '', totalPct: '', description: '', effectiveFrom: '' });
  const [rateSaving, setRateSaving] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, classes, rates] = await Promise.all([
        api.getSettings(),
        api.adminListTaxClasses(),
        api.adminListTaxRates(),
      ]);
      setSettings(s || {});
      // Seed the Default GST (%) draft from the stored bps value.
      const storedBps = s?.[KEYS.defaultGstBps];
      setDefaultGstPctDraft(storedBps != null && storedBps !== '' ? String(bpsToPct(Number(storedBps))) : '');
      setTaxClasses((classes as TaxClass[]) || []);
      setTaxRates((rates as TaxRate[]) || []);
    } catch (e: unknown) {
      setError(errMsg(e, 'Failed to load store settings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setField = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSettingsSaved(false);
    setSellerError(null);
  };

  // Save a specific subset of setting keys (per-tab Save buttons). Blank values
  // are dropped from the payload so a Save never clobbers a previously-set value
  // (e.g. a configured GSTIN) with an empty string. To intentionally clear a key,
  // the backend would need an explicit delete affordance — out of scope here.
  const saveSettings = async (keys: string[]) => {
    setSavingSettings(true);
    setSettingsSaved(false);
    setError(null);
    try {
      const payload: Record<string, string> = {};
      for (const k of keys) {
        const v = settings[k];
        if (v != null && v !== '') payload[k] = v;
      }
      await api.updateSettings(payload);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2500);
    } catch (e: unknown) {
      setError(errMsg(e, 'Failed to save settings'));
    } finally {
      setSavingSettings(false);
    }
  };

  // Seller & courier save: validates GSTIN format (compliance) before persisting.
  // A malformed GSTIN would otherwise be printed verbatim on GST tax invoices.
  const saveSeller = async () => {
    setSellerError(null);
    const gstin = (settings[KEYS.sellerGstin] ?? '').trim();
    if (gstin && !GSTIN_REGEX.test(gstin)) {
      setSellerError('Seller GSTIN must be a valid 15-character GSTIN (e.g. 36AAACU1234A1Z5). Leave blank if not yet registered.');
      return;
    }
    const stateCode = (settings[KEYS.sellerStateCode] ?? '').trim();
    if (stateCode && !/^[0-9]{2}$/.test(stateCode)) {
      setSellerError('Seller state code must be exactly 2 digits.');
      return;
    }
    await saveSettings([KEYS.sellerGstin, KEYS.sellerStateCode, KEYS.defaultGstBps, KEYS.courierProvider]);
  };

  // ─── tax class CRUD ───────────────────────────────────────
  const openCreateClass = () => {
    setEditingClass(null);
    setClassForm({ name: '', hsnCode: '', totalPct: '', isActive: true });
    setClassError(null);
    setClassModalOpen(true);
  };
  const openEditClass = (c: TaxClass) => {
    setEditingClass(c);
    // Stored split is cgst+sgst (= total) for intra-state; igst is the total.
    // Display the total rate (igstBps is authoritative for the total).
    setClassForm({
      name: c.name,
      hsnCode: c.hsnCode || '',
      totalPct: String(bpsToPct(c.igstBps || c.cgstBps + c.sgstBps)),
      isActive: c.isActive,
    });
    setClassError(null);
    setClassModalOpen(true);
  };
  const saveClass = async () => {
    setClassError(null);
    if (!classForm.name.trim()) { setClassError('Name is required.'); return; }
    const pct = Number(classForm.totalPct);
    if (classForm.totalPct === '' || Number.isNaN(pct) || pct < 0 || pct > 100) {
      setClassError('Total GST % must be between 0 and 100.'); return;
    }
    if (classForm.hsnCode && !/^[0-9]{2,8}$/.test(classForm.hsnCode.trim())) {
      setClassError('HSN code must be 2–8 digits.'); return;
    }
    const total = pctToBps(pct);
    // Persist the full split: cgst = sgst = total/2, igst = total (per DTO docs).
    const half = Math.round(total / 2);
    const body: Record<string, unknown> = {
      name: classForm.name.trim(),
      cgstBps: half,
      sgstBps: total - half, // keep cgst+sgst === total exactly
      igstBps: total,
      isActive: classForm.isActive,
    };
    if (classForm.hsnCode.trim()) body.hsnCode = classForm.hsnCode.trim();
    setClassSaving(true);
    try {
      if (editingClass) await api.adminUpdateTaxClass(editingClass.id, body);
      else await api.adminCreateTaxClass(body as { name: string });
      setClassModalOpen(false);
      await load();
    } catch (e: unknown) {
      setClassError(errMsg(e, 'Failed to save tax class.'));
    } finally {
      setClassSaving(false);
    }
  };
  const deactivateClass = async (c: TaxClass) => {
    if (!confirm(`Deactivate tax class "${c.name}"? SKUs using it will fall back to HSN/default resolution.`)) return;
    setError(null);
    try {
      await api.adminDeactivateTaxClass(c.id);
      await load();
    } catch (e: unknown) {
      setError(errMsg(e, 'Failed to deactivate tax class.'));
    }
  };

  // ─── tax rate CRUD ────────────────────────────────────────
  const openCreateRate = () => {
    setEditingRate(null);
    setRateForm({ hsnCode: '', totalPct: '', description: '', effectiveFrom: '' });
    setRateError(null);
    setRateModalOpen(true);
  };
  const openEditRate = (r: TaxRate) => {
    setEditingRate(r);
    setRateForm({
      hsnCode: r.hsnCode,
      totalPct: String(bpsToPct(r.totalGstBps)),
      description: r.description || '',
      effectiveFrom: r.effectiveFrom ? r.effectiveFrom.slice(0, 10) : '',
    });
    setRateError(null);
    setRateModalOpen(true);
  };
  const saveRate = async () => {
    setRateError(null);
    if (!/^[0-9]{2,8}$/.test(rateForm.hsnCode.trim())) {
      setRateError('HSN code must be 2–8 digits.'); return;
    }
    const pct = Number(rateForm.totalPct);
    if (rateForm.totalPct === '' || Number.isNaN(pct) || pct < 0 || pct > 100) {
      setRateError('Total GST % must be between 0 and 100.'); return;
    }
    // Field names mirror UpsertTaxRateDto exactly: hsnCode + totalGstBps (NOT
    // rateBps) so the global ValidationPipe (whitelist + forbidNonWhitelisted)
    // accepts the body and totalGstBps is not silently dropped.
    const body: { hsnCode: string; totalGstBps: number; description?: string; effectiveFrom?: string } = {
      hsnCode: rateForm.hsnCode.trim(),
      totalGstBps: pctToBps(pct),
    };
    if (rateForm.description.trim()) body.description = rateForm.description.trim();
    if (rateForm.effectiveFrom) body.effectiveFrom = new Date(`${rateForm.effectiveFrom}T00:00:00`).toISOString();
    setRateSaving(true);
    try {
      // PATCH a specific row when editing; POST upserts-by-hsnCode when creating.
      if (editingRate) await api.adminUpdateTaxRate(editingRate.id, body);
      // NOTE: api.adminUpsertTaxRate's TS signature names the rate field `rateBps`,
      // but UpsertTaxRateDto expects `totalGstBps`. The WIRE body above is correct
      // (totalGstBps); we cast only to satisfy the stale api.ts signature. Do not
      // add a real `rateBps` field — forbidNonWhitelisted would 400 it.
      else await api.adminUpsertTaxRate(body as unknown as { hsnCode: string; rateBps: number });
      setRateModalOpen(false);
      await load();
    } catch (e: unknown) {
      setRateError(errMsg(e, 'Failed to save tax rate.'));
    } finally {
      setRateSaving(false);
    }
  };
  const deleteRate = async (r: TaxRate) => {
    if (!confirm(`Delete the HSN ${r.hsnCode} tax rate? SKUs relying on it will fall back to the default GST rate.`)) return;
    setError(null);
    try {
      await api.adminDeleteTaxRate(r.id);
      await load();
    } catch (e: unknown) {
      setError(errMsg(e, 'Failed to delete tax rate.'));
    }
  };

  // ─── tab panels ───────────────────────────────────────────
  const ctaPanel = (
    <div className="border border-hairline bg-white p-8 max-w-[640px] space-y-5">
      <div>
        <h3 className="font-serif text-xl font-bold mb-1">Landing CTAs</h3>
        <p className="text-xs text-ink/50">Destination links surfaced on the public landing page.</p>
      </div>
      <div>
        <label className={labelCls}>Discord URL</label>
        <input type="url" className={inputCls} placeholder="https://discord.gg/…"
          value={settings[KEYS.discordUrl] ?? ''} onChange={(e) => setField(KEYS.discordUrl, e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>Store URL</label>
        <input type="url" className={inputCls} placeholder="https://store.…"
          value={settings[KEYS.storeUrl] ?? ''} onChange={(e) => setField(KEYS.storeUrl, e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>Articles URL</label>
        <input type="url" className={inputCls} placeholder="https://…/articles"
          value={settings[KEYS.articlesUrl] ?? ''} onChange={(e) => setField(KEYS.articlesUrl, e.target.value)} />
      </div>
      <div className="pt-4 border-t border-hairline flex items-center justify-end gap-4">
        <SavedPill visible={settingsSaved} />
        <button
          onClick={() => saveSettings([KEYS.discordUrl, KEYS.storeUrl, KEYS.articlesUrl])}
          disabled={savingSettings}
          className="px-8 py-3 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          <Save className="w-3.5 h-3.5" /> {savingSettings ? 'Saving…' : 'Save CTAs'}
        </button>
      </div>
    </div>
  );

  const sellerPanel = (
    <div className="border border-hairline bg-white p-8 max-w-[640px] space-y-5">
      <div>
        <h3 className="font-serif text-xl font-bold mb-1">Seller &amp; Fulfilment</h3>
        <p className="text-xs text-ink/50">Identity used for GST invoicing and the active courier for shipments.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Seller GSTIN</label>
          <input type="text" className={inputCls} placeholder="36AAACU1234A1Z5"
            value={settings[KEYS.sellerGstin] ?? ''} onChange={(e) => setField(KEYS.sellerGstin, e.target.value.toUpperCase())} />
          <p className="text-[9px] text-ink/40 mt-1">State code defaults to the first 2 digits of the GSTIN.</p>
        </div>
        <div>
          <label className={labelCls}>Seller State Code</label>
          <input type="text" maxLength={2} className={inputCls} placeholder="36"
            value={settings[KEYS.sellerStateCode] ?? ''} onChange={(e) => setField(KEYS.sellerStateCode, e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} />
          <p className="text-[9px] text-ink/40 mt-1">2-digit GST state code (overrides GSTIN prefix).</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Default GST Rate (%)</label>
          <input
            type="number" min={0} max={100} step={0.01} className={inputCls} placeholder="18"
            value={defaultGstPctDraft}
            onChange={(e) => {
              const raw = e.target.value;
              setDefaultGstPctDraft(raw);
              // Commit to the canonical bps setting only when the draft parses to a
              // finite number; a blank field clears the setting. Partial inputs like
              // '1.' are kept verbatim in the draft and not yet committed.
              if (raw === '') {
                setField(KEYS.defaultGstBps, '');
              } else {
                const n = Number(raw);
                if (Number.isFinite(n)) setField(KEYS.defaultGstBps, String(pctToBps(n)));
              }
            }}
          />
          <p className="text-[9px] text-ink/40 mt-1">Fallback when a SKU has no tax class / HSN rate. Stored as basis points.</p>
        </div>
        <div>
          <label className={labelCls}>Courier Provider</label>
          <select className={inputCls}
            value={settings[KEYS.courierProvider] ?? 'manual'} onChange={(e) => setField(KEYS.courierProvider, e.target.value)}>
            {COURIER_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>
      {sellerError && (
        <div className="border border-terracotta/30 bg-terracotta/5 px-4 py-3 text-xs text-terracotta flex items-start gap-2">
          <X className="w-4 h-4 shrink-0 mt-0.5" /> {sellerError}
        </div>
      )}
      <div className="pt-4 border-t border-hairline flex items-center justify-end gap-4">
        <SavedPill visible={settingsSaved} />
        <button
          onClick={saveSeller}
          disabled={savingSettings}
          className="px-8 py-3 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          <Save className="w-3.5 h-3.5" /> {savingSettings ? 'Saving…' : 'Save Config'}
        </button>
      </div>
    </div>
  );

  const classesPanel = (
    <div className="border border-hairline bg-white">
      <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
        <div>
          <h3 className="font-serif text-xl font-bold">Tax Classes</h3>
          <p className="text-xs text-ink/50 mt-0.5">First resolver in the chain (TaxClass → HSN rate → default).</p>
        </div>
        <button onClick={openCreateClass} className="px-5 py-2.5 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors flex items-center gap-2">
          <Plus className="w-4 h-4" /> New Class
        </button>
      </div>
      {taxClasses.length === 0 ? (
        <div className="p-12 text-center text-ink/40">
          <Percent className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="font-serif italic">No tax classes defined.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
            <div className="col-span-4">Name</div>
            <div className="col-span-2">HSN</div>
            <div className="col-span-3">Total GST</div>
            <div className="col-span-1">Active</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          {taxClasses.map((c) => (
            <div key={c.id} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm">
              <div className="col-span-4 font-semibold">{c.name}</div>
              <div className="col-span-2">{c.hsnCode ? <code className="text-[11px] bg-alabaster px-1.5 py-0.5">{c.hsnCode}</code> : <span className="text-ink/30">—</span>}</div>
              <div className="col-span-3 tabular-nums">
                {bpsToPct(c.igstBps || c.cgstBps + c.sgstBps)}%
                <span className="text-[10px] text-ink/40 ml-2">(CGST {bpsToPct(c.cgstBps)}% + SGST {bpsToPct(c.sgstBps)}%)</span>
              </div>
              <div className="col-span-1">
                {c.isActive
                  ? <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border bg-forest/10 text-forest border-forest/20">Yes</span>
                  : <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border bg-ink/5 text-ink/40 border-ink/15">No</span>}
              </div>
              <div className="col-span-2 flex justify-end gap-2">
                <button onClick={() => openEditClass(c)} className="px-3 py-1.5 border border-hairline text-[10px] uppercase tracking-widest font-bold hover:border-forest hover:text-forest transition-colors flex items-center gap-1">
                  <Pencil className="w-3 h-3" /> Edit
                </button>
                {c.isActive && (
                  <button onClick={() => deactivateClass(c)} className="px-3 py-1.5 border border-hairline text-[10px] uppercase tracking-widest font-bold text-terracotta hover:border-terracotta transition-colors flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> Disable
                  </button>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );

  const ratesPanel = (
    <div className="border border-hairline bg-white">
      <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
        <div>
          <h3 className="font-serif text-xl font-bold">HSN Tax Rates</h3>
          <p className="text-xs text-ink/50 mt-0.5">Fallback rate looked up by a SKU&apos;s HSN code when it has no tax class.</p>
        </div>
        <button onClick={openCreateRate} className="px-5 py-2.5 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors flex items-center gap-2">
          <Plus className="w-4 h-4" /> New Rate
        </button>
      </div>
      {taxRates.length === 0 ? (
        <div className="p-12 text-center text-ink/40">
          <Percent className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="font-serif italic">No HSN tax rates defined.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
            <div className="col-span-2">HSN</div>
            <div className="col-span-2">GST</div>
            <div className="col-span-4">Description</div>
            <div className="col-span-2">Effective</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          {taxRates.map((r) => (
            <div key={r.id} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm">
              <div className="col-span-2"><code className="text-[11px] bg-alabaster px-1.5 py-0.5 font-bold">{r.hsnCode}</code></div>
              <div className="col-span-2 tabular-nums font-semibold">{bpsToPct(r.totalGstBps)}%</div>
              <div className="col-span-4 text-ink/60 truncate">{r.description || <span className="text-ink/30">—</span>}</div>
              <div className="col-span-2 text-[11px] text-ink/50">
                {r.effectiveFrom ? new Date(r.effectiveFrom).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
              </div>
              <div className="col-span-2 flex justify-end gap-2">
                <button onClick={() => openEditRate(r)} className="px-3 py-1.5 border border-hairline text-[10px] uppercase tracking-widest font-bold hover:border-forest hover:text-forest transition-colors flex items-center gap-1">
                  <Pencil className="w-3 h-3" /> Edit
                </button>
                <button onClick={() => deleteRate(r)} className="px-3 py-1.5 border border-hairline text-[10px] uppercase tracking-widest font-bold text-terracotta hover:border-terracotta transition-colors flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Store Settings</p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-8">
        <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
          ← Command Center
        </Link>
        <h1 className="font-serif text-5xl font-bold leading-none flex items-center gap-3">
          <SettingsIcon className="w-9 h-9 text-forest/70" /> Store Settings
        </h1>
        <p className="text-ink/50 mt-2 font-serif italic">Landing links, seller identity, courier &amp; GST tax configuration</p>
      </header>

      {error && (
        <div className="border border-terracotta/20 bg-terracotta/5 px-4 py-3 mb-6 text-sm text-terracotta flex items-center gap-2">
          <X className="w-4 h-4" /> {error}
        </div>
      )}

      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as Tab)}
        tabs={[
          { key: 'cta', label: (<span className="flex items-center gap-2"><Link2 className="w-3.5 h-3.5" /> Landing CTAs</span>), content: ctaPanel },
          { key: 'seller', label: (<span className="flex items-center gap-2"><Building2 className="w-3.5 h-3.5" /> Seller &amp; Courier</span>), content: sellerPanel },
          { key: 'classes', label: (<span className="flex items-center gap-2"><Percent className="w-3.5 h-3.5" /> Tax Classes</span>), content: classesPanel },
          { key: 'rates', label: (<span className="flex items-center gap-2"><ScrollText className="w-3.5 h-3.5" /> HSN Rates</span>), content: ratesPanel },
        ]}
      />

      {/* Tax Class modal */}
      <Modal
        open={classModalOpen}
        onClose={() => !classSaving && setClassModalOpen(false)}
        dismissible={!classSaving}
        title={editingClass ? `Edit Tax Class · ${editingClass.name}` : 'New Tax Class'}
        footer={
          <>
            <button onClick={() => setClassModalOpen(false)} disabled={classSaving} className="px-6 py-2.5 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 transition-colors disabled:opacity-50">Cancel</button>
            <button onClick={saveClass} disabled={classSaving} className="px-8 py-2.5 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors">
              {classSaving ? 'Saving…' : editingClass ? 'Save Changes' : 'Create Class'}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {classError && (
            <div className="border border-terracotta/30 bg-terracotta/5 px-4 py-3 text-xs text-terracotta flex items-start gap-2">
              <X className="w-4 h-4 shrink-0 mt-0.5" /> {classError}
            </div>
          )}
          <div>
            <label className={labelCls}>Name *</label>
            <input type="text" className={inputCls} placeholder="GST 18%" value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Total GST (%) *</label>
              <input type="number" min={0} max={100} step={0.01} className={inputCls} placeholder="18" value={classForm.totalPct} onChange={(e) => setClassForm({ ...classForm, totalPct: e.target.value })} />
              <p className="text-[9px] text-ink/40 mt-1">Split as CGST + SGST automatically; applied as IGST inter-state.</p>
            </div>
            <div>
              <label className={labelCls}>HSN Code</label>
              <input type="text" className={inputCls} placeholder="optional" value={classForm.hsnCode} onChange={(e) => setClassForm({ ...classForm, hsnCode: e.target.value.replace(/[^0-9]/g, '').slice(0, 8) })} />
            </div>
          </div>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input type="checkbox" checked={classForm.isActive} onChange={(e) => setClassForm({ ...classForm, isActive: e.target.checked })} className="w-4 h-4 accent-forest" />
            <span className="text-sm">Active</span>
          </label>
        </div>
      </Modal>

      {/* Tax Rate modal */}
      <Modal
        open={rateModalOpen}
        onClose={() => !rateSaving && setRateModalOpen(false)}
        dismissible={!rateSaving}
        title={editingRate ? `Edit HSN Rate · ${editingRate.hsnCode}` : 'New HSN Tax Rate'}
        footer={
          <>
            <button onClick={() => setRateModalOpen(false)} disabled={rateSaving} className="px-6 py-2.5 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 transition-colors disabled:opacity-50">Cancel</button>
            <button onClick={saveRate} disabled={rateSaving} className="px-8 py-2.5 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors">
              {rateSaving ? 'Saving…' : editingRate ? 'Save Changes' : 'Create Rate'}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {rateError && (
            <div className="border border-terracotta/30 bg-terracotta/5 px-4 py-3 text-xs text-terracotta flex items-start gap-2">
              <X className="w-4 h-4 shrink-0 mt-0.5" /> {rateError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>HSN Code *</label>
              <input
                type="text"
                className={`${inputCls} ${editingRate ? 'bg-ink/5 text-ink/50' : ''}`}
                placeholder="6109"
                disabled={!!editingRate}
                value={rateForm.hsnCode}
                onChange={(e) => setRateForm({ ...rateForm, hsnCode: e.target.value.replace(/[^0-9]/g, '').slice(0, 8) })}
              />
              {editingRate && <p className="text-[9px] text-ink/40 mt-1">HSN is the unique key; create a new rate to change it.</p>}
            </div>
            <div>
              <label className={labelCls}>Total GST (%) *</label>
              <input type="number" min={0} max={100} step={0.01} className={inputCls} placeholder="18" value={rateForm.totalPct} onChange={(e) => setRateForm({ ...rateForm, totalPct: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <input type="text" className={inputCls} placeholder="e.g. Apparel up to ₹1000" value={rateForm.description} onChange={(e) => setRateForm({ ...rateForm, description: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Effective From</label>
            <input type="date" className={inputCls} value={rateForm.effectiveFrom} onChange={(e) => setRateForm({ ...rateForm, effectiveFrom: e.target.value })} />
            <p className="text-[9px] text-ink/40 mt-1">Recorded so historical filings can be reconstructed. Defaults to now.</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
