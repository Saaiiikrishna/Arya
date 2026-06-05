'use client';

/**
 * Store customer identity context — a SEPARATE auth surface from the platform
 * `useAuth()` (src/lib/auth.tsx). The marketing store (/store, /articles,
 * checkout) has its own customer accounts, its own JWT pair, and its own token
 * slots (handled inside storeApi: in-memory access token + an HttpOnly
 * `arya_store_refresh` cookie + a non-sensitive `arya_store_has_session` hint).
 * The platform admin/applicant identity in `auth.tsx` is untouched — the two can
 * be authenticated independently in the same tab.
 *
 * Mirrors the hydration pattern in `auth.tsx`: on mount, if there is no
 * in-memory access token, attempt a silent refresh (the HttpOnly cookie carries
 * the refresh token); a failed refresh clears any stale credential. Once a token
 * is present (or freshly minted via login/register), `meCustomer()` hydrates the
 * profile.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { storeApi } from '@/lib/storeApi';
import { ApiError } from '@/lib/api';

export interface StoreCustomer {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
  emailVerified?: boolean;
  createdAt?: string;
}

export interface StoreLoginInput {
  email: string;
  password: string;
}

export interface StoreRegisterInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
}

interface StoreAuthContextType {
  customer: StoreCustomer | null;
  isAuthed: boolean;
  loading: boolean;
  login: (input: StoreLoginInput) => Promise<StoreCustomer>;
  register: (input: StoreRegisterInput) => Promise<StoreCustomer>;
  logout: () => Promise<void>;
  /** Re-fetch the customer profile (e.g. after a profile edit). */
  refresh: () => Promise<void>;
}

const StoreAuthContext = createContext<StoreAuthContextType>({
  customer: null,
  isAuthed: false,
  loading: true,
  login: async () => {
    throw new Error('StoreAuthProvider not mounted');
  },
  register: async () => {
    throw new Error('StoreAuthProvider not mounted');
  },
  logout: async () => {
    throw new Error('StoreAuthProvider not mounted');
  },
  refresh: async () => {
    throw new Error('StoreAuthProvider not mounted');
  },
});

/**
 * Normalise whatever shape the customer auth endpoints return into a flat
 * StoreCustomer. The backend may nest the record under `customer`/`user` (as the
 * platform `login` nests under `admin`) or return it flat; handle both so the
 * provider does not break if the contract wraps the profile.
 */
function pickCustomer(payload: unknown): StoreCustomer | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const candidate =
    (obj.customer as Record<string, unknown> | undefined) ??
    (obj.user as Record<string, unknown> | undefined) ??
    obj;
  if (!candidate || typeof candidate !== 'object') return null;
  const id = candidate.id;
  const email = candidate.email;
  if (typeof id !== 'string' || typeof email !== 'string') return null;
  return candidate as unknown as StoreCustomer;
}

export function StoreAuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<StoreCustomer | null>(null);
  const [loading, setLoading] = useState(true);

  const hydrate = useCallback(async () => {
    try {
      // Access token is in-memory only (inside storeApi); if it is gone after a
      // reload, try a silent refresh — the HttpOnly `arya_store_refresh` cookie
      // carries the refresh token, gated by the `arya_store_has_session` hint.
      if (!storeApi.getCustomerToken()) {
        const refreshed = await storeApi.refreshCustomer().catch(() => null);
        if (!refreshed) {
          storeApi.clearCustomerToken();
          setCustomer(null);
          return;
        }
      }
      const me = await storeApi.meCustomer();
      setCustomer(pickCustomer(me));
    } catch (err) {
      // Only an auth failure (401) means the credential is actually dead. A
      // transient failure (network blip / 5xx) must NOT destroy a possibly-valid,
      // freshly-refreshed token — leave it in place so the next call can succeed.
      if (err instanceof ApiError && err.status === 401) {
        storeApi.clearCustomerToken();
      }
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // After a fresh authentication, merge any guest cart that existed before login
  // into the now-authenticated customer's server-side cart, then drop the guest
  // token (convertGuestCart clears it on success). Without this, items added as a
  // guest are silently abandoned on login and the guest token lingers in
  // localStorage (data-integrity gap). It is best-effort and must NEVER fail the
  // login: the customer is already authenticated by the time we reach here.
  const mergeGuestCart = useCallback(async () => {
    if (!storeApi.getCartToken()) return;
    try {
      await storeApi.convertGuestCart();
    } catch {
      /* non-fatal — login already succeeded; a failed merge just leaves the guest cart behind */
    }
  }, []);

  const login = useCallback(
    async (input: StoreLoginInput): Promise<StoreCustomer> => {
      setLoading(true);
      try {
        // storeApi.loginCustomer applies the session internally (in-memory access
        // token + session hint; refresh token arrives as an HttpOnly cookie),
        // matching how api.login handles the platform pair.
        const res = await storeApi.loginCustomer(input);
        const next = pickCustomer(res) ?? pickCustomer(await storeApi.meCustomer());
        // Merge the guest cart while the session is live (before returning).
        await mergeGuestCart();
        setCustomer(next);
        if (!next) throw new Error('Login succeeded but no customer profile was returned');
        return next;
      } finally {
        // Always clear the loading flag — even if loginCustomer / meCustomer throws
        // (network error, bad credentials), so the UI never sticks in a spinner.
        setLoading(false);
      }
    },
    [mergeGuestCart],
  );

  const register = useCallback(
    async (input: StoreRegisterInput): Promise<StoreCustomer> => {
      setLoading(true);
      try {
        const res = await storeApi.registerCustomer(input);
        const next = pickCustomer(res) ?? pickCustomer(await storeApi.meCustomer());
        await mergeGuestCart();
        setCustomer(next);
        if (!next) throw new Error('Registration succeeded but no customer profile was returned');
        return next;
      } finally {
        setLoading(false);
      }
    },
    [mergeGuestCart],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      // Fire the server-side revocation; never block local logout on the network.
      await storeApi.logoutCustomer();
    } catch {
      // ignore — local state is cleared regardless
    } finally {
      storeApi.clearCustomerToken();
      setCustomer(null);
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const me = await storeApi.meCustomer();
      setCustomer(pickCustomer(me));
    } catch (err) {
      // Mirror hydrate: only a 401 means the session is dead. Transient failures
      // must not wipe an otherwise-valid token.
      if (err instanceof ApiError && err.status === 401) {
        storeApi.clearCustomerToken();
        setCustomer(null);
      }
    }
  }, []);

  return (
    <StoreAuthContext.Provider
      value={{
        customer,
        isAuthed: !!customer,
        loading,
        login,
        register,
        logout,
        refresh,
      }}
    >
      {children}
    </StoreAuthContext.Provider>
  );
}

/**
 * Access the store customer identity context. MUST be called inside a
 * `<StoreAuthProvider>` (mounted in the root layout); outside a provider the
 * default context's `login`/`register`/`logout`/`refresh` throw fail-fast.
 */
export function useStoreAuth() {
  return useContext(StoreAuthContext);
}
