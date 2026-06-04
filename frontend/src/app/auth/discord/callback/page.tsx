'use client';

/**
 * /auth/discord/callback — Discord OAuth2 redirect target.
 *
 * Discord redirects here with `?code=…&state=…` on success (or
 * `?error=…&error_description=…` on cancel/denial). We verify the anti-CSRF
 * `state` is present, then exchange the code for a CUSTOMER token pair via
 * `storeApi.loginWithDiscord(code, state)` (which persists the session in its own
 * slots and where the backend re-validates + single-use-consumes the `state`),
 * merge any pre-login guest cart, hydrate the store-auth context, then redirect to
 * `/account` (or `/cart` when a guest cart was being merged).
 *
 * This route is only reachable when Discord is configured (the "Continue with
 * Discord" button on /account is hidden otherwise), but it still fails clean on a
 * cancelled / invalid / unconfigured exchange — the backend replies BadRequest.
 *
 * `useSearchParams()` must be read inside a <Suspense> boundary (Next.js 16).
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, AlertCircle } from 'lucide-react';
import { storeApi } from '@/lib/storeApi';
import { useStoreAuth } from '@/lib/storeAuth';

function DiscordCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useStoreAuth();
  const [error, setError] = useState<string | null>(null);
  // StrictMode mounts effects twice in dev; an OAuth code is single-use, so guard
  // against a duplicate exchange that would fail the second attempt.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const oauthError = searchParams.get('error');
    // Cap the provider-supplied description: React already escapes it (no XSS),
    // but a degenerate/very long value should not blow out the error UI.
    const oauthErrorDesc = searchParams.get('error_description')?.slice(0, 300);

    if (oauthError) {
      setError(
        oauthErrorDesc ||
          (oauthError === 'access_denied'
            ? 'Discord sign-in was cancelled.'
            : 'Discord sign-in failed. Please try again.'),
      );
      return;
    }
    if (!code) {
      setError('Missing authorization code from Discord. Please try again.');
      return;
    }
    // The anti-CSRF `state` Discord round-trips back is mandatory: the backend
    // requires + single-use-consumes it. A missing value means a malformed /
    // forged callback — fail clean rather than attempt an exchange that 400s.
    if (!state) {
      setError('Missing security token from Discord. Please try again.');
      return;
    }

    const run = async () => {
      try {
        // Exchange the code → token pair (persisted inside storeApi).
        await storeApi.loginWithDiscord(code, state);

        // Best-effort guest-cart merge before navigating. Mirrors storeAuth's
        // mergeGuestCart; never fail the login if the merge fails.
        const hadGuestCart = Boolean(storeApi.getCartToken());
        if (hadGuestCart) {
          try {
            await storeApi.convertGuestCart();
          } catch {
            /* non-fatal — login already succeeded */
          }
        }

        // Hydrate the store-auth context so the destination renders authenticated
        // without a full reload.
        await refresh();

        router.replace(hadGuestCart ? '/cart' : '/account');
      } catch (err) {
        setError(
          (err as { message?: string })?.message ||
            'Could not complete Discord sign-in. Please try again.',
        );
      }
    };

    void run();
  }, [searchParams, router, refresh]);

  if (error) {
    return (
      <div className="mkt-card mx-auto max-w-md px-7 py-9 text-center sm:px-9">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-none bg-terracotta/10 text-terracotta">
          <AlertCircle className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="font-serif text-2xl text-forest">Sign-in failed</h1>
        <p className="mx-auto mt-2 max-w-sm font-sans text-sm text-ink/60">{error}</p>
        <Link href="/account" className="mkt-btn mt-7">
          <span>Back to sign in</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 text-ink/55">
      <Loader2 className="h-7 w-7 animate-spin" aria-hidden />
      <span className="mt-4 font-sans text-sm uppercase tracking-[0.05em]">
        Completing Discord sign-in…
      </span>
    </div>
  );
}

export default function DiscordCallbackPage() {
  return (
    <div className="mkt flex min-h-[60vh] items-center justify-center bg-parchment px-6 py-14 sm:px-8">
      <Suspense
        fallback={
          <div className="flex flex-col items-center justify-center py-20 text-ink/55">
            <Loader2 className="h-7 w-7 animate-spin" aria-hidden />
            <span className="mt-4 font-sans text-sm uppercase tracking-[0.05em]">
              Loading…
            </span>
          </div>
        }
      >
        <DiscordCallbackContent />
      </Suspense>
    </div>
  );
}
