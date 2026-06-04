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
 * MOUNTING
 * --------
 * This provider is mounted at the ROOT (`app/layout.tsx`) alongside
 * `StoreAuthProvider`, so the header cart badge + `<CartDrawer/>` in `Layout.tsx`
 * can read the count and drive the drawer app-wide. Store pages that wrap their
 * own `<StoreCartProvider>` (e.g. /cart) still work — nested providers are
 * independent React contexts, so a page-local provider simply shadows the root
 * one for its subtree. Calling `useStoreCart()` outside any provider throws
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
  /** Whether the slide-over cart drawer is open (header badge ↔ <CartDrawer/>). */
  isOpen: boolean;
  /** Open the slide-over cart drawer. */
  openCart: () => void;
  /** Close the slide-over cart drawer. */
  closeCart: () => void;
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
  // Ref mirror of `mutating` so callbacks (e.g. openCart) can read the latest
  // in-flight status without taking `mutating` as a dependency (which would
  // re-create them on every mutation toggle).
  const mutatingRef = useRef(false);
  // Monotonic request-sequence token. EVERY cart write (refresh OR mutation)
  // increments it and captures the new value; a refresh only commits its resolved
  // response if its captured token is still the latest one. This prevents a
  // refresh() that was already in flight when a mutation started (or a second,
  // newer refresh) from resolving LATER and overwriting the authoritative
  // post-mutation cart with a stale snapshot. It strengthens `mutatingRef`, which
  // only blocks NEW refreshes from STARTING during a mutation but cannot cancel one
  // that began before the mutation did.
  const reqSeq = useRef(0);
  const [error, setError] = useState<string | null>(null);
  // Slide-over drawer visibility — owned here (not the header button) so the
  // badge in <Layout/> and the <CartDrawer/> portal share one source of truth.
  const [isOpen, setIsOpen] = useState(false);
  // Guards against a setState after unmount during the initial hydrate.
  // Initialised to true at the `useRef` call; the effect only flips it to false
  // on unmount (re-asserting true here would be a no-op).
  const mounted = useRef(true);

  useEffect(() => {
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
    // Claim a sequence token for THIS refresh up front, before any await, so a
    // mutation (or newer refresh) that starts while our getCart() is in flight
    // bumps reqSeq past `token` and causes us to discard our now-stale result.
    const token = ++reqSeq.current;
    const isCurrent = () => token === reqSeq.current;
    if (!hasGuestCart && !hasCustomer) {
      if (isCurrent()) setCart(null);
      return;
    }
    try {
      const res = await storeApi.getCart();
      // A mutation or a newer refresh superseded us while awaiting — drop this
      // stale snapshot rather than clobber the authoritative current cart.
      if (!isCurrent()) return;
      setCart(res);
      setError(null);
    } catch (err) {
      // Only act on the error if we are still the latest request: a superseding
      // mutation has already set the correct cart/error state.
      if (!isCurrent()) return;
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
      mutatingRef.current = true;
      setMutating(true);
      setError(null);
      // Bump the sequence token: any refresh already in flight now holds an older
      // token, so its eventual resolution will be discarded and cannot overwrite
      // this mutation's authoritative result.
      ++reqSeq.current;
      try {
        const res = await fn();
        setCart(res);
      } catch (err) {
        setError(messageOf(err, 'Something went wrong. Please try again.'));
        throw err;
      } finally {
        // Re-assert this mutation as the latest writer REGARDLESS of success/failure.
        // A refresh kicked off WHILE fn() was awaiting claimed a token equal to the
        // current reqSeq; bumping here (not only on the success path) guarantees that
        // refresh is invalidated even when fn() rejects — otherwise its stale snapshot
        // would resolve later and clobber this mutation's error/cart state. Must run
        // before clearing `mutating` so any refresh that starts after this still sees
        // a newer token than its own.
        ++reqSeq.current;
        mutatingRef.current = false;
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
    setIsOpen(false);
  }, []);

  const openCart = useCallback(() => {
    setIsOpen(true);
    // Pull the freshest server-computed totals when the drawer opens; refresh is
    // a silent no-op when the visitor has no cart identity yet. Skip it while a
    // mutation is in flight: a concurrent getCart() would race the mutation's own
    // setCart(res) and could clobber the freshly-mutated cart (stale write). The
    // in-flight mutation already commits the recomputed cart on completion.
    if (!mutatingRef.current) {
      void refresh();
    }
  }, [refresh]);

  const closeCart = useCallback(() => {
    setIsOpen(false);
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
        isOpen,
        openCart,
        closeCart,
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
