'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  RotateCcw, ChevronRight, X, AlertTriangle, RefreshCcw, CheckCircle,
  Ban, Truck, PackageCheck, User, ReceiptText, IndianRupee,
} from 'lucide-react';
import { api } from '@/lib/api';
import Money from '@/components/store/Money';
import Pagination from '@/components/store/Pagination';
import Modal from '@/components/store/Modal';

// ── Types (mirror backend Prisma includes) ──────────────────────────────────

interface ReturnCustomer {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

interface ReturnRow {
  id: string;
  rmaNumber: string;
  status: string;
  reason: string;
  refundAmount: number;
  refundStatus: string;
  createdAt: string;
  order: { id: string; orderNumber: string; grandTotal: number } | null;
  customer: ReturnCustomer | null;
  _count?: { items: number };
}

interface ReturnDetailItem {
  id: string;
  quantity: number;
  refundAmount: number;
  restocked: boolean;
  orderItem: {
    id: string;
    nameSnapshot: string;
    skuCodeSnapshot: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  } | null;
}

interface ReturnDetail {
  id: string;
  rmaNumber: string;
  status: string;
  reason: string;
  comment: string | null;
  refundAmount: number;
  refundStatus: string;
  razorpayRefundId: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  receivedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  order: {
    id: string;
    orderNumber: string;
    grandTotal: number;
    refundedTotal: number;
    fulfilledFromWarehouseId: string | null;
  } | null;
  customer: ReturnCustomer | null;
  items: ReturnDetailItem[];
}

interface Meta { total: number; page: number; limit: number; totalPages: number }

// ── Constants ───────────────────────────────────────────────────────────────

const RETURN_STATUSES = [
  'REQUESTED', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'RECEIVED', 'REFUNDED', 'CANCELLED',
];

// RejectReasonCode enum (returns/dto/reject-return.dto.ts) — must match exactly.
const REJECT_REASONS: { value: string; label: string }[] = [
  { value: 'RETURN_WINDOW_EXPIRED', label: 'Return window expired' },
  { value: 'ITEM_NOT_RETURNED', label: 'Item not returned' },
  { value: 'POLICY_VIOLATION', label: 'Policy violation' },
  { value: 'OTHER', label: 'Other' },
];

const LIMIT = 20;

// Admin status palette is strict DESIGN.md: forest / parchment / terracotta /
// hairline / ink only. Terminal-success states use solid/tonal forest; rejected /
// cancelled / failed use terracotta; pending/in-flight use neutral ink layering —
// no saffron/marigold (those belong to the mkt-* premium layer).
function returnStatusClass(status: string): string {
  switch (status) {
    case 'REFUNDED':
    case 'RECEIVED':
      return 'bg-forest text-parchment border-forest';
    case 'APPROVED':
      return 'bg-forest/10 text-forest border-forest/30';
    case 'IN_TRANSIT':
      return 'bg-forest/5 text-forest border-forest/20';
    case 'REJECTED':
    case 'CANCELLED':
      return 'bg-terracotta/10 text-terracotta border-terracotta/20';
    case 'REQUESTED':
    default:
      return 'bg-ink/5 text-ink/50 border-ink/15';
  }
}

function refundStatusClass(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-forest/10 text-forest border-forest/30';
    case 'PROCESSING':
      return 'bg-forest/5 text-forest border-forest/20';
    case 'FAILED':
      return 'bg-terracotta/10 text-terracotta border-terracotta/20';
    case 'PENDING':
    default:
      return 'bg-ink/5 text-ink/50 border-ink/15';
  }
}

function Badge({ status, kind }: { status: string; kind: 'return' | 'refund' }) {
  const cls = kind === 'return' ? returnStatusClass(status) : refundStatusClass(status);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function customerLabel(c: ReturnCustomer | null): string {
  if (!c) return 'Unknown';
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return name || c.email;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminStoreReturnsPage() {
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: LIMIT, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');

  // Detail
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReturnDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Actions
  const [actionLoading, setActionLoading] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('RETURN_WINDOW_EXPIRED');
  const [rejectNote, setRejectNote] = useState('');

  const loadReturns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminListReturns({
        page,
        limit: LIMIT,
        ...(filterStatus && { status: filterStatus }),
      });
      setReturns(res.data);
      setMeta(res.meta);
    } catch (e) {
      console.error(e);
      setError('Failed to load returns.');
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus]);

  useEffect(() => { loadReturns(); }, [loadReturns]);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const d = await api.adminGetReturn(id);
      setDetail(d);
    } catch (e) {
      console.error(e);
      setDetailError('Failed to load return detail.');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const openDetail = (id: string) => {
    setSelectedId(id);
    loadDetail(id);
  };

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
  };

  const afterAction = async (id: string) => {
    await loadDetail(id);
    await loadReturns();
  };

  const doApprove = async () => {
    if (!detail) return;
    if (!confirm(`Approve return ${detail.rmaNumber}? This authorizes the RMA (no money or stock moves yet).`)) return;
    setActionLoading(true);
    try {
      await api.adminApproveReturn(detail.id);
      await afterAction(detail.id);
    } catch (e: unknown) {
      alert((e as Error)?.message || 'Failed to approve return');
    } finally {
      setActionLoading(false);
    }
  };

  const doReject = async () => {
    if (!detail) return;
    setActionLoading(true);
    try {
      await api.adminRejectReturn(detail.id, {
        reason: rejectReason,
        ...(rejectNote.trim() && { note: rejectNote.trim() }),
      });
      setShowRejectModal(false);
      setRejectNote('');
      setRejectReason('RETURN_WINDOW_EXPIRED');
      await afterAction(detail.id);
    } catch (e: unknown) {
      alert((e as Error)?.message || 'Failed to reject return');
    } finally {
      setActionLoading(false);
    }
  };

  const doInTransit = async () => {
    if (!detail) return;
    if (!confirm(`Mark return ${detail.rmaNumber} as in transit? (No money or stock moves.)`)) return;
    setActionLoading(true);
    try {
      await api.adminMarkReturnInTransit(detail.id);
      await afterAction(detail.id);
    } catch (e: unknown) {
      alert((e as Error)?.message || 'Failed to mark return in transit');
    } finally {
      setActionLoading(false);
    }
  };

  const doReceive = async () => {
    if (!detail) return;
    if (!confirm(
      `Receive return ${detail.rmaNumber}? This restocks the items, issues a Razorpay refund of ` +
      `${(detail.refundAmount / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}, ` +
      `and generates a credit note. This is the money step.`,
    )) return;
    setActionLoading(true);
    try {
      await api.adminReceiveReturn(detail.id);
      await afterAction(detail.id);
    } catch (e: unknown) {
      alert((e as Error)?.message || 'Failed to receive return');
    } finally {
      setActionLoading(false);
    }
  };

  // Computed refund from line items (sanity display vs. frozen Return.refundAmount).
  const computedRefund = detail
    ? detail.items.reduce((sum, it) => sum + (it.refundAmount || 0), 0)
    : 0;

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading && returns.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-forest border-t-transparent animate-spin mx-auto mb-4" />
          <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Returns</p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-ink animate-fade-in px-4 sm:px-6 lg:px-8 py-8 sm:py-12 max-w-[1280px] 3xl:max-w-[1600px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-10 flex flex-wrap justify-between items-end gap-4">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold leading-none">Returns &amp; RMA</h1>
          <p className="text-ink/50 mt-2 font-serif italic">Approve, receive &amp; refund return requests</p>
        </div>
        <button
          onClick={() => loadReturns()}
          className="px-4 py-2 border border-hairline text-[10px] uppercase tracking-widest font-bold hover:border-forest hover:text-forest transition-colors flex items-center gap-2"
        >
          <RefreshCcw className="w-3.5 h-3.5" /> Refresh
        </button>
      </header>

      {/* Filters */}
      <section className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-[9px] uppercase tracking-widest text-ink/40 font-bold mr-1">Status</span>
        {['', ...RETURN_STATUSES].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => { setPage(1); setFilterStatus(s); }}
            className={`px-3 py-1.5 text-[9px] uppercase tracking-widest font-bold border transition-colors ${
              filterStatus === s ? 'border-forest bg-forest text-parchment' : 'border-hairline bg-white text-ink/60 hover:border-forest/30'
            }`}
          >
            {s ? s.replace(/_/g, ' ') : 'All'}
          </button>
        ))}
      </section>

      {error && (
        <div className="mb-6 border border-terracotta/30 bg-terracotta/5 p-4 flex items-center gap-3 text-terracotta text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          <button onClick={() => loadReturns()} className="ml-auto text-[10px] uppercase tracking-widest font-bold hover:underline">Retry</button>
        </div>
      )}

      {/* Returns table */}
      <div className="border border-hairline bg-white overflow-x-auto">
        <div className="min-w-[820px]">
        <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
          <div className="col-span-3">RMA</div>
          <div className="col-span-2">Order</div>
          <div className="col-span-2">Customer</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2 text-right">Refund</div>
          <div className="col-span-1" />
        </div>

        {returns.length === 0 ? (
          <div className="p-12 text-center text-ink/40">
            <RotateCcw className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="font-serif italic">No returns match this filter.</p>
          </div>
        ) : (
          returns.map((r) => (
            <button
              key={r.id}
              onClick={() => openDetail(r.id)}
              className={`w-full text-left grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm ${
                selectedId === r.id ? 'bg-alabaster' : ''
              }`}
            >
              <div className="col-span-3">
                <div className="font-bold font-mono text-[13px]">{r.rmaNumber}</div>
                <div className="text-[10px] text-ink/40">
                  {r._count?.items != null ? `${r._count.items} item${r._count.items === 1 ? '' : 's'} · ` : ''}
                  {r.reason.replace(/_/g, ' ')}
                </div>
              </div>
              <div className="col-span-2 min-w-0">
                <div className="truncate font-mono text-[12px] font-semibold">{r.order?.orderNumber ?? '—'}</div>
                <div className="text-[10px] text-ink/40">{fmtDate(r.createdAt)}</div>
              </div>
              <div className="col-span-2 min-w-0">
                <div className="truncate text-xs font-semibold">{customerLabel(r.customer)}</div>
              </div>
              <div className="col-span-2">
                <Badge status={r.status} kind="return" />
              </div>
              <div className="col-span-2 text-right">
                <Money paise={r.refundAmount} className="font-serif font-bold" />
              </div>
              <div className="col-span-1 flex justify-end">
                <ChevronRight className="w-4 h-4 text-ink/30" />
              </div>
            </button>
          ))
        )}
        </div>
      </div>

      {meta.totalPages > 1 && (
        <div className="mt-8">
          <Pagination page={meta.page} totalPages={meta.totalPages} onPageChange={setPage} />
        </div>
      )}

      {/* ── DETAIL DRAWER ───────────────────────────────────────────────── */}
      {selectedId && (
        <div className="fixed inset-0 z-[90] flex justify-end">
          <div className="absolute inset-0 bg-forest/20 backdrop-blur-[20px]" onClick={closeDetail} aria-hidden />
          <div className="relative z-10 w-full max-w-[720px] h-full bg-parchment border-l border-hairline overflow-y-auto animate-fade-in">
            <div className="sticky top-0 z-20 bg-parchment/90 backdrop-blur-[20px] border-b border-hairline px-8 py-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Return / RMA</p>
                <h2 className="font-serif text-2xl font-bold leading-tight">{detail?.rmaNumber ?? '…'}</h2>
              </div>
              <button onClick={closeDetail} className="text-ink/40 hover:text-terracotta transition-colors" aria-label="Close">
                <X className="w-6 h-6" />
              </button>
            </div>

            {loadingDetail ? (
              <div className="p-16 text-center">
                <div className="w-6 h-6 border-2 border-forest border-t-transparent animate-spin mx-auto" />
              </div>
            ) : detailError ? (
              <div className="p-8">
                <div className="border border-terracotta/30 bg-terracotta/5 p-4 text-terracotta text-sm flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {detailError}
                  <button onClick={() => selectedId && loadDetail(selectedId)} className="ml-auto text-[10px] uppercase tracking-widest font-bold hover:underline">Retry</button>
                </div>
              </div>
            ) : detail ? (
              <div className="p-8 space-y-8">
                {/* Status row */}
                <div className="flex flex-wrap items-center gap-3">
                  <Badge status={detail.status} kind="return" />
                  <Badge status={detail.refundStatus} kind="refund" />
                  <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border bg-ink/5 text-ink/50 border-ink/15">
                    {detail.reason.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold ml-auto">
                    Requested {fmtDate(detail.createdAt)}
                  </span>
                </div>

                {/* Order link */}
                {detail.order && (
                  <div className="border border-hairline bg-white p-5 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-1">Original Order</p>
                      <p className="font-mono text-sm font-bold">{detail.order.orderNumber}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-1">Order Total</p>
                      <Money paise={detail.order.grandTotal} className="font-serif font-bold" />
                      {detail.order.refundedTotal > 0 && (
                        <p className="text-[10px] text-terracotta">−<Money paise={detail.order.refundedTotal} showSymbol /> already refunded</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="border border-hairline bg-white p-6">
                  <h3 className="font-serif text-lg font-bold mb-4">Actions</h3>
                  <div className="flex flex-wrap gap-2">
                    {detail.status === 'REQUESTED' && (
                      <>
                        <button
                          onClick={doApprove}
                          disabled={actionLoading}
                          className="px-5 py-2.5 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                        >
                          <CheckCircle className="w-3.5 h-3.5" /> {actionLoading ? 'Working…' : 'Approve RMA'}
                        </button>
                        <button
                          onClick={() => { setRejectReason('RETURN_WINDOW_EXPIRED'); setRejectNote(''); setShowRejectModal(true); }}
                          disabled={actionLoading}
                          className="px-5 py-2.5 border border-terracotta text-terracotta text-[10px] uppercase tracking-widest font-bold hover:bg-terracotta hover:text-white disabled:opacity-50 transition-colors flex items-center gap-2"
                        >
                          <Ban className="w-3.5 h-3.5" /> Reject
                        </button>
                      </>
                    )}
                    {detail.status === 'APPROVED' && (
                      <button
                        onClick={doInTransit}
                        disabled={actionLoading}
                        className="px-5 py-2.5 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment disabled:opacity-50 transition-colors flex items-center gap-2"
                      >
                        <Truck className="w-3.5 h-3.5" /> {actionLoading ? 'Working…' : 'Mark In Transit'}
                      </button>
                    )}
                    {(detail.status === 'APPROVED' || detail.status === 'IN_TRANSIT') && (
                      <button
                        onClick={doReceive}
                        disabled={actionLoading}
                        className="px-5 py-2.5 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                      >
                        <PackageCheck className="w-3.5 h-3.5" /> {actionLoading ? 'Working…' : 'Receive · Restock · Refund'}
                      </button>
                    )}
                    {['REJECTED', 'RECEIVED', 'REFUNDED', 'CANCELLED'].includes(detail.status) && (
                      <p className="text-xs text-ink/40 font-serif italic">
                        This return is in a terminal state — no further actions available.
                      </p>
                    )}
                  </div>

                  {detail.comment && (
                    <div className="mt-4 pt-4 border-t border-hairline">
                      <p className="text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-1">Resolution Comment</p>
                      <p className="text-sm text-ink/70">{detail.comment}</p>
                    </div>
                  )}
                </div>

                {/* Items + computed refund */}
                <div className="border border-hairline bg-white p-6">
                  <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2">
                    <ReceiptText className="w-4 h-4 text-forest/60" /> Return Items ({detail.items.length})
                  </h3>
                  <div className="space-y-2">
                    {detail.items.map((it) => (
                      <div key={it.id} className="flex items-start justify-between gap-4 py-2 border-b border-hairline/50 last:border-0">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">
                            {it.orderItem?.nameSnapshot ?? 'Item'}
                          </div>
                          {it.orderItem && (
                            <div className="text-[10px] text-ink/40 font-mono">{it.orderItem.skuCodeSnapshot}</div>
                          )}
                          <div className="text-[11px] text-ink/50 mt-0.5">
                            Qty {it.quantity}
                            {it.orderItem ? <> of {it.orderItem.quantity} ordered</> : null}
                            {' · '}
                            <span className={it.restocked ? 'text-forest font-semibold' : 'text-ink/40'}>
                              {it.restocked ? 'Restocked' : 'Not restocked'}
                            </span>
                          </div>
                        </div>
                        <Money paise={it.refundAmount} className="font-serif font-bold shrink-0" />
                      </div>
                    ))}
                  </div>

                  {/* Refund summary */}
                  <div className="mt-5 pt-4 border-t border-hairline space-y-1.5 text-sm">
                    <div className="flex justify-between text-ink/60">
                      <span>Line items refund (computed)</span>
                      <Money paise={computedRefund} />
                    </div>
                    <div className="flex justify-between font-serif text-lg font-bold pt-2 border-t border-hairline/60 mt-2">
                      <span className="flex items-center gap-1.5"><IndianRupee className="w-4 h-4 text-forest/60" /> Refund Amount</span>
                      <Money paise={detail.refundAmount} />
                    </div>
                    {computedRefund !== detail.refundAmount && (
                      <p className="text-[10px] text-terracotta flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3" />
                        Computed line total differs from the frozen refund amount (proportional tax / shipping handled server-side).
                      </p>
                    )}
                    {detail.razorpayRefundId && (
                      <p className="text-[10px] text-ink/40 mt-1">Razorpay refund: <code className="bg-alabaster px-1.5 py-0.5">{detail.razorpayRefundId}</code></p>
                    )}
                  </div>
                </div>

                {/* Customer */}
                <div className="border border-hairline bg-white p-6">
                  <h3 className="font-serif text-base font-bold mb-3 flex items-center gap-2">
                    <User className="w-4 h-4 text-forest/60" /> Customer
                  </h3>
                  <p className="text-sm font-semibold">{customerLabel(detail.customer)}</p>
                  {detail.customer && <p className="text-xs text-ink/50">{detail.customer.email}</p>}
                </div>

                {/* Lifecycle timestamps */}
                <div className="border border-hairline bg-white p-6">
                  <h3 className="font-serif text-base font-bold mb-4">Lifecycle</h3>
                  <dl className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                    <dt className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Requested</dt>
                    <dd className="text-ink/70">{fmtDate(detail.createdAt)}</dd>
                    <dt className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Approved</dt>
                    <dd className="text-ink/70">{fmtDate(detail.approvedAt)}</dd>
                    <dt className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Received</dt>
                    <dd className="text-ink/70">{fmtDate(detail.receivedAt)}</dd>
                    <dt className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Refunded</dt>
                    <dd className="text-ink/70">{fmtDate(detail.refundedAt)}</dd>
                  </dl>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ── REJECT MODAL ────────────────────────────────────────────────── */}
      <Modal
        open={showRejectModal}
        onClose={() => !actionLoading && setShowRejectModal(false)}
        dismissible={!actionLoading}
        title="Reject Return"
        footer={
          <>
            <button
              onClick={() => setShowRejectModal(false)}
              disabled={actionLoading}
              className="px-5 py-2.5 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={doReject}
              disabled={actionLoading}
              className="px-6 py-2.5 bg-terracotta text-white text-[10px] uppercase tracking-widest font-bold hover:bg-terracotta/90 disabled:opacity-50 transition-colors"
            >
              {actionLoading ? 'Rejecting…' : 'Reject Return'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-ink/50">
            Rejecting closes this RMA with a structured reason. No money or stock moves.
          </p>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Reason *</label>
            <select
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest bg-white"
            >
              {REJECT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Note (optional)</label>
            <textarea
              rows={3}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Additional detail surfaced to the customer…"
              className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
