'use client';

/**
 * /orders/[id] — order confirmation + detail + tracking.
 *
 * Works for BOTH a signed-in customer (uses the customer token automatically) and
 * a guest (a one-time order token, passed as `?token=` in the URL or read back
 * from sessionStorage where checkout stashed it). The token is forwarded to
 * storeApi.getOrder / getOrderTracking / getOrderInvoiceUrl so the backend takes
 * the guest path.
 *
 * Because Razorpay capture is confirmed asynchronously by a server webhook, an
 * order can land here as PENDING for a few seconds. We poll the order a handful
 * of times while it is still PENDING so the confirmation flips to PAID without a
 * manual refresh.
 *
 * Next.js 16: route `params` and `searchParams` are Promises → unwrap with use().
 */

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  AlertCircle,
  Package,
  Truck,
  FileDown,
  MapPin,
  ImageOff,
} from 'lucide-react';
import Layout from '@/components/Layout';
import { Money, PriceSummary } from '@/components/store';
import { storeApi, type OrderDetail, type OrderTracking } from '@/lib/storeApi';
import { ApiError } from '@/lib/api';
import { str, num, GUEST_ORDER_TOKEN_PREFIX, isSafeHttpUrl } from '@/lib/storeHelpers';
import { cn } from '@/lib/cn';

// How long to keep polling a PENDING order for the async webhook capture.
const MAX_POLLS = 6;
const POLL_INTERVAL_MS = 4000;

const PAID_STATUSES = new Set(['PAID', 'CONFIRMED', 'COMPLETED', 'CAPTURED']);
const FAILED_STATUSES = new Set(['FAILED', 'CANCELLED', 'CANCELED', 'PAYMENT_FAILED']);

type PayPhase = 'paid' | 'pending' | 'failed' | 'unknown';

function payPhase(order: OrderDetail | null): PayPhase {
  if (!order) return 'unknown';
  const s = (order.paymentStatus || order.status || '').toUpperCase();
  if (PAID_STATUSES.has(s)) return 'paid';
  if (FAILED_STATUSES.has(s)) return 'failed';
  if (s === 'PENDING' || s === 'CREATED' || s === 'AWAITING_PAYMENT') return 'pending';
  return 'unknown';
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AddressBlock({ addr }: { addr: Record<string, unknown> | null | undefined }) {
  if (!addr) return null;
  const name = str(addr, 'fullName', 'name');
  const line1 = str(addr, 'line1', 'addressLine1', 'street');
  const line2 = str(addr, 'line2', 'addressLine2');
  const city = str(addr, 'city');
  const state = str(addr, 'state', 'region');
  const postal = str(addr, 'postalCode', 'pincode', 'zip');
  const country = str(addr, 'country');
  const phone = str(addr, 'phone', 'contact');
  const cityLine = [city, state, postal].filter(Boolean).join(', ');
  return (
    <div className="font-sans text-sm leading-relaxed text-ink/75">
      {name && <p className="font-semibold text-forest">{name}</p>}
      {line1 && <p>{line1}</p>}
      {line2 && <p>{line2}</p>}
      {cityLine && <p>{cityLine}</p>}
      {country && <p>{country}</p>}
      {phone && <p className="mt-1 text-ink/55">{phone}</p>}
    </div>
  );
}

function OrderClient({ orderId, queryToken }: { orderId: string; queryToken: string | null }) {
  const [guestToken, setGuestToken] = useState<string | null>(queryToken);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [tracking, setTracking] = useState<OrderTracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  const pollCount = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve a guest token: prefer the query param, else read what checkout stashed
  // in sessionStorage (so a refresh / bare-URL paste still works for a guest).
  useEffect(() => {
    if (queryToken) {
      // Use the token from the URL directly. We deliberately do NOT re-persist it
      // to sessionStorage here: /checkout already stashed it for the guest who
      // placed the order, and re-writing it would mean a SHARED or bookmarked
      // ?token= URL opened on someone else's machine plants the one-time token in
      // their session, needlessly widening its exposure window.
      setGuestToken(queryToken);
      return;
    }
    // No query token. Fall back to the copy checkout stashed — but only for a
    // guest (no customer session). When a customer IS signed in, the order page
    // authorises via the customer token, so we must NOT resurrect a stale guest
    // token: the authenticated path is both correct and higher-privilege.
    if (!storeApi.getCustomerToken()) {
      try {
        const stored = sessionStorage.getItem(`${GUEST_ORDER_TOKEN_PREFIX}${orderId}`);
        if (stored) setGuestToken(stored);
      } catch {
        /* sessionStorage may be unavailable (private mode) — the order simply won't load for a guest */
      }
    }
  }, [queryToken, orderId]);

  const fetchOrder = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      const token = guestToken ?? undefined;
      if (!opts.silent) setLoading(true);
      try {
        const data = await storeApi.getOrder(orderId, token);
        setOrder(data);
        setError(null);
        // Tracking is best-effort: never let its failure mask a loaded order.
        storeApi
          .getOrderTracking(orderId, token)
          .then(setTracking)
          .catch(() => undefined);
        return data;
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setError(
            'This order link is invalid or has expired. If you placed this order, please use the link from your confirmation email.',
          );
        } else if (err instanceof ApiError && err.status === 404) {
          setError('We could not find that order.');
        } else {
          setError((err as { message?: string })?.message || 'Could not load this order.');
        }
        return null;
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [orderId, guestToken],
  );

  // Initial load.
  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  // Poll while PENDING (async webhook capture). Stops on paid/failed or after
  // MAX_POLLS attempts.
  useEffect(() => {
    if (!order) return;
    const phase = payPhase(order);
    if (phase !== 'pending') return;
    if (pollCount.current >= MAX_POLLS) return;

    pollTimer.current = setTimeout(() => {
      pollCount.current += 1;
      void fetchOrder({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [order, fetchOrder]);

  const handleInvoice = async () => {
    setInvoiceBusy(true);
    setInvoiceError(null);
    try {
      const { url } = await storeApi.getOrderInvoiceUrl(orderId, guestToken ?? undefined);
      // Gate the backend-supplied URL to http(s) before opening it. The invoice is
      // expected to be an S3 presigned HTTPS URL, but a non-http scheme (javascript:
      // / data:) returned by the backend or injected by a MITM would otherwise open
      // an execution vector in the new tab.
      if (isSafeHttpUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
      else setInvoiceError('Invoice is not available yet.');
    } catch (err) {
      setInvoiceError(
        (err as { message?: string })?.message || 'Invoice is not available yet.',
      );
    } finally {
      setInvoiceBusy(false);
    }
  };

  // ── Loading / error ──────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-ink/50">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <span className="ml-3 font-sans text-sm uppercase tracking-[0.05em]">Loading order…</span>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="mkt-card mx-auto max-w-xl px-6 py-16 text-center sm:px-8">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-terracotta/10 text-terracotta">
          <AlertCircle className="h-7 w-7" aria-hidden />
        </div>
        <h2 className="font-serif text-2xl text-forest">Order unavailable</h2>
        <p className="mx-auto mt-2 max-w-sm font-sans text-sm text-ink/60">
          {error || 'We could not load this order.'}
        </p>
        <Link href="/store" className="mkt-btn mt-8">
          <span>Back to the store</span>
        </Link>
      </div>
    );
  }

  const phase = payPhase(order);
  const items = Array.isArray(order.items) ? order.items : [];
  const orderNumber = order.orderNumber || order.id;
  const events = Array.isArray(tracking?.events) ? tracking!.events : [];
  const shipment = (tracking?.shipment as Record<string, unknown> | null | undefined) ?? null;
  const trackingNumber = str(shipment, 'trackingNumber', 'awb', 'trackingNo');
  const carrier = str(shipment, 'carrier', 'courier', 'provider');
  // Only render the courier link if it is an http(s) URL. React does NOT strip a
  // `javascript:` href from an anchor, so an untrusted backend/MITM value must be
  // scheme-checked before it becomes a clickable href.
  const rawTrackingUrl = str(shipment, 'trackingUrl', 'url');
  const trackingUrl = isSafeHttpUrl(rawTrackingUrl) ? rawTrackingUrl : null;
  const shipmentStatus = str(shipment, 'status') || tracking?.status || null;

  const statusBanner = {
    paid: {
      icon: CheckCircle2,
      tone: 'border-success/40 bg-success/5 text-success',
      title: 'Order confirmed',
      sub: 'Thank you! Your payment was received and your order is being prepared.',
    },
    pending: {
      icon: Clock,
      tone: 'border-warning/40 bg-warning/5 text-warning',
      title: 'Confirming your payment',
      sub: 'We’re waiting for payment confirmation. This page will update automatically.',
    },
    failed: {
      icon: XCircle,
      tone: 'border-terracotta/40 bg-terracotta/5 text-terracotta',
      title: 'Payment not completed',
      sub: 'We couldn’t confirm payment for this order. You can retry from your cart.',
    },
    unknown: {
      icon: Package,
      tone: 'border-hairline bg-white/60 text-forest',
      title: 'Order received',
      sub: 'Your order has been recorded.',
    },
  }[phase];

  const BannerIcon = statusBanner.icon;

  return (
    <div className="mx-auto max-w-screen-xl 3xl:max-w-[100rem]">
      {/* Status banner — flat 0px surface per the matte directive (no glossy
          rounded look). Tonal layering + a 1px border carry depth. */}
      <div
        className={cn(
          'mb-8 flex items-start gap-3 border px-4 py-5 sm:gap-4 sm:px-6',
          statusBanner.tone,
        )}
      >
        <BannerIcon
          className={cn('mt-0.5 h-7 w-7 shrink-0', phase === 'pending' && 'animate-pulse')}
          aria-hidden
        />
        <div className="min-w-0">
          <h1 className="font-serif text-2xl text-forest">{statusBanner.title}</h1>
          <p className="mt-1 font-sans text-sm text-ink/65">{statusBanner.sub}</p>
          {phase === 'failed' && (
            <Link href="/cart" className="mkt-btn-ghost mt-4">
              <span>Return to cart</span>
            </Link>
          )}
        </div>
      </div>

      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/50">
            Order
          </span>
          {/* break-all so a 36-char UUID order number can't force horizontal
              overflow at 360px when no human-readable orderNumber is present. */}
          <p className="break-all font-mono text-sm text-forest">{orderNumber}</p>
          {order.createdAt && (
            <p className="mt-0.5 font-sans text-xs text-ink/50">Placed {fmtDate(order.createdAt)}</p>
          )}
        </div>
        {phase === 'paid' && (
          <button
            type="button"
            onClick={handleInvoice}
            disabled={invoiceBusy}
            className="mkt-btn-ghost disabled:opacity-60"
          >
            {invoiceBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <FileDown className="h-4 w-4" aria-hidden />
            )}
            <span>Invoice</span>
          </button>
        )}
      </div>
      {invoiceError && (
        <p className="-mt-4 mb-6 text-right font-sans text-xs text-terracotta">{invoiceError}</p>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_22rem] lg:gap-10 xl:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          {/* Items */}
          <section className="mkt-card px-4 py-2 sm:px-6 lg:px-8">
            {items.length === 0 ? (
              <p className="py-8 text-center font-sans text-sm text-ink/50">
                No item details available.
              </p>
            ) : (
              items.map((raw, i) => {
                const item = raw as Record<string, unknown>;
                const id = str(item, 'id', 'itemId') ?? `item-${i}`;
                const name = str(item, 'name', 'productName', 'skuName', 'title') || 'Item';
                const skuCode = str(item, 'skuCode', 'sku', 'code');
                const imageUrl = str(item, 'imageUrl', 'primaryImageUrl', 'image', 'thumbnailUrl');
                const qty = num(item, 'qty', 'quantity') ?? 1;
                const unitPrice = num(item, 'unitPrice', 'price') ?? 0;
                const lineTotal =
                  num(item, 'lineSubtotal', 'subtotal', 'lineTotal', 'total') ?? unitPrice * qty;
                return (
                  <div
                    key={id}
                    className="flex items-center gap-4 border-b border-hairline/60 py-4 last:border-0"
                  >
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden bg-parchment-dark">
                      {imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-ink/25">
                          <ImageOff className="h-5 w-5" aria-hidden />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-serif text-base text-forest">{name}</p>
                      {skuCode && (
                        <p className="font-mono text-[11px] text-ink/45">{skuCode}</p>
                      )}
                      <p className="mt-1 font-sans text-xs text-ink/55">
                        Qty {qty} · <Money paise={unitPrice} showDecimals={false} /> each
                      </p>
                    </div>
                    <Money paise={lineTotal} className="font-sans text-sm font-bold text-forest" />
                  </div>
                );
              })
            )}
          </section>

          {/* Tracking */}
          <section className="mkt-card px-4 py-7 sm:px-6 lg:px-8">
            <div className="mb-4 flex items-center gap-2 text-forest">
              <Truck className="h-4 w-4" aria-hidden />
              <h2 className="font-sans text-[11px] font-semibold uppercase tracking-[0.1em]">
                Shipment tracking
              </h2>
            </div>

            {trackingNumber || carrier || shipmentStatus ? (
              <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 font-sans text-sm">
                {shipmentStatus && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-saffron-glow/25 px-3 py-1 text-xs font-semibold uppercase tracking-[0.05em] text-saffron-deep">
                    {shipmentStatus}
                  </span>
                )}
                {carrier && (
                  <span className="text-ink/65">
                    Carrier: <span className="text-forest">{carrier}</span>
                  </span>
                )}
                {trackingNumber && (
                  <span className="text-ink/65">
                    AWB:{' '}
                    {trackingUrl ? (
                      <a
                        href={trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        // Defence-in-depth: never leak the page URL (which can carry
                        // the guest ?token=) to the third-party courier domain.
                        referrerPolicy="no-referrer"
                        className="font-mono text-forest hover:text-saffron-deep"
                      >
                        {trackingNumber}
                      </a>
                    ) : (
                      <span className="font-mono text-forest">{trackingNumber}</span>
                    )}
                  </span>
                )}
              </div>
            ) : (
              <p className="mb-2 font-sans text-sm text-ink/55">
                {phase === 'paid'
                  ? 'Your order is confirmed. Tracking details will appear here once it ships.'
                  : 'Tracking will appear here once your order is confirmed and shipped.'}
              </p>
            )}

            {events.length > 0 && (
              <ol className="relative ml-1.5 mt-4 space-y-5 border-l border-hairline pl-6">
                {events.map((raw, i) => {
                  const ev = raw as Record<string, unknown>;
                  const label =
                    str(ev, 'status', 'label', 'description', 'message') || 'Update';
                  const at = str(ev, 'createdAt', 'timestamp', 'at', 'date');
                  const loc = str(ev, 'location', 'city');
                  return (
                    <li key={str(ev, 'id') ?? `ev-${i}`} className="relative">
                      <span
                        className={cn(
                          'absolute -left-[1.85rem] top-1 h-3 w-3 rounded-full border-2 border-parchment',
                          i === 0 ? 'bg-saffron' : 'bg-hairline',
                        )}
                        aria-hidden
                      />
                      <p className="font-sans text-sm font-semibold text-forest">{label}</p>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 font-sans text-xs text-ink/50">
                        {at && <span>{fmtDate(at)}</span>}
                        {loc && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" aria-hidden />
                            {loc}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* Addresses */}
          {(order.shippingAddress || order.billingAddress) && (
            <section className="mkt-card grid grid-cols-1 gap-8 px-4 py-7 sm:grid-cols-2 sm:px-6 lg:px-8">
              {order.shippingAddress && (
                <div>
                  <h3 className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/50">
                    Shipping to
                  </h3>
                  <AddressBlock addr={order.shippingAddress} />
                </div>
              )}
              {order.billingAddress && (
                <div>
                  <h3 className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/50">
                    Billing to
                  </h3>
                  <AddressBlock addr={order.billingAddress} />
                </div>
              )}
            </section>
          )}
        </div>

        {/* Totals — same shared PriceSummary used by /cart and /checkout. */}
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <PriceSummary
            subtotal={order.subtotal ?? 0}
            discount={order.discount ?? 0}
            couponCode={str(order, 'couponCode') ?? str(order.coupon as Record<string, unknown> | null | undefined, 'code')}
            shipping={order.shipping ?? undefined}
            tax={order.tax ?? 0}
            total={order.total ?? order.subtotal ?? 0}
            mkt
          />

          <Link
            href="/store"
            className="mt-4 block text-center font-sans text-[11px] uppercase tracking-[0.08em] text-forest transition-colors hover:text-saffron-deep"
          >
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}

export default function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = use(params);
  const { token } = use(searchParams);

  return (
    <Layout activeTab="store">
      <div className="mkt min-h-[60vh] bg-parchment px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
        <OrderClient orderId={id} queryToken={token ?? null} />
      </div>
    </Layout>
  );
}
