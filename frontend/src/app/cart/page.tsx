'use client';

/**
 * /cart — the shopping cart for the public storefront.
 *
 * Lists the current cart's line items (qty edit + remove), supports applying /
 * removing a coupon, shows the server-computed price summary (subtotal, discount,
 * tax, total — all integer paise), and routes to /checkout. Shipping address is
 * collected on the checkout step, not here.
 *
 * Wrapped in <StoreCartProvider> locally (the provider is not yet in the root
 * layout — see storeCart.tsx). Public marketing surface → `.mkt` premium layer
 * inside <Layout activeTab="store">.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShoppingBag, ArrowRight, Tag, X, Loader2, AlertCircle } from 'lucide-react';
import Layout from '@/components/Layout';
import { CartLineItem, PriceSummary } from '@/components/store';
import { StoreCartProvider, useStoreCart } from '@/lib/storeCart';
import { str, num } from '@/lib/storeHelpers';
import { cn } from '@/lib/cn';

// Must be a child of <StoreCartProvider> (mounted by the default export below) —
// this split exists so CartContents can call useStoreCart() under the provider.
function CartContents() {
  const router = useRouter();
  const {
    cart,
    loading,
    mutating,
    error,
    updateItem,
    removeItem,
    applyCoupon,
    removeCoupon,
  } = useStoreCart();

  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  // Lock the row currently mutating so only its controls disable, not all rows.
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);

  const items = Array.isArray(cart?.items) ? cart!.items : [];
  const isEmpty = !loading && items.length === 0;
  const appliedCoupon =
    (cart?.coupon as Record<string, unknown> | null | undefined) ?? null;
  const appliedCode = appliedCoupon ? str(appliedCoupon, 'code') : null;

  const handleQty = async (itemId: string, qty: number) => {
    setPendingItemId(itemId);
    try {
      await updateItem(itemId, qty);
    } catch {
      /* error surfaced via context `error` */
    } finally {
      setPendingItemId(null);
    }
  };

  const handleRemove = async (itemId: string) => {
    setPendingItemId(itemId);
    try {
      await removeItem(itemId);
    } catch {
      /* error surfaced via context `error` */
    } finally {
      setPendingItemId(null);
    }
  };

  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = couponInput.trim();
    if (!code) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      await applyCoupon(code);
      setCouponInput('');
    } catch (err) {
      setCouponError(
        (err as { message?: string })?.message || 'That coupon could not be applied.',
      );
    } finally {
      setCouponBusy(false);
    }
  };

  const handleRemoveCoupon = async () => {
    setCouponBusy(true);
    setCouponError(null);
    try {
      await removeCoupon();
    } catch (err) {
      setCouponError(
        (err as { message?: string })?.message || 'Could not remove the coupon.',
      );
    } finally {
      setCouponBusy(false);
    }
  };

  const anyUnpurchasable = items.some((raw) => {
    const item = raw as Record<string, unknown>;
    const purchasable = item.purchasable;
    const inStock = item.inStock;
    return purchasable === false || inStock === false;
  });

  return (
    <div className="mkt min-h-[60vh] bg-parchment px-6 py-14 sm:px-8 lg:py-20">
      <div className="mx-auto max-w-screen-xl">
        <header className="mb-10">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-saffron-deep">
            Your selection
          </span>
          <h1 className="mt-2 font-serif text-4xl text-forest sm:text-5xl">Shopping cart</h1>
        </header>

        {/* ── Loading ─────────────────────────────────────────── */}
        {loading && (
          <div className="flex items-center justify-center py-24 text-ink/50">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            <span className="ml-3 font-sans text-sm uppercase tracking-[0.05em]">
              Loading your cart…
            </span>
          </div>
        )}

        {/* ── Empty ───────────────────────────────────────────── */}
        {isEmpty && (
          <div className="mkt-card mx-auto max-w-xl px-8 py-16 text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-saffron-glow/25 text-saffron-deep">
              <ShoppingBag className="h-7 w-7" aria-hidden />
            </div>
            <h2 className="font-serif text-2xl text-forest">Your cart is empty</h2>
            <p className="mx-auto mt-2 max-w-sm font-sans text-sm text-ink/60">
              Browse the store for kits, components, and build-it-yourself projects.
            </p>
            <Link href="/store" className="mkt-btn mt-8">
              <span>Browse the store</span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        )}

        {/* ── Cart body ───────────────────────────────────────── */}
        {!loading && !isEmpty && (
          <>
            {error && (
              <div className="mb-6 flex items-start gap-3 border border-terracotta/30 bg-terracotta/5 px-5 py-4 text-terracotta">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <p className="font-sans text-sm">{error}</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_360px]">
              {/* Line items + coupon */}
              <div>
                <div className="mkt-card px-6 py-2 sm:px-8">
                  {items.map((raw, i) => {
                    const item = raw as Record<string, unknown>;
                    const id =
                      str(item, 'id', 'itemId', 'cartItemId') ?? `row-${i}`;
                    const qty = num(item, 'qty', 'quantity') ?? 1;
                    const unitPrice =
                      num(item, 'unitPrice', 'price', 'unitPriceSnapshot') ?? 0;
                    const lineSubtotal =
                      num(item, 'lineSubtotal', 'subtotal', 'lineTotal', 'total') ??
                      unitPrice * qty;
                    const name = str(item, 'name', 'productName', 'skuName', 'title');
                    const skuCode = str(item, 'skuCode', 'sku', 'code');
                    const imageUrl = str(
                      item,
                      'imageUrl',
                      'primaryImageUrl',
                      'image',
                      'thumbnailUrl',
                    );
                    const slug = str(item, 'slug', 'productSlug');
                    const available = num(item, 'available', 'availableQty', 'stock');
                    const purchasable = item.purchasable !== false;
                    const inStock = item.inStock !== false;

                    return (
                      <CartLineItem
                        key={id}
                        name={name}
                        skuCode={skuCode}
                        imageUrl={imageUrl}
                        href={slug ? `/store/${slug}` : undefined}
                        quantity={qty}
                        unitPrice={unitPrice}
                        lineSubtotal={lineSubtotal}
                        purchasable={purchasable}
                        inStock={inStock}
                        available={available}
                        pending={pendingItemId === id && mutating}
                        onQtyChange={(next) => handleQty(id, next)}
                        onRemove={() => handleRemove(id)}
                        mkt
                      />
                    );
                  })}
                </div>

                {/* Coupon */}
                <div className="mkt-card mt-6 px-6 py-6 sm:px-8">
                  <div className="mb-3 flex items-center gap-2 text-forest">
                    <Tag className="h-4 w-4" aria-hidden />
                    <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.1em]">
                      Promo code
                    </span>
                  </div>

                  {appliedCode ? (
                    <div className="flex items-center justify-between gap-3 rounded-full border border-success/40 bg-success/5 px-4 py-2.5">
                      <span className="font-sans text-sm font-semibold text-success">
                        {appliedCode} applied
                      </span>
                      <button
                        type="button"
                        onClick={handleRemoveCoupon}
                        disabled={couponBusy || mutating}
                        className="inline-flex items-center gap-1 font-sans text-[11px] uppercase tracking-[0.05em] text-ink/50 transition-colors hover:text-terracotta disabled:opacity-40"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                        Remove
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleApplyCoupon} className="flex flex-col gap-3 sm:flex-row">
                      <input
                        type="text"
                        value={couponInput}
                        onChange={(e) => {
                          setCouponInput(e.target.value);
                          if (couponError) setCouponError(null);
                        }}
                        placeholder="Enter code"
                        autoCapitalize="characters"
                        className="flex-1 rounded-full border border-hairline bg-white/70 px-4 py-2.5 font-sans text-sm uppercase tracking-[0.05em] text-ink outline-none transition-colors placeholder:normal-case placeholder:tracking-normal placeholder:text-ink/40 focus:border-saffron"
                      />
                      <button
                        type="submit"
                        disabled={couponBusy || mutating || !couponInput.trim()}
                        className="mkt-btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {couponBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <span>Apply</span>
                        )}
                      </button>
                    </form>
                  )}

                  {couponError && (
                    <p className="mt-2 font-sans text-xs text-terracotta">{couponError}</p>
                  )}
                </div>
              </div>

              {/* Summary */}
              <aside className="lg:sticky lg:top-28 lg:self-start">
                <PriceSummary
                  subtotal={cart?.subtotal ?? 0}
                  discount={cart?.discount ?? 0}
                  couponCode={appliedCode}
                  shipping={cart?.shipping ?? undefined}
                  tax={cart?.tax ?? 0}
                  total={cart?.total ?? cart?.subtotal ?? 0}
                  mkt
                >
                  <button
                    type="button"
                    onClick={() => router.push('/checkout')}
                    disabled={mutating || items.length === 0 || anyUnpurchasable}
                    className={cn(
                      'mkt-btn w-full disabled:cursor-not-allowed disabled:opacity-50',
                    )}
                  >
                    <span>Proceed to checkout</span>
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>

                  {anyUnpurchasable && (
                    <p className="mt-3 text-center font-sans text-xs text-terracotta">
                      Remove out-of-stock items to continue.
                    </p>
                  )}

                  <Link
                    href="/store"
                    className="mt-4 block text-center font-sans text-[11px] uppercase tracking-[0.08em] text-forest transition-colors hover:text-saffron-deep"
                  >
                    Continue shopping
                  </Link>
                </PriceSummary>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CartPage() {
  return (
    <Layout activeTab="store">
      <StoreCartProvider>
        <CartContents />
      </StoreCartProvider>
    </Layout>
  );
}
