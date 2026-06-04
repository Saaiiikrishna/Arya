'use client';

/**
 * CartDrawer — a right-side slide-over cart for the public storefront.
 *
 * Reads its state from `useStoreCart()` (mounted at the root in app/layout.tsx),
 * so any surface that renders <Layout/> gets a working drawer driven by the
 * header cart badge. It lists the current cart's line items (qty +/- + remove via
 * the context, which proxies storeApi), shows the server-computed <PriceSummary/>
 * (all integer paise), and routes to /cart and /checkout.
 *
 * Public marketing surface → DESIGN.md §7 `mkt` premium layer (rounded + glass).
 * Rendered through a portal with a blurred glass backdrop; closes on backdrop
 * click and ESC, locks body scroll while open, and animates with motion v12.
 *
 * Item field access uses the shared defensive `str`/`num` accessors (the cart item
 * shape is a permissive bag — see storeApi `CartResponse`), mirroring /cart so the
 * two surfaces map the same fields identically.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingBag, X, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useStoreCart } from '@/lib/storeCart';
import { str, num } from '@/lib/storeHelpers';
import CartLineItem from './CartLineItem';
import PriceSummary from './PriceSummary';

export interface CartDrawerProps {
  /** Whether the drawer is open. */
  open: boolean;
  /** Close the drawer (backdrop / ESC / X / nav). */
  onClose: () => void;
}

export default function CartDrawer({ open, onClose }: CartDrawerProps) {
  const router = useRouter();
  const {
    cart,
    loading,
    mutating,
    error,
    updateItem,
    removeItem,
  } = useStoreCart();

  // Close on ESC + lock body scroll while open (mirrors Modal's behaviour).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const items = Array.isArray(cart?.items) ? cart!.items : [];
  const isEmpty = !loading && items.length === 0;
  const appliedCoupon =
    (cart?.coupon as Record<string, unknown> | null | undefined) ?? null;
  const appliedCode = appliedCoupon ? str(appliedCoupon, 'code') : null;
  const anyUnpurchasable = items.some((raw) => {
    const item = raw as Record<string, unknown>;
    return item.purchasable === false || item.inStock === false;
  });

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  // Guard the portal: `createPortal(…, document.body)` below dereferences
  // `document`, which is undefined during SSR. All hooks above run
  // unconditionally, so this early return — placed immediately before the only
  // `document` access — is safe under the Rules of Hooks and prevents the portal
  // from throwing on the server.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="mkt fixed inset-0 z-[100] flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Shopping cart"
        >
          {/* Backdrop — blurred glass overlay. */}
          <motion.div
            className="absolute inset-0 bg-ink/40 backdrop-blur-[20px]"
            onClick={onClose}
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />

          {/* Panel — slides in from the right. */}
          <motion.aside
            className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-hairline bg-parchment/95 backdrop-blur-[20px]"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-4 border-b border-hairline px-6 py-5">
              <div className="flex items-center gap-2.5 text-forest">
                <ShoppingBag className="h-5 w-5" aria-hidden />
                <h2 className="font-serif text-xl text-forest">Your cart</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close cart"
                className="text-ink/50 transition-colors hover:text-terracotta"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6">
              {loading && (
                <div className="flex items-center justify-center py-24 text-ink/50">
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                  <span className="ml-3 font-sans text-sm uppercase tracking-[0.05em]">
                    Loading…
                  </span>
                </div>
              )}

              {isEmpty && (
                <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-saffron-glow/25 text-saffron-deep">
                    <ShoppingBag className="h-7 w-7" aria-hidden />
                  </div>
                  <h3 className="font-serif text-2xl text-forest">Your cart is empty</h3>
                  <p className="mx-auto mt-2 max-w-xs font-sans text-sm text-ink/60">
                    Browse the store for kits, components, and build-it-yourself projects.
                  </p>
                  <button
                    type="button"
                    onClick={() => go('/store')}
                    className="mkt-btn mt-8"
                  >
                    <span>Browse the store</span>
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              )}

              {!loading && !isEmpty && (
                <>
                  {error && (
                    <div className="mt-4 flex items-start gap-3 border border-terracotta/30 bg-terracotta/5 px-4 py-3 text-terracotta">
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                      <p className="font-sans text-sm">{error}</p>
                    </div>
                  )}

                  <div className="py-2">
                    {items.map((raw, i) => {
                      const item = raw as Record<string, unknown>;
                      const id = str(item, 'id', 'itemId', 'cartItemId') ?? `row-${i}`;
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
                          pending={mutating}
                          onQtyChange={(next) => {
                            void updateItem(id, next).catch(() => {
                              /* surfaced via context `error` */
                            });
                          }}
                          onRemove={() => {
                            void removeItem(id).catch(() => {
                              /* surfaced via context `error` */
                            });
                          }}
                          mkt
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Footer — summary + actions (only when there's something to buy) */}
            {!loading && !isEmpty && (
              <div className="border-t border-hairline px-6 py-5">
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
                    onClick={() => go('/checkout')}
                    disabled={mutating || items.length === 0 || anyUnpurchasable}
                    className="mkt-btn w-full disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>Checkout</span>
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>

                  {anyUnpurchasable && (
                    <p className="mt-3 text-center font-sans text-xs text-terracotta">
                      Remove out-of-stock items to continue.
                    </p>
                  )}

                  <Link
                    href="/cart"
                    onClick={onClose}
                    className="mt-4 block text-center font-sans text-[11px] uppercase tracking-[0.08em] text-forest transition-colors hover:text-saffron-deep"
                  >
                    View cart
                  </Link>
                </PriceSummary>
              </div>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
