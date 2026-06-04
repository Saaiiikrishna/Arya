'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Ticket, Plus, Pencil, X, Search, Percent, IndianRupee,
  Users, Infinity as InfinityIcon, Calendar, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/storeHelpers';
import Modal from '@/components/store/Modal';
import Pagination from '@/components/store/Pagination';
import { formatPaise } from '@/components/store/Money';

/**
 * Admin store coupons — CRUD over /admin/store/coupons.
 *
 * Money semantics (mirrors backend coupon DTO + Coupon model):
 *  - PERCENT coupon `value` is BASIS POINTS (1800 = 18%). The form takes a
 *    percent and converts to bps on submit; reads bps back to percent.
 *  - FIXED coupon `value` is RUPEES on the wire (server converts to paise).
 *    The stored/returned `value` for a FIXED coupon is PAISE → format with Money.
 *  - maxDiscount / minOrderValue are RUPEES on the wire, PAISE when read back.
 *  - `code` and `type` are immutable after creation (server rejects changes).
 */

interface Coupon {
  id: string;
  code: string;
  description: string | null;
  type: 'PERCENT' | 'FIXED';
  value: number; // PERCENT: bps; FIXED: paise
  maxDiscount: number | null; // paise
  minOrderValue: number; // paise
  status: 'ACTIVE' | 'DISABLED' | 'EXPIRED';
  usageLimit: number | null;
  usedCount: number;
  perCustomerLimit: number;
  allowGuest: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  _count?: { redemptions: number };
}

const STATUSES = ['ACTIVE', 'DISABLED', 'EXPIRED'] as const;
const PAGE_SIZE = 20;

// Empty create form (rupee-denominated inputs; conversion happens on submit).
const EMPTY_FORM = {
  code: '',
  description: '',
  type: 'PERCENT' as 'PERCENT' | 'FIXED',
  value: '', // percent (PERCENT) or rupees (FIXED)
  minOrderValue: '', // rupees
  maxDiscount: '', // rupees (PERCENT only)
  perCustomerLimit: '1',
  usageLimit: '', // blank = unlimited
  allowGuest: false,
  startsAt: '', // datetime-local
  expiresAt: '',
  status: 'ACTIVE' as 'ACTIVE' | 'DISABLED' | 'EXPIRED',
};

type FormState = typeof EMPTY_FORM;

// ISO → value usable by <input type="datetime-local"> (local time, minute precision).
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// datetime-local string → ISO 8601 (DTO uses @IsDateString). Empty → undefined.
function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-forest/10 text-forest border-forest/20',
    DISABLED: 'bg-ink/5 text-ink/50 border-ink/15',
    EXPIRED: 'bg-terracotta/10 text-terracotta border-terracotta/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${map[status] || map.DISABLED}`}>
      {status}
    </span>
  );
}

export default function AdminStoreCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [meta, setMeta] = useState<{ total: number; page: number; totalPages: number }>({ total: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Debounce search input → query.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page, limit: PAGE_SIZE };
      if (filterStatus) params.status = filterStatus;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const res = await api.adminListCoupons(params);
      setCoupons(res.data as Coupon[]);
      setMeta(res.meta);
    } catch (e: unknown) {
      setError(errMsg(e, 'Failed to load coupons'));
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (c: Coupon) => {
    setEditing(c);
    setFormError(null);
    setForm({
      code: c.code,
      description: c.description || '',
      type: c.type,
      // Both encodings divide by 100 for the form: PERCENT bps → percent (1800 → 18),
      // FIXED paise → rupees (15099 → 150.99). Math.round() first guards against any
      // non-integer stored value before the float division.
      value: String(Math.round(c.value) / 100),
      minOrderValue: c.minOrderValue ? String(Math.round(c.minOrderValue) / 100) : '',
      maxDiscount: c.maxDiscount != null ? String(Math.round(c.maxDiscount) / 100) : '',
      perCustomerLimit: String(c.perCustomerLimit),
      usageLimit: c.usageLimit != null ? String(c.usageLimit) : '',
      allowGuest: c.allowGuest,
      startsAt: toLocalInput(c.startsAt),
      expiresAt: toLocalInput(c.expiresAt),
      status: c.status === 'EXPIRED' ? 'EXPIRED' : c.status,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    setFormError(null);

    if (!editing) {
      if (!/^[A-Za-z0-9_-]{3,40}$/.test(form.code.trim())) {
        setFormError('Code must be 3–40 chars: letters, numbers, dashes, underscores only.');
        return;
      }
    }

    const rawValue = Number(form.value);
    if (form.value === '' || Number.isNaN(rawValue) || rawValue <= 0) {
      setFormError(form.type === 'PERCENT' ? 'Enter a percentage greater than 0.' : 'Enter a fixed amount greater than 0.');
      return;
    }
    if (form.type === 'PERCENT' && rawValue > 100) {
      setFormError('Percentage cannot exceed 100%.');
      return;
    }

    // PERCENT → basis points (integer). FIXED → whole rupees (server converts to
    // paise). Round both so a sub-unit float input never reaches the wire.
    const value = form.type === 'PERCENT' ? Math.round(rawValue * 100) : Math.round(rawValue);

    const perCustomerLimit = Number(form.perCustomerLimit);
    if (Number.isNaN(perCustomerLimit) || perCustomerLimit < 1) {
      setFormError('Per-customer limit must be at least 1.');
      return;
    }

    let usageLimit: number | undefined;
    if (form.usageLimit.trim() !== '') {
      usageLimit = Number(form.usageLimit);
      if (Number.isNaN(usageLimit) || usageLimit < 1) {
        setFormError('Total usage limit must be at least 1 (leave blank for unlimited).');
        return;
      }
    }

    const minOrderValue = form.minOrderValue.trim() === '' ? undefined : Number(form.minOrderValue);
    if (minOrderValue !== undefined && (Number.isNaN(minOrderValue) || minOrderValue < 0)) {
      setFormError('Minimum order value must be 0 or more.');
      return;
    }

    let maxDiscount: number | undefined;
    if (form.type === 'PERCENT' && form.maxDiscount.trim() !== '') {
      maxDiscount = Number(form.maxDiscount);
      if (Number.isNaN(maxDiscount) || maxDiscount < 1) {
        setFormError('Max discount cap must be at least ₹1 (or leave blank).');
        return;
      }
    }

    const startsAt = toIso(form.startsAt);
    const expiresAt = toIso(form.expiresAt);
    if (startsAt && expiresAt && new Date(startsAt) >= new Date(expiresAt)) {
      setFormError('Valid-from must be before valid-until.');
      return;
    }

    // Confirm a business-impacting status downgrade: taking a live (ACTIVE) coupon
    // to DISABLED/EXPIRED stops redemptions immediately. Reversible, but worth a gate.
    if (editing && editing.status === 'ACTIVE' && form.status !== 'ACTIVE') {
      const verb = form.status === 'EXPIRED' ? 'expire' : 'disable';
      if (!confirm(`This will ${verb} the live coupon "${editing.code}" — customers can no longer redeem it. You can re-activate it later. Continue?`)) {
        return;
      }
    }

    setSaving(true);
    try {
      if (editing) {
        // code + type are immutable — omit them.
        const body: Record<string, unknown> = {
          description: form.description.trim() || undefined,
          value,
          status: form.status,
          perCustomerLimit,
          allowGuest: form.allowGuest,
        };
        if (usageLimit !== undefined) body.usageLimit = usageLimit;
        if (minOrderValue !== undefined) body.minOrderValue = minOrderValue;
        if (maxDiscount !== undefined) body.maxDiscount = maxDiscount;
        if (startsAt !== undefined) body.startsAt = startsAt;
        if (expiresAt !== undefined) body.expiresAt = expiresAt;
        await api.adminUpdateCoupon(editing.id, body);
      } else {
        const body: Record<string, unknown> = {
          code: form.code.trim(),
          type: form.type,
          value,
          status: form.status,
          perCustomerLimit,
          allowGuest: form.allowGuest,
        };
        if (form.description.trim()) body.description = form.description.trim();
        if (usageLimit !== undefined) body.usageLimit = usageLimit;
        if (minOrderValue !== undefined) body.minOrderValue = minOrderValue;
        if (maxDiscount !== undefined) body.maxDiscount = maxDiscount;
        if (startsAt !== undefined) body.startsAt = startsAt;
        if (expiresAt !== undefined) body.expiresAt = expiresAt;
        await api.adminCreateCoupon(body as { code: string; type: string; value: number });
      }
      setModalOpen(false);
      await load();
    } catch (e: unknown) {
      setFormError(errMsg(e, 'Failed to save coupon.'));
    } finally {
      setSaving(false);
    }
  };

  // Human-readable discount summary for the list row.
  const discountLabel = (c: Coupon) =>
    c.type === 'PERCENT'
      ? `${(c.value / 100).toLocaleString('en-IN')}% off`
      : `${formatPaise(c.value)} off`;

  const inputCls = 'w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest bg-white';
  const labelCls = 'block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold';

  return (
    <div className="text-ink animate-fade-in px-4 sm:px-6 lg:px-8 py-8 sm:py-12 max-w-[1200px] 3xl:max-w-[1600px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-10 flex flex-wrap justify-between items-end gap-4">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold leading-none flex items-center gap-3">
            <Ticket className="w-7 h-7 sm:w-9 sm:h-9 text-forest/70" /> Coupons
          </h1>
          <p className="text-ink/50 mt-2 font-serif italic">Storefront promotional codes &amp; redemption limits</p>
        </div>
        <button onClick={openCreate} className="px-6 py-3 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors flex items-center gap-2">
          <Plus className="w-4 h-4" /> New Coupon
        </button>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-ink/30 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code or description…"
            className="w-full border border-hairline bg-white pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-forest"
          />
        </div>
        <div className="flex gap-2">
          {['', ...STATUSES].map((s) => (
            <button
              key={s || 'all'}
              onClick={() => { setFilterStatus(s); setPage(1); }}
              className={`px-4 py-2 text-[10px] uppercase tracking-widest font-bold border transition-colors ${
                filterStatus === s ? 'border-forest bg-forest text-parchment' : 'border-hairline bg-white text-ink/60 hover:border-forest/30'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Coupons</p>
          </div>
        </div>
      ) : error ? (
        <div className="border border-terracotta/20 bg-terracotta/5 p-8 text-center">
          <p className="text-terracotta font-semibold mb-3">{error}</p>
          <button onClick={load} className="px-5 py-2 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors">
            Retry
          </button>
        </div>
      ) : coupons.length === 0 ? (
        <div className="border border-hairline bg-white p-16 text-center text-ink/40">
          <Ticket className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="font-serif italic mb-4">No coupons {filterStatus || debouncedSearch ? 'match these filters' : 'created yet'}.</p>
          {!filterStatus && !debouncedSearch && (
            <button onClick={openCreate} className="px-5 py-2 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors">
              Create First Coupon
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="border border-hairline bg-white overflow-x-auto">
            <div className="min-w-[900px]">
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
              <div className="col-span-3">Code</div>
              <div className="col-span-2">Discount</div>
              <div className="col-span-2">Min Order</div>
              <div className="col-span-2">Usage</div>
              <div className="col-span-2">Validity</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>
            {coupons.map((c) => (
              <div key={c.id} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm">
                <div className="col-span-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="font-bold bg-alabaster px-2 py-0.5 text-forest tracking-wide">{c.code}</code>
                    {statusBadge(c.status)}
                  </div>
                  {c.description && <div className="text-[11px] text-ink/40 mt-1 line-clamp-1">{c.description}</div>}
                  <div className="mt-1">
                    {c.allowGuest ? (
                      <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest text-ink/40"><ShieldAlert className="w-3 h-3" /> Guests allowed</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest text-ink/40"><ShieldCheck className="w-3 h-3" /> Registered only</span>
                    )}
                  </div>
                </div>
                <div className="col-span-2">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    {c.type === 'PERCENT' ? <Percent className="w-3.5 h-3.5 text-forest/60" /> : <IndianRupee className="w-3.5 h-3.5 text-forest/60" />}
                    {discountLabel(c)}
                  </span>
                  {c.type === 'PERCENT' && c.maxDiscount != null && (
                    <div className="text-[10px] text-ink/40 mt-0.5">cap {formatPaise(c.maxDiscount)}</div>
                  )}
                </div>
                <div className="col-span-2">
                  {c.minOrderValue > 0 ? formatPaise(c.minOrderValue) : <span className="text-ink/30">—</span>}
                </div>
                <div className="col-span-2 text-[12px]">
                  <div className="flex items-center gap-1.5">
                    {c.usageLimit != null ? (
                      <span>{c.usedCount}/{c.usageLimit}</span>
                    ) : (
                      <span className="flex items-center gap-1">{c.usedCount}<InfinityIcon className="w-3.5 h-3.5 text-ink/30" /></span>
                    )}
                  </div>
                  <div className="text-[10px] text-ink/40 flex items-center gap-1 mt-0.5">
                    <Users className="w-3 h-3" /> {c.perCustomerLimit}/customer
                  </div>
                </div>
                <div className="col-span-2 text-[11px] text-ink/50">
                  {c.startsAt || c.expiresAt ? (
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-ink/30" />
                      <span>
                        {c.startsAt ? new Date(c.startsAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                        {' → '}
                        {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '∞'}
                      </span>
                    </div>
                  ) : (
                    <span className="text-ink/30">Always</span>
                  )}
                </div>
                <div className="col-span-1 flex justify-end">
                  <button
                    onClick={() => openEdit(c)}
                    className="px-3 py-1.5 border border-hairline text-[10px] uppercase tracking-widest font-bold hover:border-forest hover:text-forest transition-colors flex items-center gap-1"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                </div>
              </div>
            ))}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-widest text-ink/40 font-bold">{meta.total} coupon{meta.total !== 1 ? 's' : ''}</p>
            <Pagination page={meta.page} totalPages={meta.totalPages} onPageChange={setPage} />
          </div>
        </>
      )}

      {/* Create / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        dismissible={!saving}
        title={editing ? `Edit Coupon · ${editing.code}` : 'New Coupon'}
        size="max-w-2xl"
        footer={
          <>
            <button
              onClick={() => setModalOpen(false)}
              disabled={saving}
              className="px-6 py-2.5 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-8 py-2.5 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Coupon'}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {formError && (
            <div className="border border-terracotta/30 bg-terracotta/5 px-4 py-3 text-xs text-terracotta flex items-start gap-2">
              <X className="w-4 h-4 shrink-0 mt-0.5" /> {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Code *</label>
              <input
                type="text"
                value={form.code}
                disabled={!!editing}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="WELCOME10"
                className={`${inputCls} ${editing ? 'bg-ink/5 text-ink/50' : ''} uppercase`}
              />
              {editing && <p className="text-[9px] text-ink/40 mt-1">Code is immutable after creation.</p>}
            </div>
            <div>
              <label className={labelCls}>Type *</label>
              <select
                value={form.type}
                disabled={!!editing}
                onChange={(e) => setForm({ ...form, type: e.target.value as 'PERCENT' | 'FIXED', maxDiscount: e.target.value === 'FIXED' ? '' : form.maxDiscount })}
                className={`${inputCls} ${editing ? 'bg-ink/5 text-ink/50' : ''}`}
              >
                <option value="PERCENT">PERCENT — % off subtotal</option>
                <option value="FIXED">FIXED — flat ₹ off</option>
              </select>
              {editing && <p className="text-[9px] text-ink/40 mt-1">Type is immutable after creation.</p>}
            </div>
          </div>

          <div>
            <label className={labelCls}>Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional internal/customer-facing note"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>{form.type === 'PERCENT' ? 'Percentage (%) *' : 'Amount (₹) *'}</label>
              <input
                type="number"
                min={form.type === 'PERCENT' ? 0.01 : 1}
                max={form.type === 'PERCENT' ? 100 : undefined}
                step={form.type === 'PERCENT' ? 0.01 : 1}
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                placeholder={form.type === 'PERCENT' ? '10' : '500'}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Min Order (₹)</label>
              <input
                type="number"
                min={0}
                step={1}
                value={form.minOrderValue}
                onChange={(e) => setForm({ ...form, minOrderValue: e.target.value })}
                placeholder="0"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Max Discount (₹)</label>
              <input
                type="number"
                min={1}
                step={1}
                value={form.maxDiscount}
                disabled={form.type === 'FIXED'}
                onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
                placeholder={form.type === 'FIXED' ? 'n/a' : 'no cap'}
                className={`${inputCls} ${form.type === 'FIXED' ? 'bg-ink/5 text-ink/40' : ''}`}
              />
              {form.type === 'PERCENT' && <p className="text-[9px] text-ink/40 mt-1">Caps the % discount.</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Per-Customer Limit *</label>
              <input
                type="number"
                min={1}
                step={1}
                value={form.perCustomerLimit}
                onChange={(e) => setForm({ ...form, perCustomerLimit: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Total Limit</label>
              <input
                type="number"
                min={1}
                step={1}
                value={form.usageLimit}
                onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
                placeholder="unlimited"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as FormState['status'] })}
                className={inputCls}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Warn when taking a live coupon out of circulation. Reversible callout —
              the save itself is additionally confirmed in handleSubmit. */}
          {editing && editing.status === 'ACTIVE' && form.status !== 'ACTIVE' && (
            <div className="border border-terracotta/30 bg-terracotta/5 px-4 py-3 text-xs text-terracotta flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              Marking this coupon {form.status} stops all future redemptions immediately. This is reversible — set it back to ACTIVE to resume.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Valid From</label>
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Valid Until</label>
              <input
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.allowGuest}
              onChange={(e) => setForm({ ...form, allowGuest: e.target.checked })}
              className="w-4 h-4 accent-forest"
            />
            <span className="text-sm">
              Allow guest checkout to use this coupon
              <span className="block text-[10px] uppercase tracking-widest text-ink/40 mt-0.5">Unchecked = registered customers only (anti-farming default)</span>
            </span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
