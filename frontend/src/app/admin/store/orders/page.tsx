'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Package, ChevronRight, X, Truck, FileText, Download, RefreshCcw,
  ArrowRight, User, MapPin, ReceiptText, Circle, AlertTriangle,
  CheckCircle, Clock, Ban, Search,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAdminOrdersSocket, type OrderUpdatedPayload } from '@/lib/storeSockets';
import Money from '@/components/store/Money';
import Pagination from '@/components/store/Pagination';
import Modal from '@/components/store/Modal';

// ── Types (mirror backend Prisma includes) ──────────────────────────────────

interface OrderCustomer {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  grandTotal: number;
  refundedTotal: number;
  guestEmail: string | null;
  customer: OrderCustomer | null;
  createdAt: string;
  _count?: { items: number };
}

interface OrderItem {
  id: string;
  nameSnapshot: string;
  skuCodeSnapshot: string;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  lineDiscount: number;
  taxableValue: number;
  lineTotal: number;
  variantSnapshot?: Record<string, unknown> | null;
}

interface OrderEvent {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  triggeredBy: string | null;
  actorRole: string | null;
  createdAt: string;
}

interface Shipment {
  id: string;
  shipmentNumber: string | null;
  courier: string;
  awb: string | null;
  trackingUrl: string | null;
  status: string;
  shippingCost: number;
  shippedAt: string | null;
  deliveredAt: string | null;
}

interface InvoiceRef {
  id: string;
  invoiceNumber: string;
  type: string;
  status: string;
  pdfS3Key: string | null;
}

interface OrderAddress {
  fullName?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  stateCode?: string;
  postalCode?: string;
  country?: string;
}

interface OrderDetail extends OrderRow {
  currency: string;
  itemsSubtotal: number;
  discountTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  taxTotal: number;
  shippingTotal: number;
  couponCodeSnapshot: string | null;
  guestPhone: string | null;
  placedAt: string | null;
  paidAt: string | null;
  deliveredAt: string | null;
  billingAddress: OrderAddress | null;
  shippingAddress: OrderAddress | null;
  items: OrderItem[];
  events: OrderEvent[];
  shipments: Shipment[];
  invoices: InvoiceRef[];
}

interface Meta { total: number; page: number; limit: number; totalPages: number }

// ── Constants ───────────────────────────────────────────────────────────────

const ORDER_STATUSES = [
  'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'PROCESSING', 'PACKED',
  'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED',
];

const PAYMENT_STATUSES = ['UNPAID', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'];

const COURIERS = ['DELHIVERY', 'BLUEDART', 'SHIPROCKET', 'DTDC', 'INDIA_POST', 'OTHER'];

// Mirror of the backend ALLOWED_TRANSITIONS graph (orders.service.ts). Used to
// render only legal next-status actions; the server re-validates regardless.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING_PAYMENT: ['CANCELLED'],
  PAID: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'PACKED', 'CANCELLED'],
  PROCESSING: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
  PARTIALLY_REFUNDED: [],
};

const LIMIT = 20;

// Admin status palette is strict DESIGN.md: forest / parchment / terracotta /
// hairline only. Functional states are differentiated by forest-tonal layering
// (in-flight) vs. terracotta (terminal/refunded) vs. neutral ink (pending) —
// no saffron/marigold (those belong to the mkt-* premium layer).
function orderStatusClass(status: string): string {
  switch (status) {
    case 'DELIVERED':
      return 'bg-forest text-parchment border-forest';
    case 'SHIPPED':
    case 'PACKED':
    case 'PROCESSING':
      return 'bg-forest/10 text-forest border-forest/30';
    case 'CONFIRMED':
    case 'PAID':
      return 'bg-forest/5 text-forest border-forest/20';
    case 'CANCELLED':
      return 'bg-terracotta/10 text-terracotta border-terracotta/20';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'bg-terracotta/5 text-terracotta border-terracotta/20';
    case 'PENDING_PAYMENT':
    default:
      return 'bg-ink/5 text-ink/50 border-ink/15';
  }
}

function paymentStatusClass(status: string): string {
  switch (status) {
    case 'PAID':
      return 'bg-forest/10 text-forest border-forest/30';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'bg-terracotta/5 text-terracotta border-terracotta/20';
    case 'UNPAID':
    default:
      return 'bg-terracotta/10 text-terracotta border-terracotta/20';
  }
}

function StatusBadge({ status, kind }: { status: string; kind: 'order' | 'payment' }) {
  const cls = kind === 'order' ? orderStatusClass(status) : paymentStatusClass(status);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function customerLabel(o: { customer: OrderCustomer | null; guestEmail: string | null }): string {
  if (o.customer) {
    const name = [o.customer.firstName, o.customer.lastName].filter(Boolean).join(' ').trim();
    return name || o.customer.email;
  }
  return o.guestEmail ? `${o.guestEmail} (guest)` : 'Guest';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminStoreOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: LIMIT, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [livePing, setLivePing] = useState(false);

  // Detail panel
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Action state
  const [actionLoading, setActionLoading] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState<string | null>(null);
  const [transitionNote, setTransitionNote] = useState('');

  const [showShipModal, setShowShipModal] = useState(false);
  const [shipForm, setShipForm] = useState({
    courier: 'DELHIVERY', awb: '', trackingUrl: '', shippingCostRupees: '', weightGrams: '', note: '',
  });

  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminListOrders({
        page,
        limit: LIMIT,
        ...(filterStatus && { status: filterStatus }),
        ...(filterPayment && { paymentStatus: filterPayment }),
        ...(search && { search }),
      });
      setOrders(res.data);
      setMeta(res.meta);
    } catch (e) {
      console.error(e);
      setError('Failed to load orders.');
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterPayment, search]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setDetailError(null);
    setInvoiceUrl(null);
    setTransitionTarget(null);
    setTransitionNote('');
    try {
      const d = await api.adminGetOrder(id);
      setDetail(d);
    } catch (e) {
      console.error(e);
      setDetailError('Failed to load order detail.');
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
    setInvoiceUrl(null);
  };

  // Live order feed → patch list rows in place; refresh open detail.
  const onLiveOrder = useCallback((p: OrderUpdatedPayload) => {
    setLivePing(true);
    setTimeout(() => setLivePing(false), 1200);
    setOrders((prev) =>
      prev.map((o) =>
        o.id === p.orderId ? { ...o, status: p.status, paymentStatus: p.paymentStatus } : o,
      ),
    );
    if (selectedIdRef.current === p.orderId) {
      loadDetail(p.orderId);
    }
  }, [loadDetail]);

  useAdminOrdersSocket(onLiveOrder);

  const applySearch = () => {
    setPage(1);
    setSearch(searchInput.trim());
  };

  const doTransition = async () => {
    if (!detail || !transitionTarget) return;
    if (!confirm(`Transition order ${detail.orderNumber} to ${transitionTarget.replace(/_/g, ' ')}?`)) return;
    setActionLoading(true);
    try {
      await api.adminTransitionOrder(detail.id, {
        toStatus: transitionTarget,
        ...(transitionNote.trim() && { note: transitionNote.trim() }),
      });
      setTransitionTarget(null);
      setTransitionNote('');
      await loadDetail(detail.id);
      await loadOrders();
    } catch (e: unknown) {
      alert((e as Error)?.message || 'Failed to transition order');
    } finally {
      setActionLoading(false);
    }
  };

  const openShipModal = () => {
    setShipForm({
      courier: 'DELHIVERY', awb: '', trackingUrl: '', shippingCostRupees: '', weightGrams: '', note: '',
    });
    setShowShipModal(true);
  };

  const doShip = async () => {
    if (!detail) return;
    // Validate up-front, before toggling the loading flag, so the only path that
    // sets actionLoading is wrapped in try/finally — no risk of locking the button.
    if (!shipForm.awb.trim()) {
      alert('AWB / tracking number is required for a manual shipment');
      return;
    }
    const shippingCost = shipForm.shippingCostRupees.trim() === ''
      ? undefined
      : Math.round(Number(shipForm.shippingCostRupees) * 100);
    const weightGrams = shipForm.weightGrams.trim() === ''
      ? undefined
      : Number(shipForm.weightGrams);
    if (shippingCost !== undefined && (Number.isNaN(shippingCost) || shippingCost < 0)) {
      alert('Shipping cost must be a non-negative amount');
      return;
    }
    if (weightGrams !== undefined && (Number.isNaN(weightGrams) || weightGrams < 0)) {
      alert('Weight must be a non-negative whole number of grams');
      return;
    }
    setActionLoading(true);
    try {
      await api.adminShipOrder(detail.id, {
        courier: shipForm.courier,
        awb: shipForm.awb.trim(),
        ...(shipForm.trackingUrl.trim() && { trackingUrl: shipForm.trackingUrl.trim() }),
        ...(shippingCost !== undefined && { shippingCost }),
        ...(weightGrams !== undefined && { weightGrams }),
        ...(shipForm.note.trim() && { note: shipForm.note.trim() }),
      });
      setShowShipModal(false);
      await loadDetail(detail.id);
      await loadOrders();
    } catch (e: unknown) {
      alert((e as Error)?.message || 'Failed to create shipment');
    } finally {
      setActionLoading(false);
    }
  };

  const doInvoice = async () => {
    if (!detail) return;
    setInvoiceLoading(true);
    try {
      const res = await api.adminIssueOrderInvoice(detail.id);
      const url: string | null = res?.downloadUrl ?? null;
      setInvoiceUrl(url);
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        alert('Invoice issued, but no download URL was returned. Refresh and try again.');
      }
      await loadDetail(detail.id);
    } catch (e: unknown) {
      alert((e as Error)?.message || 'Failed to generate invoice');
    } finally {
      setInvoiceLoading(false);
    }
  };

  const nextStatuses = detail ? (ALLOWED_TRANSITIONS[detail.status] ?? []) : [];

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading && orders.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-forest border-t-transparent animate-spin mx-auto mb-4" />
          <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Orders</p>
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
          <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold leading-none">Order Board</h1>
          <p className="text-ink/50 mt-2 font-serif italic">Live fulfillment, shipping &amp; invoicing</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-ink/40">
            <Circle className={`w-2.5 h-2.5 ${livePing ? 'text-success fill-success' : 'text-success/40 fill-success/40'} transition-colors`} />
            Live
          </span>
          <button
            onClick={() => loadOrders()}
            className="px-4 py-2 border border-hairline text-[10px] uppercase tracking-widest font-bold hover:border-forest hover:text-forest transition-colors flex items-center gap-2"
          >
            <RefreshCcw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </header>

      {/* Filters */}
      <section className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[9px] uppercase tracking-widest text-ink/40 font-bold mr-1">Status</span>
          {['', ...ORDER_STATUSES].map((s) => (
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[9px] uppercase tracking-widest text-ink/40 font-bold mr-1">Payment</span>
          {['', ...PAYMENT_STATUSES].map((s) => (
            <button
              key={s || 'all'}
              onClick={() => { setPage(1); setFilterPayment(s); }}
              className={`px-3 py-1.5 text-[9px] uppercase tracking-widest font-bold border transition-colors ${
                filterPayment === s ? 'border-forest bg-forest text-parchment' : 'border-hairline bg-white text-ink/60 hover:border-forest/30'
              }`}
            >
              {s ? s.replace(/_/g, ' ') : 'All'}
            </button>
          ))}
          <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-2">
            <div className="relative flex-1 sm:flex-none">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
              <input
                type="text"
                placeholder="Order # / email…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }}
                className="w-full sm:w-56 border border-hairline pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-forest"
              />
            </div>
            <button
              onClick={applySearch}
              className="px-4 py-2 border border-hairline text-[10px] uppercase tracking-widest font-bold hover:border-forest hover:text-forest transition-colors"
            >
              Search
            </button>
            {search && (
              <button
                onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
                className="px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-ink/40 hover:text-terracotta transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </section>

      {error && (
        <div className="mb-6 border border-terracotta/30 bg-terracotta/5 p-4 flex items-center gap-3 text-terracotta text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          <button onClick={() => loadOrders()} className="ml-auto text-[10px] uppercase tracking-widest font-bold hover:underline">Retry</button>
        </div>
      )}

      {/* Orders table */}
      <div className="border border-hairline bg-white overflow-x-auto">
        <div className="min-w-[820px]">
        <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
          <div className="col-span-3">Order</div>
          <div className="col-span-3">Customer</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1">Payment</div>
          <div className="col-span-2 text-right">Total</div>
          <div className="col-span-1" />
        </div>

        {orders.length === 0 ? (
          <div className="p-12 text-center text-ink/40">
            <Package className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="font-serif italic">No orders match these filters.</p>
          </div>
        ) : (
          orders.map((o) => (
            <button
              key={o.id}
              onClick={() => openDetail(o.id)}
              className={`w-full text-left grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm ${
                selectedId === o.id ? 'bg-alabaster' : ''
              }`}
            >
              <div className="col-span-3">
                <div className="font-bold font-mono text-[13px]">{o.orderNumber}</div>
                <div className="text-[10px] text-ink/40">
                  {o._count?.items != null ? `${o._count.items} item${o._count.items === 1 ? '' : 's'} · ` : ''}
                  {fmtDate(o.createdAt)}
                </div>
              </div>
              <div className="col-span-3 min-w-0">
                <div className="truncate text-xs font-semibold">{customerLabel(o)}</div>
                {o.customer && <div className="text-[10px] text-ink/40 truncate">{o.customer.email}</div>}
              </div>
              <div className="col-span-2"><StatusBadge status={o.status} kind="order" /></div>
              <div className="col-span-1"><StatusBadge status={o.paymentStatus} kind="payment" /></div>
              <div className="col-span-2 text-right">
                <Money paise={o.grandTotal} className="font-serif font-bold" />
                {o.refundedTotal > 0 && (
                  <div className="text-[10px] text-terracotta">−<Money paise={o.refundedTotal} showSymbol={false} /> refunded</div>
                )}
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
          <div className="relative z-10 w-full max-w-[760px] h-full bg-parchment border-l border-hairline overflow-y-auto animate-fade-in">
            {/* Drawer header */}
            <div className="sticky top-0 z-20 bg-parchment/90 backdrop-blur-[20px] border-b border-hairline px-8 py-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Order Detail</p>
                <h2 className="font-serif text-2xl font-bold leading-tight">{detail?.orderNumber ?? '…'}</h2>
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
                  <StatusBadge status={detail.status} kind="order" />
                  <StatusBadge status={detail.paymentStatus} kind="payment" />
                  <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold ml-auto">
                    Placed {fmtDate(detail.placedAt || detail.createdAt)}
                  </span>
                </div>

                {/* Actions */}
                <div className="border border-hairline bg-white p-6">
                  <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2">
                    <ArrowRight className="w-4 h-4 text-forest/60" /> Actions
                  </h3>

                  {/* Transition */}
                  {nextStatuses.length > 0 ? (
                    <div className="mb-5">
                      <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Advance Status</label>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {nextStatuses.map((s) => (
                          <button
                            key={s}
                            onClick={() => setTransitionTarget(s)}
                            className={`px-4 py-2 text-[10px] uppercase tracking-widest font-bold border transition-colors flex items-center gap-1.5 ${
                              transitionTarget === s
                                ? (s === 'CANCELLED' ? 'border-terracotta bg-terracotta text-white' : 'border-forest bg-forest text-parchment')
                                : 'border-hairline bg-white text-ink/60 hover:border-forest/40'
                            }`}
                          >
                            {s === 'CANCELLED' ? <Ban className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                            {s.replace(/_/g, ' ')}
                          </button>
                        ))}
                      </div>
                      {transitionTarget && (
                        <div className="space-y-3 animate-fade-in">
                          <textarea
                            rows={2}
                            placeholder="Optional note (recorded on the order timeline)…"
                            value={transitionNote}
                            onChange={(e) => setTransitionNote(e.target.value)}
                            className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
                          />
                          <div className="flex justify-end gap-3">
                            <button
                              onClick={() => { setTransitionTarget(null); setTransitionNote(''); }}
                              className="px-5 py-2.5 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={doTransition}
                              disabled={actionLoading}
                              className="px-6 py-2.5 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors"
                            >
                              {actionLoading ? 'Working…' : `Confirm → ${transitionTarget.replace(/_/g, ' ')}`}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-ink/40 mb-5 font-serif italic">
                      This order is in a terminal state — no status transitions available.
                    </p>
                  )}

                  {/* Fulfillment + invoice buttons */}
                  <div className="flex flex-wrap gap-2 pt-4 border-t border-hairline">
                    <button
                      onClick={openShipModal}
                      disabled={detail.status !== 'PACKED'}
                      title={detail.status !== 'PACKED' ? 'Order must be PACKED to create a shipment' : undefined}
                      className="px-4 py-2.5 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-forest disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                      <Truck className="w-3.5 h-3.5" /> Create Shipment
                    </button>
                    <button
                      onClick={doInvoice}
                      disabled={invoiceLoading}
                      className="px-4 py-2.5 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                      <FileText className="w-3.5 h-3.5" /> {invoiceLoading ? 'Issuing…' : 'Generate Invoice'}
                    </button>
                    {invoiceUrl && (
                      <a
                        href={invoiceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2.5 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors flex items-center gap-2"
                      >
                        <Download className="w-3.5 h-3.5" /> Download Invoice
                      </a>
                    )}
                  </div>
                </div>

                {/* Items */}
                <div className="border border-hairline bg-white p-6">
                  <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2">
                    <Package className="w-4 h-4 text-forest/60" /> Items ({detail.items.length})
                  </h3>
                  <div className="space-y-2">
                    {detail.items.map((it) => (
                      <div key={it.id} className="flex items-start justify-between gap-4 py-2 border-b border-hairline/50 last:border-0">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">{it.nameSnapshot}</div>
                          <div className="text-[10px] text-ink/40 font-mono">{it.skuCodeSnapshot}</div>
                          <div className="text-[11px] text-ink/50 mt-0.5">
                            {it.quantity} × <Money paise={it.unitPrice} />
                            {it.lineDiscount > 0 && <span className="text-terracotta"> · −<Money paise={it.lineDiscount} /> disc</span>}
                          </div>
                        </div>
                        <Money paise={it.lineTotal} className="font-serif font-bold shrink-0" />
                      </div>
                    ))}
                  </div>

                  {/* Totals */}
                  <div className="mt-5 pt-4 border-t border-hairline space-y-1.5 text-sm">
                    <div className="flex justify-between text-ink/60">
                      <span>Subtotal</span><Money paise={detail.itemsSubtotal} />
                    </div>
                    {detail.discountTotal > 0 && (
                      <div className="flex justify-between text-terracotta">
                        <span>Discount{detail.couponCodeSnapshot ? ` (${detail.couponCodeSnapshot})` : ''}</span>
                        <span>−<Money paise={detail.discountTotal} showSymbol /></span>
                      </div>
                    )}
                    <div className="flex justify-between text-ink/60">
                      <span>Tax (GST)</span><Money paise={detail.taxTotal} />
                    </div>
                    {detail.shippingTotal > 0 && (
                      <div className="flex justify-between text-ink/60">
                        <span>Shipping</span><Money paise={detail.shippingTotal} />
                      </div>
                    )}
                    <div className="flex justify-between font-serif text-lg font-bold pt-2 border-t border-hairline/60 mt-2">
                      <span>Grand Total</span><Money paise={detail.grandTotal} />
                    </div>
                    {detail.refundedTotal > 0 && (
                      <div className="flex justify-between text-terracotta text-xs">
                        <span>Refunded</span><span>−<Money paise={detail.refundedTotal} showSymbol /></span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Customer + address */}
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="border border-hairline bg-white p-6">
                    <h3 className="font-serif text-base font-bold mb-3 flex items-center gap-2">
                      <User className="w-4 h-4 text-forest/60" /> Customer
                    </h3>
                    <p className="text-sm font-semibold">{customerLabel(detail)}</p>
                    {detail.customer && <p className="text-xs text-ink/50">{detail.customer.email}</p>}
                    {detail.guestEmail && !detail.customer && <p className="text-xs text-ink/50">{detail.guestEmail}</p>}
                    {(detail.shippingAddress?.phone || detail.guestPhone) && (
                      <p className="text-xs text-ink/50">{detail.shippingAddress?.phone || detail.guestPhone}</p>
                    )}
                  </div>
                  <div className="border border-hairline bg-white p-6">
                    <h3 className="font-serif text-base font-bold mb-3 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-forest/60" /> Shipping Address
                    </h3>
                    {detail.shippingAddress ? (
                      <address className="not-italic text-xs text-ink/60 leading-relaxed">
                        {detail.shippingAddress.fullName && <div className="font-semibold text-ink/80">{detail.shippingAddress.fullName}</div>}
                        {detail.shippingAddress.line1 && <div>{detail.shippingAddress.line1}</div>}
                        {detail.shippingAddress.line2 && <div>{detail.shippingAddress.line2}</div>}
                        <div>
                          {[detail.shippingAddress.city, detail.shippingAddress.postalCode].filter(Boolean).join(' ')}
                        </div>
                        <div>
                          {[detail.shippingAddress.stateCode && `State ${detail.shippingAddress.stateCode}`, detail.shippingAddress.country]
                            .filter(Boolean).join(' · ')}
                        </div>
                      </address>
                    ) : (
                      <p className="text-xs text-ink/40 font-serif italic">No shipping address on file.</p>
                    )}
                  </div>
                </div>

                {/* Shipments */}
                {detail.shipments.length > 0 && (
                  <div className="border border-hairline bg-white p-6">
                    <h3 className="font-serif text-base font-bold mb-3 flex items-center gap-2">
                      <Truck className="w-4 h-4 text-forest/60" /> Shipments ({detail.shipments.length})
                    </h3>
                    <div className="space-y-3">
                      {detail.shipments.map((s) => (
                        <div key={s.id} className="border border-hairline/60 p-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-mono text-[12px] font-semibold">{s.shipmentNumber || s.awb || 'Shipment'}</span>
                            <span className="px-2 py-0.5 text-[8px] uppercase tracking-widest font-bold border bg-ink/5 text-ink/50 border-ink/15">
                              {s.status.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="text-[11px] text-ink/50 mt-1">
                            {s.courier.replace(/_/g, ' ')}{s.awb ? ` · AWB ${s.awb}` : ''}
                            {s.shippingCost > 0 && <> · <Money paise={s.shippingCost} /></>}
                          </div>
                          {s.trackingUrl && /^https?:\/\//i.test(s.trackingUrl) && (
                            <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-forest font-bold hover:underline mt-1 inline-block">
                              Track shipment →
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Invoices on file */}
                {detail.invoices.length > 0 && (
                  <div className="border border-hairline bg-white p-6">
                    <h3 className="font-serif text-base font-bold mb-3 flex items-center gap-2">
                      <ReceiptText className="w-4 h-4 text-forest/60" /> Invoices ({detail.invoices.length})
                    </h3>
                    <div className="space-y-2">
                      {detail.invoices.map((inv) => (
                        <div key={inv.id} className="flex items-center justify-between gap-3 text-sm border-b border-hairline/50 last:border-0 py-1.5">
                          <span className="font-mono text-[12px]">{inv.invoiceNumber}</span>
                          <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">
                            {inv.type.replace(/_/g, ' ')} · {inv.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Timeline */}
                <div className="border border-hairline bg-white p-6">
                  <h3 className="font-serif text-base font-bold mb-4 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-forest/60" /> Status Timeline
                  </h3>
                  {detail.events.length === 0 ? (
                    <p className="text-xs text-ink/40 font-serif italic">No events recorded.</p>
                  ) : (
                    <div className="space-y-3">
                      {detail.events.map((ev) => (
                        <div key={ev.id} className="flex gap-4 items-start border-l-2 border-forest/20 pl-4 py-1 hover:border-forest transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <span className="px-2 py-0.5 text-[8px] uppercase tracking-widest font-bold border bg-ink/5 text-ink/50 border-ink/15">
                                {ev.type.replace(/_/g, ' ')}
                              </span>
                              {ev.fromStatus && ev.toStatus && (
                                <span className="text-[10px] text-ink/40">
                                  {ev.fromStatus.replace(/_/g, ' ')} → {ev.toStatus.replace(/_/g, ' ')}
                                </span>
                              )}
                            </div>
                            {ev.note && <p className="text-xs text-ink/70 mt-0.5">{ev.note}</p>}
                            {ev.actorRole && (
                              <p className="text-[10px] text-ink/30 mt-0.5">by {ev.actorRole}</p>
                            )}
                          </div>
                          <span className="text-[10px] text-ink/30 whitespace-nowrap">{fmtDate(ev.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ── SHIP MODAL ──────────────────────────────────────────────────── */}
      <Modal
        open={showShipModal}
        onClose={() => !actionLoading && setShowShipModal(false)}
        dismissible={!actionLoading}
        title="Create Shipment"
        size="max-w-xl"
        footer={
          <>
            <button
              onClick={() => setShowShipModal(false)}
              disabled={actionLoading}
              className="px-5 py-2.5 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={doShip}
              disabled={actionLoading}
              className="px-6 py-2.5 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors"
            >
              {actionLoading ? 'Creating…' : 'Create Shipment & Mark Shipped'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-ink/50">
            Creating a manual shipment records the courier + AWB and advances the order to <strong>SHIPPED</strong>.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Courier *</label>
              <select
                value={shipForm.courier}
                onChange={(e) => setShipForm({ ...shipForm, courier: e.target.value })}
                className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest bg-white"
              >
                {COURIERS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">AWB / Tracking No. *</label>
              <input
                type="text"
                value={shipForm.awb}
                onChange={(e) => setShipForm({ ...shipForm, awb: e.target.value })}
                placeholder="e.g., 1234567890"
                className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Tracking URL (optional)</label>
            <input
              type="url"
              value={shipForm.trackingUrl}
              onChange={(e) => setShipForm({ ...shipForm, trackingUrl: e.target.value })}
              placeholder="https://…"
              className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Shipping Cost (₹, optional)</label>
              <input
                type="number" min={0} step="0.01"
                value={shipForm.shippingCostRupees}
                onChange={(e) => setShipForm({ ...shipForm, shippingCostRupees: e.target.value })}
                placeholder="e.g., 80"
                className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Weight (grams, optional)</label>
              <input
                type="number" min={0} step="1"
                value={shipForm.weightGrams}
                onChange={(e) => setShipForm({ ...shipForm, weightGrams: e.target.value })}
                placeholder="e.g., 500"
                className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Note (optional)</label>
            <textarea
              rows={2}
              value={shipForm.note}
              onChange={(e) => setShipForm({ ...shipForm, note: e.target.value })}
              className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
