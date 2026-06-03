'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import {
  Briefcase, CheckCircle2, Rocket, CalendarClock, ExternalLink as Linkedin,
  Plus, RefreshCw, X,
} from 'lucide-react';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'];

type Tab = 'investors' | 'showcases' | 'meetings';
type InvestorFilter = 'all' | 'pending' | 'approved';
type MeetingStatus = 'REQUESTED' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED';

interface Investor {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  firm?: string | null;
  bio?: string | null;
  linkedIn?: string | null;
  interests?: string[] | null;
  isApproved: boolean;
  avatarUrl?: string | null;
  createdAt: string;
}

interface Showcase {
  id: string;
  teamId: string;
  pitchSummary: string;
  mvpDemoUrl?: string | null;
  metrics?: Record<string, any> | null;
  isPublished: boolean;
  createdAt: string;
}

interface MeetingRequest {
  id: string;
  status: MeetingStatus;
  message?: string | null;
  scheduledAt?: string | null;
  createdAt: string;
  investor?: Investor | null;
  showcase?: Showcase | null;
}

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const fmtDateTime = (d?: string | null) =>
  d
    ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

export default function AdminInvestorsPage() {
  const { role, loading: authLoading } = useAuth();
  const isAdmin = ADMIN_ROLES.includes(role || '');

  const [tab, setTab] = useState<Tab>('investors');

  // Investors
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [investorFilter, setInvestorFilter] = useState<InvestorFilter>('all');
  const [loadingInvestors, setLoadingInvestors] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);

  // Showcases
  const [showcases, setShowcases] = useState<Showcase[]>([]);
  const [loadingShowcases, setLoadingShowcases] = useState(false);
  const [showcasesLoaded, setShowcasesLoaded] = useState(false);
  const [showShowcaseModal, setShowShowcaseModal] = useState(false);
  const [editingShowcase, setEditingShowcase] = useState<Showcase | null>(null);
  const [togglingShowcase, setTogglingShowcase] = useState<string | null>(null);

  // Meetings
  const [meetings, setMeetings] = useState<MeetingRequest[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [meetingsLoaded, setMeetingsLoaded] = useState(false);
  const [savingMeeting, setSavingMeeting] = useState<string | null>(null);
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, string>>({});

  const [error, setError] = useState<string | null>(null);

  // ─── Investors ───────────────────────────────────────────
  const loadInvestors = async (filter: InvestorFilter) => {
    setLoadingInvestors(true);
    setError(null);
    try {
      const isApproved = filter === 'all' ? undefined : filter === 'approved';
      const data = await api.getInvestors(isApproved);
      setInvestors(data || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load investors.');
    } finally {
      setLoadingInvestors(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    loadInvestors(investorFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, investorFilter]);

  const handleApprove = async (id: string) => {
    setApproving(id);
    try {
      await api.approveInvestor(id);
      await loadInvestors(investorFilter);
    } catch (e: any) {
      alert(e?.message || 'Failed to approve investor.');
    } finally {
      setApproving(null);
    }
  };

  // ─── Showcases ───────────────────────────────────────────
  const loadShowcases = async () => {
    setLoadingShowcases(true);
    setError(null);
    try {
      const data = await api.getStartupShowcases();
      setShowcases(data || []);
      setShowcasesLoaded(true);
    } catch (e: any) {
      setError(e?.message || 'Failed to load showcases.');
    } finally {
      setLoadingShowcases(false);
    }
  };

  const togglePublish = async (s: Showcase) => {
    setTogglingShowcase(s.id);
    try {
      await api.updateShowcase(s.id, { isPublished: !s.isPublished });
      await loadShowcases();
    } catch (e: any) {
      alert(e?.message || 'Failed to update showcase.');
    } finally {
      setTogglingShowcase(null);
    }
  };

  // ─── Meetings ────────────────────────────────────────────
  const loadMeetings = async () => {
    setLoadingMeetings(true);
    setError(null);
    try {
      const data = await api.getMeetingRequests();
      setMeetings(data || []);
      setMeetingsLoaded(true);
    } catch (e: any) {
      setError(e?.message || 'Failed to load meeting requests.');
    } finally {
      setLoadingMeetings(false);
    }
  };

  const handleMeetingStatus = async (m: MeetingRequest, status: 'ACCEPTED' | 'DECLINED' | 'COMPLETED') => {
    setSavingMeeting(m.id);
    try {
      const scheduledRaw = scheduleDrafts[m.id];
      const scheduledAt =
        status === 'ACCEPTED' && scheduledRaw ? new Date(scheduledRaw).toISOString() : undefined;
      await api.updateMeetingStatus(m.id, status, scheduledAt);
      await loadMeetings();
    } catch (e: any) {
      alert(e?.message || 'Failed to update meeting status.');
    } finally {
      setSavingMeeting(null);
    }
  };

  // Lazy-load tab data the first time each tab is opened.
  useEffect(() => {
    if (!isAdmin) return;
    if (tab === 'showcases' && !showcasesLoaded) loadShowcases();
    if (tab === 'meetings' && !meetingsLoaded) loadMeetings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isAdmin]);

  // ─── Role gate / loading ─────────────────────────────────
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-center px-8">
        <div>
          <p className="font-serif text-2xl font-bold text-forest mb-2">Restricted</p>
          <p className="text-ink/50 font-serif italic">You do not have access to investor management.</p>
        </div>
      </div>
    );
  }

  const statusBadge = (status: MeetingStatus) => {
    const colors: Record<MeetingStatus, string> = {
      REQUESTED: 'bg-marigold/15 text-warning border-marigold/40',
      ACCEPTED: 'bg-success/10 text-success border-success/25',
      DECLINED: 'bg-terracotta/10 text-terracotta border-terracotta/20',
      COMPLETED: 'bg-forest/10 text-forest border-forest/20',
    };
    return (
      <span className={`px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${colors[status]}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-12 flex justify-between items-end">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Investor Relations</h1>
          <p className="text-ink/50 mt-2 font-serif italic">Approve investors, publish startup showcases, and broker meetings</p>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-hairline mb-8">
        {([
          ['investors', 'Investors'],
          ['showcases', 'Showcases'],
          ['meetings', 'Meeting Requests'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-6 py-3 text-[10px] uppercase tracking-widest font-bold transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-saffron text-saffron-deep'
                : 'border-transparent text-ink/40 hover:text-terracotta-warm'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-6 border border-terracotta/30 bg-terracotta/5 text-terracotta px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* ─── INVESTORS ─────────────────────────────────────── */}
      {tab === 'investors' && (
        <section className="animate-fade-in">
          {/* Filter */}
          <div className="flex gap-0 mb-6 border border-hairline w-fit">
            {([
              ['all', 'All'],
              ['pending', 'Pending'],
              ['approved', 'Approved'],
            ] as [InvestorFilter, string][]).map(([f, label], idx) => (
              <button
                key={f}
                onClick={() => setInvestorFilter(f)}
                className={`px-5 py-2 text-[10px] uppercase tracking-widest font-bold transition-colors ${idx > 0 ? 'border-l border-hairline' : ''} ${
                  investorFilter === f ? 'bg-forest text-parchment' : 'bg-white text-ink/50 hover:text-forest'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="border border-hairline bg-white">
            {loadingInvestors ? (
              <div className="p-12 text-center">
                <div className="w-6 h-6 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-ink/40 text-xs uppercase tracking-widest">Loading investors...</p>
              </div>
            ) : investors.length === 0 ? (
              <div className="p-12 text-center text-ink/40">
                <Briefcase className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="font-serif italic">No investors found for this filter.</p>
              </div>
            ) : (
              <div className="divide-y divide-hairline/60">
                {investors.map(inv => (
                  <div key={inv.id} className="flex items-center gap-5 p-5 hover:bg-alabaster/50 transition-colors">
                    <div className="w-11 h-11 bg-forest/10 flex items-center justify-center font-serif font-bold text-forest shrink-0">
                      {(inv.firstName?.[0] || '').toUpperCase()}{(inv.lastName?.[0] || '').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-bold text-sm">{inv.firstName} {inv.lastName}</span>
                        {inv.firm && <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">{inv.firm}</span>}
                        {inv.isApproved ? (
                          <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border bg-success/10 text-success border-success/25">Approved</span>
                        ) : (
                          <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border bg-marigold/15 text-warning border-marigold/40">Pending</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-[10px] text-ink/40 flex-wrap">
                        <span>{inv.email}</span>
                        {inv.linkedIn && (
                          <a href={inv.linkedIn} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-forest hover:text-saffron-deep transition-colors">
                            <Linkedin className="w-3 h-3" /> LinkedIn
                          </a>
                        )}
                        <span>Joined {fmtDate(inv.createdAt)}</span>
                      </div>
                      {inv.interests && inv.interests.length > 0 && (
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          {inv.interests.map((i, idx) => (
                            <span key={idx} className="px-1.5 py-0.5 text-[9px] uppercase tracking-widest bg-ink/5 text-ink/50">{i}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0">
                      {inv.isApproved ? (
                        <span className="inline-flex items-center gap-1.5 text-success text-[10px] uppercase tracking-widest font-bold">
                          <CheckCircle2 className="w-4 h-4" /> Active
                        </span>
                      ) : (
                        <button
                          onClick={() => handleApprove(inv.id)}
                          disabled={approving === inv.id}
                          className="px-5 py-2 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep transition-colors disabled:opacity-50"
                        >
                          {approving === inv.id ? 'Approving...' : 'Approve'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── SHOWCASES ─────────────────────────────────────── */}
      {tab === 'showcases' && (
        <section className="animate-fade-in">
          <div className="flex items-center justify-between mb-6">
            <p className="text-ink/50 text-sm font-serif italic max-w-2xl">
              Published showcases are visible to approved investors. The list below reflects what investors can browse.
            </p>
            <button
              onClick={() => { setEditingShowcase(null); setShowShowcaseModal(true); }}
              className="inline-flex items-center gap-2 px-6 py-3 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" /> New Showcase
            </button>
          </div>

          <div className="border border-hairline bg-white">
            {loadingShowcases ? (
              <div className="p-12 text-center">
                <div className="w-6 h-6 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-ink/40 text-xs uppercase tracking-widest">Loading showcases...</p>
              </div>
            ) : showcases.length === 0 ? (
              <div className="p-12 text-center text-ink/40">
                <Rocket className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="font-serif italic">No published showcases yet. Create one to feature a startup.</p>
              </div>
            ) : (
              <div className="divide-y divide-hairline/60">
                {showcases.map(s => (
                  <div key={s.id} className="p-5 hover:bg-alabaster/50 transition-colors">
                    <div className="flex items-start gap-5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap mb-2">
                          {s.isPublished ? (
                            <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border bg-success/10 text-success border-success/25">Published</span>
                          ) : (
                            <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border bg-ink/5 text-ink/50 border-ink/15">Draft</span>
                          )}
                          <code className="text-[10px] font-mono bg-ink/5 text-ink/50 px-2 py-0.5">team {s.teamId.slice(0, 8)}</code>
                          <span className="text-[10px] text-ink/30">{fmtDate(s.createdAt)}</span>
                        </div>
                        <p className="text-sm text-ink/80 line-clamp-3">{s.pitchSummary}</p>
                        {s.mvpDemoUrl && (
                          <a href={s.mvpDemoUrl} target="_blank" rel="noreferrer" className="inline-block mt-2 text-[10px] uppercase tracking-widest text-forest hover:text-saffron-deep font-bold transition-colors">
                            View MVP Demo →
                          </a>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        <button
                          onClick={() => { setEditingShowcase(s); setShowShowcaseModal(true); }}
                          className="px-4 py-2 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-white transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => togglePublish(s)}
                          disabled={togglingShowcase === s.id}
                          className={`px-4 py-2 text-[10px] uppercase tracking-widest font-bold transition-colors disabled:opacity-50 ${
                            s.isPublished
                              ? 'border border-hairline text-ink/60 hover:border-ink/30'
                              : 'bg-saffron text-parchment hover:bg-saffron-deep'
                          }`}
                        >
                          {togglingShowcase === s.id ? '...' : s.isPublished ? 'Unpublish' : 'Publish'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── MEETING REQUESTS ──────────────────────────────── */}
      {tab === 'meetings' && (
        <section className="animate-fade-in">
          <div className="flex items-center justify-between mb-6">
            <p className="text-ink/50 text-sm font-serif italic">
              Investor requests to meet showcased teams. Accept (with a schedule), decline, or mark completed.
            </p>
            <button
              onClick={loadMeetings}
              className="inline-flex items-center gap-2 px-4 py-2 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/30 transition-colors shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>

          <div className="border border-hairline bg-white">
            {loadingMeetings ? (
              <div className="p-12 text-center">
                <div className="w-6 h-6 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-ink/40 text-xs uppercase tracking-widest">Loading requests...</p>
              </div>
            ) : meetings.length === 0 ? (
              <div className="p-12 text-center text-ink/40">
                <CalendarClock className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="font-serif italic">No meeting requests yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-hairline/60">
                {meetings.map(m => (
                  <div key={m.id} className="p-5">
                    <div className="flex items-start gap-5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap mb-1">
                          <span className="font-bold text-sm">
                            {m.investor ? `${m.investor.firstName} ${m.investor.lastName}` : 'Unknown investor'}
                          </span>
                          {m.investor?.firm && (
                            <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">{m.investor.firm}</span>
                          )}
                          {statusBadge(m.status)}
                        </div>
                        <div className="text-[10px] text-ink/40 mb-2">
                          Requested {fmtDate(m.createdAt)}
                          {m.scheduledAt && <span className="ml-3 text-forest font-bold">Scheduled: {fmtDateTime(m.scheduledAt)}</span>}
                        </div>
                        {m.showcase && (
                          <p className="text-xs text-ink/70 mb-1">
                            <span className="text-ink/40 uppercase tracking-widest text-[9px] font-bold mr-2">Showcase</span>
                            {m.showcase.pitchSummary}
                          </p>
                        )}
                        {m.message && (
                          <p className="text-sm text-ink/80 mt-2 border-l-2 border-hairline pl-3 italic">“{m.message}”</p>
                        )}
                      </div>

                      <div className="flex flex-col gap-2 shrink-0 w-44">
                        {(m.status === 'REQUESTED' || m.status === 'ACCEPTED') && (
                          <>
                            <input
                              type="datetime-local"
                              value={scheduleDrafts[m.id] || ''}
                              onChange={e => setScheduleDrafts(d => ({ ...d, [m.id]: e.target.value }))}
                              className="w-full bg-white border border-hairline px-2 py-1.5 text-xs focus:outline-none focus:border-forest transition-colors"
                              title="Optional schedule for Accept"
                            />
                            <button
                              onClick={() => handleMeetingStatus(m, 'ACCEPTED')}
                              disabled={savingMeeting === m.id}
                              className="px-4 py-2 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep transition-colors disabled:opacity-50"
                            >
                              {m.status === 'ACCEPTED' ? 'Reschedule' : 'Accept'}
                            </button>
                          </>
                        )}
                        {m.status === 'ACCEPTED' && (
                          <button
                            onClick={() => handleMeetingStatus(m, 'COMPLETED')}
                            disabled={savingMeeting === m.id}
                            className="px-4 py-2 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-white transition-colors disabled:opacity-50"
                          >
                            Mark Completed
                          </button>
                        )}
                        {(m.status === 'REQUESTED' || m.status === 'ACCEPTED') && (
                          <button
                            onClick={() => handleMeetingStatus(m, 'DECLINED')}
                            disabled={savingMeeting === m.id}
                            className="px-4 py-2 border border-terracotta/30 text-terracotta text-[10px] uppercase tracking-widest font-bold hover:bg-terracotta/10 transition-colors disabled:opacity-50"
                          >
                            Decline
                          </button>
                        )}
                        {(m.status === 'DECLINED' || m.status === 'COMPLETED') && (
                          <span className="text-[10px] uppercase tracking-widest text-ink/30 font-bold text-center py-2">No actions</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── SHOWCASE CREATE / EDIT MODAL ──────────────────── */}
      {showShowcaseModal && (
        <ShowcaseModal
          showcase={editingShowcase}
          onClose={() => setShowShowcaseModal(false)}
          onSaved={() => { setShowShowcaseModal(false); loadShowcases(); }}
        />
      )}
    </div>
  );
}

// ─── Showcase create/edit modal ──────────────────────────────
function ShowcaseModal({
  showcase,
  onClose,
  onSaved,
}: {
  showcase: Showcase | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!showcase;
  const [teamId, setTeamId] = useState(showcase?.teamId || '');
  const [pitchSummary, setPitchSummary] = useState(showcase?.pitchSummary || '');
  const [mvpDemoUrl, setMvpDemoUrl] = useState(showcase?.mvpDemoUrl || '');
  const [metricsText, setMetricsText] = useState(
    showcase?.metrics ? JSON.stringify(showcase.metrics, null, 2) : '',
  );
  const [isPublished, setIsPublished] = useState(showcase?.isPublished ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    let metrics: any = undefined;
    if (metricsText.trim()) {
      try {
        metrics = JSON.parse(metricsText);
      } catch {
        setErr('Metrics must be valid JSON (e.g. {"users": 1200, "revenue": "₹4L"}).');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isEdit && showcase) {
        await api.updateShowcase(showcase.id, {
          pitchSummary,
          mvpDemoUrl: mvpDemoUrl || undefined,
          metrics,
          isPublished,
        });
      } else {
        await api.createShowcase({
          teamId: teamId.trim(),
          pitchSummary,
          mvpDemoUrl: mvpDemoUrl || undefined,
          metrics,
        });
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message || 'Failed to save showcase.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border border-hairline w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h2 className="font-serif text-2xl font-bold">{isEdit ? 'Edit Showcase' : 'New Showcase'}</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 flex flex-col gap-5">
          {err && (
            <div className="border border-terracotta/30 bg-terracotta/5 text-terracotta px-3 py-2 text-sm">{err}</div>
          )}

          {!isEdit && (
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-2">Team ID</label>
              <input
                required
                value={teamId}
                onChange={e => setTeamId(e.target.value)}
                placeholder="UUID of the team to showcase"
                className="w-full bg-white border border-hairline px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-forest transition-colors"
              />
              <p className="text-[10px] text-ink/40 mt-1">A team can have one showcase. Find the ID on the team page.</p>
            </div>
          )}
          {isEdit && showcase && (
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-2">Team</label>
              <code className="text-xs font-mono bg-ink/5 text-ink/60 px-3 py-2 block">{showcase.teamId}</code>
            </div>
          )}

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-2">Pitch Summary</label>
            <textarea
              required
              rows={4}
              value={pitchSummary}
              onChange={e => setPitchSummary(e.target.value)}
              className="w-full bg-white border border-hairline px-3 py-2.5 text-sm focus:outline-none focus:border-forest transition-colors resize-y"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-2">MVP Demo URL</label>
            <input
              type="url"
              value={mvpDemoUrl}
              onChange={e => setMvpDemoUrl(e.target.value)}
              placeholder="https://..."
              className="w-full bg-white border border-hairline px-3 py-2.5 text-sm focus:outline-none focus:border-forest transition-colors"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-2">Metrics (JSON, optional)</label>
            <textarea
              rows={3}
              value={metricsText}
              onChange={e => setMetricsText(e.target.value)}
              placeholder='{"users": 1200, "revenue": "₹4L", "growth": "12% MoM"}'
              className="w-full bg-white border border-hairline px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-forest transition-colors resize-y"
            />
          </div>

          {isEdit && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isPublished}
                onChange={e => setIsPublished(e.target.checked)}
                className="w-4 h-4 accent-saffron"
              />
              <span className="text-xs uppercase tracking-widest font-bold text-ink/60">Published</span>
            </label>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-3 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep transition-colors disabled:opacity-50"
            >
              {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Showcase'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
