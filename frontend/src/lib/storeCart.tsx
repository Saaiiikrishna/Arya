'use client';

/**
 * Lightweight store-cart context.
 *
 * Owns the customer/guest cart state for the public storefront and wraps the
 * relevant `storeApi` cart methods so pages never touch the client directly. It
 * is deliberately thin: every mutation calls `storeApi`, stores the recomputed
 * `CartResponse` it returns (the backend recomputes totals on every cart write),
 * and exposes a derived `count` for a future header badge.
 *
 * GUEST vs CUSTOMER
 * -----------------
 * Both identities are handled transparently by `storeApi`: every cart call sends
 * the customer `Authorization` header (if a session exists) AND the guest
 * `X-Cart-Token` header (if one exists); the backend's `CartAccessGuard` picks
 * whichever is present (customer wins when both are sent). The only place we must
 * intervene is the FIRST add for a brand-new visitor with neither identity — we
 * mint a guest cart (`storeApi.createCart()` persists its `X-Cart-Token` in
 * localStorage) before adding the item.
 *
 * MOUNTING (note — not wired yet)
 * -------------------------------
 * This provider is intentionally NOT yet added to the root layout or `Layout.tsx`
 * (per the task brief — wiring the header badge is a follow-up). Each store page
 * that needs the cart should be wrapped in `<StoreCartProvider>` for now, OR the
 * provider can be hoisted into the root `app/layout.tsx` alongside
 * `StoreAuthProvider` later. Calling `useStoreCart()` outside a provider throws
 * fail-fast so a missing mount is caught immediately.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { storeApi, type CartResponse } from '@/lib/storeApi';
import { ApiError } from '@/lib/api';

interface StoreCartContextType {
  /** Latest cart snapshot with server-computed totals (integer paise), or null. */
  cart: CartResponse | null;
  /** Total quantity across all line items (for a header badge). */
  count: number;
  /** First load / hydration in flight. */
  loading: boolean;
  /** A mutation (add/update/remove/coupon) is in flight. */
  mutating: boolean;
  /** Last error message from a cart operation, or null. */
  error: string | null;
  /** Re-fetch the current cart (no-op silently if no cart exists yet). */
  refresh: () => Promise<void>;
  /** Add a SKU; mints a guest cart first if the visitor has none. */
  addItem: (skuId: string, qty?: number) => Promise<void>;
  /** Change a line's quantity. */
  updateItem: (itemId: string, qty: number) => Promise<void>;
  /** Remove a line. */
  removeItem: (itemId: string) => Promise<void>;
  /** Apply a coupon code. */
  applyCoupon: (code: string) => Promise<void>;
  /** Remove the applied coupon. */
  removeCoupon: () => Promise<void>;
  /** Drop the in-memory cart (e.g. after a successful checkout). */
  clear: () => void;
}

const StoreCartContext = createContext<StoreCartContextType | null>(null);

/** Sum line quantities defensively across the permissive item shape. */
export function cartItemCount(cart: CartResponse | null): number {
  if (!cart || !Array.isArray(cart.items)) return 0;
  return cart.items.reduce((sum, raw) => {
    const item = raw as Record<string, unknown>;
    const q = item.qty ?? item.quantity;
    const n = typeof q === 'number' ? q : Number(q);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

export function StoreCartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a setState after unmount during the initial hydrate.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Hydrate on mount: only fetch if SOME identity exists (a guest cart token in
  // localStorage or a live customer session). A brand-new visitor has neither —
  // skip the call so we never 401/404 on an empty storefront load.
  const hydrate = useCallback(async () => {
    const hasGuestCart = !!storeApi.getCartToken();
    const hasCustomer = !!storeApi.getCustomerToken();
    if (!hasGuestCart && !hasCustomer) {
      if (mounted.current) setLoading(false);
      return;
    }
    try {
      const res = await storeApi.getCart();
      if (mounted.current) setCart(res);
    } catch (err) {
      // A dead/expired guest cart (404/410) just means "no cart" — start fresh,
      // don't surface it as an error on a passive page load.
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        storeApi.clearCartToken();
        if (mounted.current) setCart(null);
      } else if (mounted.current) {
        setError(messageOf(err, 'Could not load your cart.'));
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const refresh = useCallback(async () => {
    const hasGuestCart = !!storeApi.getCartToken();
    const hasCustomer = !!storeApi.getCustomerToken();
    if (!hasGuestCart && !hasCustomer) {
      setCart(null);
      return;
    }
    try {
      const res = await storeApi.getCart();
      setCart(res);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        storeApi.clearCartToken();
        setCart(null);
      } else {
        setError(messageOf(err, 'Could not refresh your cart.'));
      }
    }
  }, []);

  // Shared wrapper for every mutation: flips the `mutating` flag, clears prior
  // error, stores the recomputed cart, and re-throws so callers can react (e.g.
  // show a per-action toast / inline coupon error).
  const runMutation = useCallback(
    async (fn: () => Promise<CartResponse>) => {
      setMutating(true);
      setError(null);
      try {
        const res = await fn();
        setCart(res);
      } catch (err) {
        setError(messageOf(err, 'Something went wrong. Please try again.'));
        throw err;
      } finally {
        setMutating(false);
      }
    },
    [],
  );

  const addItem = useCallback(
    async (skuId: string, qty = 1) => {
      await runMutation(async () => {
        // First add for a visitor with no identity at all → mint a guest cart so
        // the X-Cart-Token header exists for the subsequent add. A signed-in
        // customer already has a server-side cart, so skip minting for them.
        if (!storeApi.getCartToken() && !storeApi.getCustomerToken()) {
          await storeApi.createCart();
        }
        return storeApi.addCartItem({ skuId, qty });
      });
    },
    [runMutation],
  );

  const updateItem = useCallback(
    async (itemId: string, qty: number) => {
      await runMutation(() => storeApi.updateCartItem(itemId, { qty }));
    },
    [runMutation],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      await runMutation(() => storeApi.removeCartItem(itemId));
    },
    [runMutation],
  );

  const applyCoupon = useCallback(
    async (code: string) => {
      await runMutation(() => storeApi.applyCoupon({ code }));
    },
    [runMutation],
  );

  const removeCoupon = useCallback(async () => {
    await runMutation(() => storeApi.removeCoupon());
  }, [runMutation]);

  const clear = useCallback(() => {
    setCart(null);
    setError(null);
  }, []);

  return (
    <StoreCartContext.Provider
      value={{
        cart,
        count: cartItemCount(cart),
        loading,
        mutating,
        error,
        refresh,
        addItem,
        updateItem,
        removeItem,
        applyCoupon,
        removeCoupon,
        clear,
      }}
    >
      {children}
    </StoreCartContext.Provider>
  );
}

/**
 * Access the store cart context. MUST be called inside a `<StoreCartProvider>`;
 * outside one this throws fail-fast so a missing mount is obvious immediately.
 */
export function useStoreCart(): StoreCartContextType {
  const ctx = useContext(StoreCartContext);
  if (!ctx) {
    throw new Error('useStoreCart must be used within a <StoreCartProvider>');
  }
  return ctx;
}
