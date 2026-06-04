'use client';

/**
 * /account — the signed-in customer's hub.
 *
 * Unauthenticated → an inline login / register card (storeApi via useStoreAuth).
 * Authenticated → the customer's order history (storeApi.myOrders) with links to
 * each /orders/{id}, plus a sign-out control.
 *
 * Public marketing surface → `.mkt` premium layer inside <Layout activeTab="store">.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Loader2,
  AlertCircle,
  Package,
  LogOut,
  ChevronRight,
  CheckCircle2,
  Clock,
  XCircle,
  MessageCircle,
} from 'lucide-react';
import Layout from '@/components/Layout';
import { Money, Pagination } from '@/components/store';
import { StoreCartProvider } from '@/lib/storeCart';
import { useStoreAuth } from '@/lib/storeAuth';
import { storeApi, type OrderDetail } from '@/lib/storeApi';
import { cn } from '@/lib/cn';

const PAID_STATUSES = new Set(['PAID', 'CONFIRMED', 'COMPLETED', 'CAPTURED', 'DELIVERED', 'SHIPPED']);
const FAILED_STATUSES = new Set(['FAILED', 'CANCELLED', 'CANCELED', 'PAYMENT_FAILED']);

function statusChip(order: OrderDetail) {
  const raw = (order.status || order.paymentStatus || '').toUpperCase();
  if (PAID_STATUSES.has(raw)) {
    return { Icon: CheckCircle2, tone: 'text-success', label: raw || 'Paid' };
  }
  if (FAILED_STATUSES.has(raw)) {
    return { Icon: XCircle, tone: 'text-terracotta', label: raw || 'Failed' };
  }
  return { Icon: Clock, tone: 'text-warning', label: raw || 'Pending' };
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Auth card (shown when unauthenticated) ──────────────────────────
function AuthCard() {
  const { login, register } = useStoreAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Discord OAuth is config-gated: the button is rendered ONLY when the backend
  // returns an authorize URL (it replies 404 / null when Discord is unconfigured),
  // mirroring the existing disabled-CTA / Google-OAuth gating pattern.
  const [discordUrl, setDiscordUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void storeApi.getDiscordAuthUrl().then((url) => {
      // Defense-in-depth (server config-gating is the primary control): only
      // render the CTA if the URL is genuinely Discord's authorize endpoint, so a
      // mis-set DISCORD_REDIRECT_URI / tampered resolver can never turn this into
      // an open redirect to an attacker-controlled origin.
      const safe =
        url && url.startsWith('https://discord.com/oauth2/authorize')
          ? url
          : null;
      if (active) setDiscordUrl(safe);
    });
    return () => {
      active = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login({ email: email.trim(), password });
      } else {
        await register({
          email: email.trim(),
          password,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          phone: phone.trim() || undefined,
        });
      }
      // On success the provider sets `customer`; the parent re-renders to the
      // order history. No navigation needed.
    } catch (err) {
      setError(
        (err as { message?: string })?.message ||
          (mode === 'login'
            ? 'Sign in failed. Check your email and password.'
            : 'Could not create your account. Please try again.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'mkt-input';
  const labelCls = 'font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/55';

  return (
    <div className="mkt-card mx-auto max-w-md px-5 py-9 sm:px-9">
      {/* Mode toggle — 0px corners per DESIGN.md (no rounded carve-out here). */}
      <div className="mb-7 flex rounded-none border border-hairline bg-white/50 p-1">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cn(
              'flex-1 rounded-none py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors',
              mode === m ? 'bg-forest text-parchment' : 'text-ink/55 hover:text-forest',
            )}
          >
            {m === 'login' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <h1 className="font-serif text-2xl text-forest">
        {mode === 'login' ? 'Welcome back' : 'Create your account'}
      </h1>
      <p className="mt-1 mb-6 font-sans text-sm text-ink/60">
        {mode === 'login'
          ? 'Sign in to view your order history and track shipments.'
          : 'Register to track orders and check out faster next time.'}
      </p>

      {error && (
        <div className="mb-5 flex items-start gap-2.5 border border-terracotta/30 bg-terracotta/5 px-4 py-3 text-terracotta">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="font-sans text-xs">{error}</p>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-4">
        {mode === 'register' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>First name</span>
              <input
                className={inputCls}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Last name</span>
              <input
                className={inputCls}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
              />
            </label>
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Email</span>
          <input
            className={inputCls}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Password</span>
          <input
            className={inputCls}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>

        {mode === 'register' && (
          <label className="flex flex-col gap-1.5">
            <span className={labelCls}>Phone (optional)</span>
            <input
              className={inputCls}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
          </label>
        )}

        <button type="submit" disabled={busy} className="mkt-btn mt-2 w-full disabled:opacity-60">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <span>{mode === 'login' ? 'Sign in' : 'Create account'}</span>
          )}
        </button>
      </form>

      {/* Discord OAuth — rendered only when the backend has it configured. */}
      {discordUrl && (
        <>
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-hairline" aria-hidden />
            <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/40">
              or
            </span>
            <span className="h-px flex-1 bg-hairline" aria-hidden />
          </div>
          <a href={discordUrl} className="mkt-btn-ghost w-full justify-center">
            <MessageCircle className="h-4 w-4" aria-hidden />
            <span>Continue with Discord</span>
          </a>
        </>
      )}
    </div>
  );
}

// ── Order history (shown when authenticated) ────────────────────────
function OrderHistory() {
  const { customer, logout } = useStoreAuth();
  const [orders, setOrders] = useState<OrderDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 1-based page; `totalPages` is read from the server meta envelope so the
  // account never silently shows only the first page of a long order history.
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await storeApi.myOrders({ page: p });
      setOrders(Array.isArray(res.data) ? res.data : []);
      // Prefer the server-computed totalPages; fall back to deriving it from
      // total/limit, then to 1 so the control is hidden for a single page.
      const meta = res.meta ?? {};
      const derived =
        typeof meta.totalPages === 'number'
          ? meta.totalPages
          : typeof meta.total === 'number' && typeof meta.limit === 'number' && meta.limit > 0
            ? Math.max(1, Math.ceil(meta.total / meta.limit))
            : 1;
      setTotalPages(derived);
    } catch (err) {
      setError((err as { message?: string })?.message || 'Could not load your orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const goToPage = (next: number) => {
    setPage(next);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const displayName =
    customer?.name ||
    [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') ||
    customer?.email ||
    'there';

  return (
    <div className="mx-auto max-w-screen-lg 3xl:max-w-[100rem]">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 sm:mb-10">
        <div className="min-w-0">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-saffron-deep">
            Your account
          </span>
          <h1 className="mt-2 break-words font-serif text-3xl text-forest sm:text-4xl lg:text-5xl">Hi, {displayName}</h1>
          {customer?.email && (
            <p className="mt-1 font-sans text-sm text-ink/55">{customer.email}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => logout()}
          className="mkt-btn-ghost"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          <span>Sign out</span>
        </button>
      </header>

      <h2 className="mb-4 font-sans text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/55">
        Order history
      </h2>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-ink/50">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          <span className="ml-3 font-sans text-sm uppercase tracking-[0.05em]">
            Loading orders…
          </span>
        </div>
      ) : error ? (
        <div className="mkt-card flex items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-start gap-3 text-terracotta">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p className="font-sans text-sm">{error}</p>
          </div>
          <button type="button" onClick={() => load(page)} className="mkt-btn-ghost shrink-0">
            <span>Retry</span>
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="mkt-card px-6 py-14 text-center sm:px-8">
          {/* Icon-in-circle empty-state marker — rounded-full is a true circle
              (allowed), kept consistent with /cart, CartDrawer, and the orders
              error panel which all use a circular icon badge. */}
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-saffron-glow/25 text-saffron-deep">
            <Package className="h-6 w-6" aria-hidden />
          </div>
          <h3 className="font-serif text-xl text-forest">No orders yet</h3>
          <p className="mx-auto mt-2 max-w-sm font-sans text-sm text-ink/60">
            When you place an order, it will appear here.
          </p>
          <Link href="/store" className="mkt-btn mt-7">
            <span>Browse the store</span>
          </Link>
        </div>
      ) : (
        <>
        <ul className="space-y-4">
          {orders.map((order) => {
            const { Icon, tone, label } = statusChip(order);
            const number = order.orderNumber || order.id;
            const itemCount = Array.isArray(order.items) ? order.items.length : undefined;
            return (
              <li key={order.id}>
                <Link
                  href={`/orders/${encodeURIComponent(order.id)}`}
                  className="mkt-card group flex items-center justify-between gap-3 px-4 py-5 sm:gap-4 sm:px-6"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="font-mono text-sm text-forest">{number}</span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 font-sans text-[11px] font-semibold uppercase tracking-[0.05em]',
                          tone,
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                        {label}
                      </span>
                    </div>
                    <p className="mt-1 font-sans text-xs text-ink/55">
                      {order.createdAt && <span>{fmtDate(order.createdAt)}</span>}
                      {itemCount !== undefined && (
                        <>
                          {order.createdAt ? ' · ' : ''}
                          {itemCount} item{itemCount === 1 ? '' : 's'}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Money
                      paise={order.total ?? order.subtotal ?? 0}
                      className="font-sans text-base font-bold text-forest"
                    />
                    <ChevronRight
                      className="h-5 w-5 text-ink/30 transition-colors group-hover:text-saffron-deep"
                      aria-hidden
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        {totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={goToPage}
            mkt
            className="mt-8"
          />
        )}
        </>
      )}
    </div>
  );
}

function AccountContents() {
  const { isAuthed, loading } = useStoreAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-ink/50">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <span className="ml-3 font-sans text-sm uppercase tracking-[0.05em]">Loading…</span>
      </div>
    );
  }

  return isAuthed ? <OrderHistory /> : <AuthCard />;
}

export default function AccountPage() {
  // Wrapped in <StoreCartProvider> for parity with /cart and /checkout (the
  // documented convention in storeCart.tsx). The account page does not read the
  // cart today, but the provider lets a future "reorder" CTA add items, and keeps
  // the cart mounted so a guest→customer cart merge on login can settle here too.
  return (
    <Layout activeTab="store">
      <StoreCartProvider>
        <div className="mkt min-h-[60vh] bg-parchment px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <AccountContents />
        </div>
      </StoreCartProvider>
    </Layout>
  );
}
