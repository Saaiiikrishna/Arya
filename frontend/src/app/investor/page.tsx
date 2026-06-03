'use client';

import { useState, useEffect, useCallback, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { api } from '@/lib/api';

interface Investor {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  firm?: string | null;
  bio?: string | null;
  linkedIn?: string | null;
  interests?: string[] | null;
  avatarUrl?: string | null;
}

interface Showcase {
  id: string;
  teamId: string;
  pitchSummary: string;
  mvpDemoUrl?: string | null;
  metrics?: Record<string, any> | null;
  createdAt: string;
}

interface MeetingRequest {
  id: string;
  showcaseId: string;
  status: 'REQUESTED' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED';
  message?: string | null;
  scheduledAt?: string | null;
  createdAt: string;
  showcase?: Showcase | null;
}

const STATUS_STYLES: Record<string, string> = {
  REQUESTED: 'bg-saffron-glow/20 text-saffron-deep border-saffron/40',
  ACCEPTED: 'bg-forest/10 text-forest border-forest/30',
  DECLINED: 'bg-terracotta/10 text-terracotta border-terracotta/30',
  COMPLETED: 'bg-ink/10 text-ink/70 border-ink/20',
};

export default function InvestorDashboard() {
  const router = useRouter();

  const [investor, setInvestor] = useState<Investor | null>(null);
  const [showcases, setShowcases] = useState<Showcase[]>([]);
  const [requests, setRequests] = useState<MeetingRequest[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Meeting-request modal state
  const [selected, setSelected] = useState<Showcase | null>(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Access token lives in memory only — after a reload/navigation attempt a
      // silent refresh before the gated call (mirrors auth.tsx checkAuth).
      if (!api.getToken()) {
        const refreshed = await api.refreshAccessToken();
        if (!refreshed) {
          router.replace('/investor/login');
          return;
        }
      }

      // Gate: must be an authenticated, approved investor.
      const me = await api.getInvestorMe();
      setInvestor(me);

      // Load showcases + own meeting requests in parallel; tolerate individual failures.
      const [showcaseRes, requestRes] = await Promise.allSettled([
        api.getInvestorShowcases(),
        api.getMyMeetingRequests(),
      ]);

      if (showcaseRes.status === 'fulfilled') {
        setShowcases(Array.isArray(showcaseRes.value) ? showcaseRes.value : []);
      }
      if (requestRes.status === 'fulfilled') {
        setRequests(Array.isArray(requestRes.value) ? requestRes.value : []);
      }
    } catch (err: any) {
      const status = err?.status;
      if (status === 401 || status === 403) {
        router.replace('/investor/login');
        return;
      }
      setError(err?.message || 'Failed to load your investor portal.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const refreshRequests = useCallback(async () => {
    try {
      const data = await api.getMyMeetingRequests();
      setRequests(Array.isArray(data) ? data : []);
    } catch {
      // Non-fatal: the create succeeded; the list will refresh on next load.
    }
  }, []);

  const handleRequestMeeting = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.requestMeeting({
        showcaseId: selected.id,
        message: message.trim() || undefined,
      });
      setSelected(null);
      setMessage('');
      await refreshRequests();
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to request meeting. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    api.logout();
    router.replace('/investor/login');
  };

  // Set of showcaseIds the investor has already requested (to disable duplicates).
  const requestedIds = new Set(requests.map((r) => r.showcaseId));

  // ─── Loading ─────────────────────────────────────────
  if (loading) {
    return (
      <Layout showNav={false}>
        <div className="min-h-screen bg-parchment flex flex-col items-center justify-center gap-4">
          <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin" />
          <p className="uppercase tracking-widest text-[10px] font-semibold text-ink/60">Loading your portal…</p>
        </div>
      </Layout>
    );
  }

  // ─── Error ───────────────────────────────────────────
  if (error) {
    return (
      <Layout showNav={false}>
        <div className="min-h-screen bg-parchment flex items-center justify-center p-8">
          <div className="w-full max-w-md bg-white border border-hairline p-12 text-center">
            <h2 className="font-serif text-2xl font-bold mb-4 text-terracotta">Something went wrong</h2>
            <p className="text-ink/60 mb-8 text-sm">{error}</p>
            <button
              onClick={loadAll}
              className="w-full bg-saffron text-parchment py-4 font-sans text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-saffron-deep transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  // ─── Dashboard ───────────────────────────────────────
  return (
    <Layout showNav={false}>
      <div className="min-h-screen bg-parchment">
        {/* Header */}
        <header className="border-b border-hairline bg-white">
          <div className="max-w-[1200px] mx-auto px-6 py-6 flex justify-between items-center">
            <div className="flex flex-col items-start">
              <span className="text-2xl font-serif italic font-bold text-forest leading-none">Aryavartham</span>
              <span className="text-[10px] font-sans uppercase tracking-[0.2em] text-ink/50 mt-1">Investor Portal</span>
            </div>
            <button
              onClick={handleLogout}
              className="font-sans text-[10px] uppercase tracking-widest text-ink/60 hover:text-terracotta-warm transition-colors border border-hairline px-4 py-2"
            >
              Sign Out
            </button>
          </div>
        </header>

        <div className="max-w-[1200px] mx-auto px-6 py-12 animate-fade-in space-y-16">
          {/* Profile */}
          {investor && (
            <section className="bg-white border border-hairline p-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-forest/5 -mr-10 -mt-10 rotate-45 border border-forest/10" />
              <div className="flex flex-col md:flex-row md:items-center gap-6 relative z-10">
                {investor.avatarUrl ? (
                  <img
                    src={investor.avatarUrl}
                    alt={`${investor.firstName} ${investor.lastName}`}
                    className="w-16 h-16 rounded-full border border-hairline object-cover"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full border border-hairline bg-forest/10 flex items-center justify-center font-serif text-2xl text-forest">
                    {(investor.firstName?.[0] || '').toUpperCase()}
                  </div>
                )}
                <div className="flex-1">
                  <h1 className="font-serif text-3xl font-bold text-forest leading-tight">
                    {investor.firstName} {investor.lastName}
                  </h1>
                  <p className="text-sm text-ink/70 mt-1">
                    {investor.firm ? <span className="font-semibold">{investor.firm}</span> : null}
                    {investor.firm ? ' · ' : ''}
                    {investor.email}
                  </p>
                  {investor.bio && (
                    <p className="text-sm text-ink/70 mt-3 leading-relaxed max-w-2xl">{investor.bio}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    {(investor.interests || []).map((interest) => (
                      <span
                        key={interest}
                        className="bg-forest/10 text-forest text-[10px] uppercase font-bold tracking-widest px-2 py-1"
                      >
                        {interest}
                      </span>
                    ))}
                    {investor.linkedIn && (
                      <a
                        href={investor.linkedIn}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] uppercase font-bold tracking-widest text-forest hover:text-terracotta-warm transition-colors"
                      >
                        LinkedIn ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Showcases */}
          <section>
            <div className="flex items-end justify-between border-b border-hairline pb-4 mb-8">
              <div>
                <h2 className="font-serif text-3xl font-bold text-ink">Startup Showcase</h2>
                <p className="text-sm text-ink/60 mt-1">Published teams currently open to investor conversations.</p>
              </div>
              <span className="font-sans text-[10px] uppercase tracking-widest text-ink/50">
                {showcases.length} {showcases.length === 1 ? 'Team' : 'Teams'}
              </span>
            </div>

            {showcases.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-hairline bg-white/40">
                <h3 className="font-serif text-2xl font-bold mb-2 text-ink">No Active Showcases</h3>
                <p className="text-ink/60 text-sm">Our cohort is still building. Check back soon for new deal flow.</p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {showcases.map((showcase) => {
                  const alreadyRequested = requestedIds.has(showcase.id);
                  const metricEntries = showcase.metrics && typeof showcase.metrics === 'object'
                    ? Object.entries(showcase.metrics)
                    : [];
                  return (
                    <div
                      key={showcase.id}
                      className="border border-hairline bg-white flex flex-col h-full"
                    >
                      <div className="p-6 flex-1">
                        <p className="text-sm text-ink/80 mb-6 leading-relaxed whitespace-pre-line">
                          {showcase.pitchSummary}
                        </p>

                        {metricEntries.length > 0 && (
                          <div className="grid grid-cols-2 gap-4 border-t border-hairline pt-4 mb-4">
                            {metricEntries.slice(0, 4).map(([key, value]) => (
                              <div key={key}>
                                <span className="block text-[10px] uppercase tracking-widest text-ink/50 mb-1">{key}</span>
                                <span className="font-semibold text-sm break-words">{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {showcase.mvpDemoUrl && (
                          <a
                            href={showcase.mvpDemoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-forest hover:underline text-sm font-semibold"
                          >
                            View MVP / Demo ↗
                          </a>
                        )}
                      </div>

                      <div className="p-4 border-t border-hairline bg-parchment/30">
                        <button
                          onClick={() => {
                            setSelected(showcase);
                            setMessage('');
                            setSubmitError(null);
                          }}
                          disabled={alreadyRequested}
                          className="w-full bg-saffron text-parchment py-3 font-sans text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-saffron-deep transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {alreadyRequested ? 'Meeting Requested' : 'Request Meeting'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* My meeting requests */}
          <section>
            <div className="border-b border-hairline pb-4 mb-8">
              <h2 className="font-serif text-3xl font-bold text-ink">My Meeting Requests</h2>
              <p className="text-sm text-ink/60 mt-1">Track the status of conversations you have initiated.</p>
            </div>

            {requests.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-hairline bg-white/40">
                <h3 className="font-serif text-xl font-bold mb-2 text-ink">No Requests Yet</h3>
                <p className="text-ink/60 text-sm">Request a meeting from a showcase above to get started.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {requests.map((req) => (
                  <div
                    key={req.id}
                    className="bg-white border border-hairline p-6 flex flex-col md:flex-row md:items-start md:justify-between gap-4"
                  >
                    <div className="flex-1">
                      <p className="text-sm text-ink/90 leading-relaxed whitespace-pre-line line-clamp-3">
                        {req.showcase?.pitchSummary || 'Showcase'}
                      </p>
                      {req.message && (
                        <p className="text-xs text-ink/60 mt-3 italic border-l-2 border-hairline pl-3">
                          “{req.message}”
                        </p>
                      )}
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-[10px] uppercase tracking-widest text-ink/50">
                        <span>Requested {new Date(req.createdAt).toLocaleDateString()}</span>
                        {req.scheduledAt && (
                          <span>Scheduled {new Date(req.scheduledAt).toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`self-start shrink-0 text-[10px] uppercase font-bold tracking-widest px-3 py-1 border ${
                        STATUS_STYLES[req.status] || STATUS_STYLES.COMPLETED
                      }`}
                    >
                      {req.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Meeting-request modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-ink/90 backdrop-blur-sm flex justify-center items-center p-4"
          onClick={() => !submitting && setSelected(null)}
        >
          <div className="bg-white max-w-lg w-full p-8 relative animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setSelected(null)}
              disabled={submitting}
              className="absolute top-4 right-6 text-2xl text-ink/40 hover:text-terracotta-warm transition-colors disabled:opacity-40"
            >
              ✕
            </button>

            <h2 className="font-serif text-3xl font-bold mb-2 text-forest">Request Meeting</h2>
            <p className="text-ink/60 mb-6 pb-6 border-b border-hairline text-sm leading-relaxed line-clamp-3">
              {selected.pitchSummary}
            </p>

            <form onSubmit={handleRequestMeeting} className="grid gap-6">
              {submitError && (
                <div className="p-3 bg-terracotta/10 border border-terracotta/30 text-terracotta text-[10px] uppercase tracking-wider">
                  {submitError}
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase tracking-widest font-semibold text-ink/70 mb-2">
                  Message to Founders (Optional)
                </label>
                <textarea
                  rows={4}
                  className="w-full bg-parchment/30 border border-hairline px-4 py-3 focus:border-forest outline-none resize-none text-sm"
                  placeholder="Share what interests you and any context for the team…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-saffron text-parchment py-4 font-sans text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-saffron-deep transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Sending Request…' : 'Submit Request'}
              </button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
