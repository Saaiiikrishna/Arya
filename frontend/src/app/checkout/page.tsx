'use client';

/**
 * /checkout — collect shipping/billing address + guest contact (or use the
 * signed-in customer), then place the order and open Razorpay.
 *
 * Flow:
 *   1. Collect a shipping address (+ optional separate billing address) and, for
 *      guests, an email + phone. Signed-in customers skip the contact fields.
 *   2. POST /store/checkout → { orderId, razorpayOrderId, amount, currency, key,
 *      guestOrderToken? }.
 *   3. Persist the guestOrderToken (guests only) so the order page can read it,
 *      load Razorpay checkout.js, and open the Razorpay modal.
 *   4. On payment success → redirect to /orders/{orderId}[?token=guestOrderToken].
 *      On dismiss/failure → restore the form so the customer can retry (the
 *      Razorpay order is reusable; capture is confirmed server-side by webhook).
 *
 * Public marketing surface → `.mkt` premium layer inside <Layout activeTab="store">.
 */

import { useMemo, useRef, useState } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, Lock, ArrowLeft } from 'lucide-react';
import Layout from '@/components/Layout';
import { PriceSummary } from '@/components/store';
import { StoreCartProvider, useStoreCart } from '@/lib/storeCart';
import { useStoreAuth } from '@/lib/storeAuth';
import { storeApi } from '@/lib/storeApi';
import { GUEST_ORDER_TOKEN_PREFIX } from '@/lib/storeHelpers';
import { cn } from '@/lib/cn';

const RAZORPAY_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

interface AddressForm {
  fullName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
}

const EMPTY_ADDRESS: AddressForm = {
  fullName: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'India',
  phone: '',
};

// Minimal Razorpay typings — the SDK attaches a constructor to window at runtime.
interface RazorpaySuccess {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
}
interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name?: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (response: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void };
}
interface RazorpayInstance {
  open: () => void;
  on: (event: string, cb: (resp: { error?: { description?: string } }) => void) => void;
}
type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;
declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

function toAddressPayload(a: AddressForm): Record<string, unknown> {
  return {
    fullName: a.fullName.trim(),
    line1: a.line1.trim(),
    line2: a.line2.trim() || undefined,
    city: a.city.trim(),
    state: a.state.trim(),
    postalCode: a.postalCode.trim(),
    country: a.country.trim(),
    phone: a.phone.trim() || undefined,
  };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
  autoComplete,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  className?: string;
}) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/55">
        {label}
        {required && <span className="text-terracotta"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        className="mkt-input"
      />
    </label>
  );
}

function AddressFields({
  value,
  onChange,
}: {
  value: AddressForm;
  onChange: (next: AddressForm) => void;
}) {
  const set = (patch: Partial<AddressForm>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field
        label="Full name"
        value={value.fullName}
        onChange={(v) => set({ fullName: v })}
        required
        autoComplete="name"
        className="sm:col-span-2"
      />
      <Field
        label="Address line 1"
        value={value.line1}
        onChange={(v) => set({ line1: v })}
        required
        autoComplete="address-line1"
        className="sm:col-span-2"
      />
      <Field
        label="Address line 2"
        value={value.line2}
        onChange={(v) => set({ line2: v })}
        autoComplete="address-line2"
        className="sm:col-span-2"
      />
      <Field label="City" value={value.city} onChange={(v) => set({ city: v })} required autoComplete="address-level2" />
      <Field label="State" value={value.state} onChange={(v) => set({ state: v })} required autoComplete="address-level1" />
      <Field
        label="Postal code"
        value={value.postalCode}
        onChange={(v) => set({ postalCode: v })}
        required
        autoComplete="postal-code"
      />
      <Field label="Country" value={value.country} onChange={(v) => set({ country: v })} required autoComplete="country-name" />
      <Field
        label="Phone (for delivery)"
        value={value.phone}
        onChange={(v) => set({ phone: v })}
        type="tel"
        autoComplete="tel"
        className="sm:col-span-2"
      />
    </div>
  );
}

// Must be a child of <StoreCartProvider> (mounted by the default export below) —
// this split exists so CheckoutContents can call useStoreCart() under the provider.
function CheckoutContents() {
  const router = useRouter();
  const { cart, loading, refresh, clear } = useStoreCart();
  const { customer, isAuthed, loading: authLoading } = useStoreAuth();

  const [shipping, setShipping] = useState<AddressForm>(EMPTY_ADDRESS);
  const [billing, setBilling] = useState<AddressForm>(EMPTY_ADDRESS);
  const [billingSame, setBillingSame] = useState(true);

  // Guest contact (signed-in customers don't need these).
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');

  const [scriptReady, setScriptReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  // Guard against double-open if the script `onLoad` fires after a click.
  const placedRef = useRef(false);
  // Tracks which customer id we've already prefilled the shipping name from, so
  // the prefill runs once per customer and never clobbers the user's own edits.
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);

  const items = Array.isArray(cart?.items) ? cart!.items : [];
  const cartEmpty = !loading && items.length === 0;

  // Prefill the shipping name/phone from a signed-in customer the first time that
  // customer appears. This is the React-recommended "adjust state while rendering"
  // pattern (https://react.dev/learn/you-might-not-need-an-effect) — no effect, no
  // cascading-render lint warning. It only fills empty fields, so it never fights a
  // user who has already started typing.
  if (customer && customer.id !== prefilledFor) {
    setPrefilledFor(customer.id);
    setShipping((s) =>
      s.fullName
        ? s
        : {
            ...s,
            fullName:
              customer.name ||
              [customer.firstName, customer.lastName].filter(Boolean).join(' ') ||
              '',
            phone: s.phone || customer.phone || '',
          },
    );
  }

  const validate = (): string | null => {
    const s = shipping;
    if (!s.fullName.trim()) return 'Please enter the recipient’s full name.';
    if (!s.line1.trim()) return 'Please enter the shipping address.';
    if (!s.city.trim()) return 'Please enter the city.';
    if (!s.state.trim()) return 'Please enter the state.';
    if (!s.postalCode.trim()) return 'Please enter the postal code.';
    if (!s.country.trim()) return 'Please enter the country.';
    if (!isAuthed) {
      if (!guestEmail.trim()) return 'Please enter your email for order updates.';
      // Lightweight email shape check; the backend is authoritative.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail.trim()))
        return 'Please enter a valid email address.';
      if (!guestPhone.trim()) return 'Please enter a contact phone number.';
    }
    if (!billingSame) {
      const b = billing;
      if (!b.fullName.trim() || !b.line1.trim() || !b.city.trim() || !b.state.trim() || !b.postalCode.trim())
        return 'Please complete the billing address or use the shipping address.';
    }
    return null;
  };

  const persistGuestOrderToken = (orderId: string, token: string) => {
    try {
      sessionStorage.setItem(`${GUEST_ORDER_TOKEN_PREFIX}${orderId}`, token);
    } catch {
      /* sessionStorage may be unavailable (private mode) — the query string still carries it */
    }
  };

  const openRazorpay = (
    res: {
      orderId: string;
      razorpayOrderId: string;
      amount: number;
      currency: string;
      key: string;
      guestOrderToken?: string;
    },
  ) => {
    if (!window.Razorpay) {
      setError('Payment library failed to load. Please refresh and try again.');
      setPaying(false);
      return;
    }
    const guestToken = res.guestOrderToken;
    const successUrl =
      `/orders/${encodeURIComponent(res.orderId)}` +
      (guestToken ? `?token=${encodeURIComponent(guestToken)}` : '');

    const rzp = new window.Razorpay({
      key: res.key,
      order_id: res.razorpayOrderId,
      amount: res.amount,
      currency: res.currency,
      name: 'Aryavartham',
      description: 'Store order',
      prefill: {
        name: shipping.fullName || customer?.name || '',
        email: isAuthed ? customer?.email : guestEmail,
        contact: shipping.phone || guestPhone || customer?.phone || '',
      },
      theme: { color: '#E85D04' },
      // The `_resp` callback argument ({ razorpay_payment_id, razorpay_order_id,
      // razorpay_signature }) is intentionally IGNORED. Per COMMERCE_ARCHITECTURE
      // §8.1 the Razorpay webhook is the ONLY authoritative capture path — the
      // frontend must NOT forward these fields to any server-side capture endpoint.
      // We name the param `_resp` (rather than dropping it) so a future reader sees
      // the discard is deliberate and does not "fix" it into a client-side capture.
      handler: (resp: RazorpaySuccess) => {
        // Explicitly discard the success payload ({ razorpay_payment_id, ... }):
        // there is no client-side capture step (see comment above). The `void`
        // makes the discard intentional and keeps lint quiet about the unused arg.
        void resp;
        // Payment authorised. Capture is confirmed server-side via webhook, so the
        // order page polls PENDING → PAID. Clear the local cart and route there.
        clear();
        router.push(successUrl);
      },
      modal: {
        ondismiss: () => {
          // Customer closed the Razorpay sheet without paying — let them retry.
          setPaying(false);
          placedRef.current = false;
          setError('Payment was not completed. Your order is saved — you can try paying again.');
        },
      },
    });

    rzp.on('payment.failed', (resp) => {
      setPaying(false);
      placedRef.current = false;
      setError(
        resp?.error?.description || 'Payment failed. Please try again or use a different method.',
      );
    });

    rzp.open();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (placedRef.current) return;

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!scriptReady) {
      setError('Payment is still loading. Please wait a moment and try again.');
      return;
    }

    setSubmitting(true);
    setError(null);
    placedRef.current = true;

    try {
      const body: {
        shippingAddress: Record<string, unknown>;
        billingAddress?: Record<string, unknown>;
        guestEmail?: string;
        guestPhone?: string;
      } = {
        shippingAddress: toAddressPayload(shipping),
        billingAddress: billingSame ? undefined : toAddressPayload(billing),
      };
      if (!isAuthed) {
        body.guestEmail = guestEmail.trim();
        body.guestPhone = guestPhone.trim();
      }

      const res = await storeApi.checkout(body);

      if (res.guestOrderToken) {
        persistGuestOrderToken(res.orderId, res.guestOrderToken);
      }

      setSubmitting(false);
      setPaying(true);
      openRazorpay(res);
    } catch (err) {
      setSubmitting(false);
      placedRef.current = false;
      setError(
        (err as { message?: string })?.message ||
          'We could not place your order. Please review your cart and try again.',
      );
      // Re-sync the cart in case the backend rejected for a stock/total change.
      void refresh();
    }
  };

  const busy = submitting || paying;

  const total = cart?.total ?? cart?.subtotal ?? 0;
  const summary = useMemo(
    () => ({
      subtotal: cart?.subtotal ?? 0,
      discount: cart?.discount ?? 0,
      shipping: cart?.shipping ?? undefined,
      tax: cart?.tax ?? 0,
      total,
      couponCode:
        ((cart?.coupon as Record<string, unknown> | null | undefined)?.code as string | undefined) ??
        null,
    }),
    [cart, total],
  );

  return (
    <div className="mkt min-h-[60vh] bg-parchment px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
      {/* Razorpay checkout.js — load once, lazily, on this page only. */}
      <Script
        src={RAZORPAY_SRC}
        strategy="lazyOnload"
        onLoad={() => setScriptReady(true)}
        onError={() =>
          setError('Could not load the payment library. Check your connection and refresh.')
        }
      />

      <div className="mx-auto max-w-screen-xl 3xl:max-w-[100rem]">
        <header className="mb-8 sm:mb-10">
          <Link
            href="/cart"
            className="mb-4 inline-flex items-center gap-1.5 font-sans text-[11px] uppercase tracking-[0.08em] text-forest transition-colors hover:text-saffron-deep"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to cart
          </Link>
          <h1 className="font-serif text-3xl text-forest sm:text-4xl lg:text-5xl">Checkout</h1>
        </header>

        {loading || authLoading ? (
          <div className="flex items-center justify-center py-24 text-ink/50">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            <span className="ml-3 font-sans text-sm uppercase tracking-[0.05em]">Loading…</span>
          </div>
        ) : cartEmpty ? (
          <div className="mkt-card mx-auto max-w-xl px-6 py-16 text-center sm:px-8">
            <h2 className="font-serif text-2xl text-forest">Your cart is empty</h2>
            <p className="mx-auto mt-2 max-w-sm font-sans text-sm text-ink/60">
              Add something to your cart before checking out.
            </p>
            <Link href="/store" className="mkt-btn mt-8">
              <span>Browse the store</span>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_22rem] lg:gap-10 xl:grid-cols-[1fr_24rem]">
            <div className="min-w-0 space-y-6">
              {error && (
                <div className="flex items-start gap-3 border border-terracotta/30 bg-terracotta/5 px-5 py-4 text-terracotta">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                  <p className="font-sans text-sm">{error}</p>
                </div>
              )}

              {/* Contact — guests only */}
              {!isAuthed && (
                <section className="mkt-card px-4 py-7 sm:px-6 lg:px-8">
                  <h2 className="mb-1 font-serif text-xl text-forest">Contact</h2>
                  <p className="mb-5 font-sans text-xs text-ink/55">
                    We’ll send order updates here.{' '}
                    <Link href="/account" className="text-saffron-deep hover:underline">
                      Sign in
                    </Link>{' '}
                    to track orders in your account.
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      label="Email"
                      value={guestEmail}
                      onChange={setGuestEmail}
                      type="email"
                      required
                      autoComplete="email"
                    />
                    <Field
                      label="Phone"
                      value={guestPhone}
                      onChange={setGuestPhone}
                      type="tel"
                      required
                      autoComplete="tel"
                    />
                  </div>
                </section>
              )}

              {isAuthed && customer && (
                <section className="mkt-card flex items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
                  <div>
                    <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/55">
                      Signed in as
                    </span>
                    <p className="mt-0.5 font-sans text-sm text-forest">{customer.email}</p>
                  </div>
                </section>
              )}

              {/* Shipping address */}
              <section className="mkt-card px-4 py-7 sm:px-6 lg:px-8">
                <h2 className="mb-5 font-serif text-xl text-forest">Shipping address</h2>
                <AddressFields value={shipping} onChange={setShipping} />
              </section>

              {/* Billing address */}
              <section className="mkt-card px-4 py-7 sm:px-6 lg:px-8">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h2 className="font-serif text-xl text-forest">Billing address</h2>
                </div>
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={billingSame}
                    onChange={(e) => setBillingSame(e.target.checked)}
                    className="h-4 w-4 accent-saffron"
                  />
                  <span className="font-sans text-sm text-ink/70">Same as shipping address</span>
                </label>
                {!billingSame && (
                  <div className="mt-5">
                    <AddressFields value={billing} onChange={setBilling} />
                  </div>
                )}
              </section>
            </div>

            {/* Summary + pay */}
            <aside className="min-w-0 lg:sticky lg:top-28 lg:self-start">
              <PriceSummary
                subtotal={summary.subtotal}
                discount={summary.discount}
                couponCode={summary.couponCode}
                shipping={summary.shipping}
                tax={summary.tax}
                total={summary.total}
                mkt
              >
                <button
                  type="submit"
                  disabled={busy}
                  className="mkt-btn w-full disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      <span>{paying ? 'Awaiting payment…' : 'Placing order…'}</span>
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4" aria-hidden />
                      <span>Pay securely</span>
                    </>
                  )}
                </button>
                <p className="mt-3 flex items-center justify-center gap-1.5 text-center font-sans text-[11px] text-ink/45">
                  <Lock className="h-3 w-3" aria-hidden />
                  Payments processed securely by Razorpay
                </p>
              </PriceSummary>
            </aside>
          </form>
        )}
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Layout activeTab="store">
      <StoreCartProvider>
        <CheckoutContents />
      </StoreCartProvider>
    </Layout>
  );
}
