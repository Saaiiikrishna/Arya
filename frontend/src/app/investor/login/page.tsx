'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { api } from '@/lib/api';

export default function InvestorLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.investorLogin(email, password);
      // investorLogin does NOT auto-store the token (unlike api.login), so set
      // the in-memory access token ourselves. The refresh token is delivered as
      // an HttpOnly cookie by the server; we only record the session hint so a
      // page reload knows to attempt a silent refresh.
      if (data?.accessToken) {
        api.setToken(data.accessToken);
      }
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('arya_has_session', '1');
      }
      router.push('/investor');
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout showNav={false}>
      <div className="min-h-screen bg-parchment flex items-center justify-center p-8 selection:bg-forest selection:text-parchment">
        <div className="w-full max-w-md bg-white border border-hairline p-12 animate-fade-in relative overflow-hidden">
          {/* Decorative corner */}
          <div className="absolute top-0 right-0 w-16 h-16 bg-forest/5 -mr-8 -mt-8 rotate-45 border border-forest/10" />

          <button
            type="button"
            onClick={() => router.push('/')}
            className="absolute top-8 left-8 text-ink/40 hover:text-forest transition-colors flex items-center gap-2 font-sans text-[10px] uppercase tracking-widest cursor-pointer z-20"
          >
            ← Home
          </button>

          <div className="text-center mb-12 relative z-10 pt-4">
            <div className="flex justify-center mb-6">
              <span className="text-4xl font-serif italic text-forest leading-none">Aryavartham</span>
            </div>
            <h1 className="font-serif text-2xl text-ink font-bold mb-2">
              Investor Access
            </h1>
            <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-ink/60">
              Capital Partner Portal
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-6 relative z-10">
            {error && (
              <div className="p-4 bg-terracotta/10 border border-terracotta/30 text-terracotta text-sm font-sans italic text-center">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="font-sans text-[10px] uppercase tracking-widest text-forest font-semibold" htmlFor="email">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                className="w-full border-b border-hairline bg-transparent pb-2 pt-1 font-sans text-ink focus:outline-none focus:border-forest transition-colors placeholder:text-ink/20"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="investor@example.com"
                required
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-sans text-[10px] uppercase tracking-widest text-forest font-semibold" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="w-full border-b border-hairline bg-transparent pb-2 pt-1 font-sans text-ink focus:outline-none focus:border-forest transition-colors placeholder:text-ink/20"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full bg-saffron text-parchment py-4 font-sans text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-saffron-deep transition-all border border-saffron disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              {loading ? (
                <span className="animate-pulse">Authenticating...</span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Enter Portal
                  <span className="text-terracotta-warm group-hover:translate-x-1 transition-transform">→</span>
                </span>
              )}
            </button>

            <p className="text-center font-sans text-[10px] uppercase tracking-widest text-ink/40 leading-relaxed pt-2">
              Access is granted only after your investor account has been approved.
            </p>
          </form>
        </div>
      </div>
    </Layout>
  );
}
