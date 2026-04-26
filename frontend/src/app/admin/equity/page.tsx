'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import {
  Building2, Clock, ArrowRightLeft, Plus, ChevronRight,
  Play, HandMetal, AlertTriangle, CheckCircle, Timer, TrendingUp
} from 'lucide-react';

interface CompanyRow {
  id: string;
  companyName: string;
  status: string;
  platformEquityPct: number;
  foundersEquityPct: number;
  timerStartDate: string | null;
  timerEndDate: string | null;
  daysElapsed: number;
  sector: string | null;
  team: { id: string; name: string; memberCount: number; batch: { batchNumber: number } };
  _count: { equityHolders: number; equityEvents: number };
}

interface EquityStats {
  totalCompanies: number;
  statusBreakdown: { status: string; count: number }[];
  avgDaysElapsed: number;
  upcomingHandovers: {
    id: string; companyName: string; teamName: string;
    timerEndDate: string | null; daysRemaining: number | null;
  }[];
}

type Panel = 'list' | 'detail' | 'create';

export default function AdminEquityPage() {
  const [stats, setStats] = useState<EquityStats | null>(null);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [meta, setMeta] = useState<{ total: number; page: number; totalPages: number }>({ total: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<Panel>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Create form state
  const [teams, setTeams] = useState<any[]>([]);
  const [createForm, setCreateForm] = useState({
    teamId: '', companyName: '', sector: '', description: '', registrationNumber: '',
    registeredAddress: '', gstin: '', panNumber: '', notes: '',
  });

  // Load dashboard
  useEffect(() => {
    Promise.all([
      api.getEquityStats(),
      api.getEquityCompanies(filterStatus ? { status: filterStatus } : {}),
    ])
      .then(([s, c]) => { setStats(s); setCompanies(c.data); setMeta(c.meta); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterStatus]);

  const refresh = async () => {
    const [s, c] = await Promise.all([
      api.getEquityStats(),
      api.getEquityCompanies(filterStatus ? { status: filterStatus } : {}),
    ]);
    setStats(s); setCompanies(c.data); setMeta(c.meta);
  };

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setPanel('detail');
    setLoadingDetail(true);
    try {
      const d = await api.getEquityCompanyDetail(id);
      setDetail(d);
    } catch (e) { console.error(e); }
    finally { setLoadingDetail(false); }
  };

  const startTimer = async (id: string) => {
    if (!confirm('Start the 1000-day equity timer? This cannot be undone.')) return;
    setActionLoading(true);
    try {
      await api.startEquityTimer(id);
      await openDetail(id);
      await refresh();
    } catch (e) { alert('Failed to start timer'); console.error(e); }
    finally { setActionLoading(false); }
  };

  const doHandover = async (id: string) => {
    if (!confirm('Execute equity handover? This will transfer the platform\'s entire stake to the founding members. This is IRREVERSIBLE.')) return;
    setActionLoading(true);
    try {
      await api.executeHandover(id);
      await openDetail(id);
      await refresh();
    } catch (e) { alert('Failed to execute handover'); console.error(e); }
    finally { setActionLoading(false); }
  };

  const handleCreate = async () => {
    if (!createForm.teamId || !createForm.companyName.trim()) {
      alert('Team and Company Name are required');
      return;
    }
    setActionLoading(true);
    try {
      await api.createEquityCompany(createForm);
      setPanel('list');
      setCreateForm({ teamId: '', companyName: '', sector: '', description: '', registrationNumber: '', registeredAddress: '', gstin: '', panNumber: '', notes: '' });
      await refresh();
    } catch (e: any) {
      alert(e?.message || 'Failed to create company');
    } finally { setActionLoading(false); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { className: string; icon: any }> = {
      FORMATION: { className: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: Building2 },
      INCORPORATED: { className: 'bg-blue-100 text-blue-800 border-blue-200', icon: Building2 },
      ACTIVE: { className: 'bg-forest/10 text-forest border-forest/20', icon: Timer },
      SUSPENDED: { className: 'bg-red-100 text-red-800 border-red-200', icon: AlertTriangle },
      HANDED_OVER: { className: 'bg-green-100 text-green-800 border-green-200', icon: CheckCircle },
      DISSOLVED: { className: 'bg-gray-100 text-gray-600 border-gray-200', icon: AlertTriangle },
    };
    const s = map[status] || map['FORMATION'];
    const Icon = s.icon;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${s.className}`}>
        <Icon className="w-3 h-3" />
        {status.replace(/_/g, ' ')}
      </span>
    );
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Equity Dashboard</p>
      </div>
    </div>
  );

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-12 flex justify-between items-end">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Equity Vault</h1>
          <p className="text-ink/50 mt-2 font-serif italic">1000-day company equity lifecycle management</p>
        </div>
        <button
          onClick={() => {
            setPanel('create');
            // Load teams for dropdown
            api.getEquityCompanies().then(() => {});
            fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/batches`, {
              headers: { 'Authorization': `Bearer ${document.cookie.match(/token=([^;]*)/)?.[1] || localStorage.getItem('admin_token') || ''}` },
            })
              .then(r => r.json())
              .then(batches => {
                const allTeams: any[] = [];
                if (Array.isArray(batches)) {
                  batches.forEach((b: any) => {
                    if (b.teams) b.teams.forEach((t: any) => allTeams.push({ ...t, batchNumber: b.batchNumber }));
                  });
                }
                setTeams(allTeams);
              })
              .catch(() => {});
          }}
          className="px-6 py-3 bg-forest text-white text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Register Company
        </button>
      </header>

      {/* Stat Cards */}
      <section className="mb-12 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="border border-hairline bg-white p-6">
          <div className="flex items-center gap-3 mb-3">
            <Building2 className="w-5 h-5 text-forest/60" />
            <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Total Companies</span>
          </div>
          <div className="font-serif text-3xl font-bold text-forest">{stats?.totalCompanies || 0}</div>
        </div>
        <div className="border border-hairline bg-white p-6">
          <div className="flex items-center gap-3 mb-3">
            <Timer className="w-5 h-5 text-terracotta/60" />
            <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Avg Days Elapsed</span>
          </div>
          <div className="font-serif text-3xl font-bold">{stats?.avgDaysElapsed || 0}<span className="text-lg text-ink/40">/1000</span></div>
        </div>
        <div className="border border-hairline bg-white p-6">
          <div className="flex items-center gap-3 mb-3">
            <TrendingUp className="w-5 h-5 text-ink/40" />
            <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Active Timers</span>
          </div>
          <div className="font-serif text-3xl font-bold">
            {stats?.statusBreakdown?.find(s => s.status === 'ACTIVE')?.count || 0}
          </div>
        </div>
        <div className="border border-hairline bg-white p-6">
          <div className="flex items-center gap-3 mb-3">
            <HandMetal className="w-5 h-5 text-green-600/60" />
            <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Handed Over</span>
          </div>
          <div className="font-serif text-3xl font-bold text-green-700">
            {stats?.statusBreakdown?.find(s => s.status === 'HANDED_OVER')?.count || 0}
          </div>
        </div>
      </section>

      {/* Upcoming Handovers Alert */}
      {stats?.upcomingHandovers && stats.upcomingHandovers.length > 0 && (
        <section className="mb-8 border border-terracotta/20 bg-terracotta/5 p-6">
          <h3 className="flex items-center gap-2 text-terracotta font-bold text-sm uppercase tracking-widest mb-4">
            <AlertTriangle className="w-4 h-4" /> Upcoming Handovers (Next 30 Days)
          </h3>
          <div className="grid gap-2">
            {stats.upcomingHandovers.map(h => (
              <div key={h.id} className="flex items-center justify-between bg-white border border-hairline p-3">
                <div>
                  <span className="font-bold text-sm">{h.companyName}</span>
                  <span className="text-ink/40 text-xs ml-3">{h.teamName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-terracotta font-bold text-sm">{h.daysRemaining} days remaining</span>
                  <button
                    onClick={() => openDetail(h.id)}
                    className="text-forest text-[10px] uppercase tracking-widest font-bold hover:underline"
                  >
                    View →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Main Content */}
      {panel === 'list' && (
        <section className="animate-fade-in">
          {/* Status filter */}
          <div className="flex gap-2 mb-6 flex-wrap">
            {['', 'FORMATION', 'INCORPORATED', 'ACTIVE', 'HANDED_OVER', 'SUSPENDED', 'DISSOLVED'].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-4 py-2 text-[10px] uppercase tracking-widest font-bold border transition-colors ${
                  filterStatus === s
                    ? 'border-forest bg-forest text-white'
                    : 'border-hairline bg-white text-ink/60 hover:border-forest/30'
                }`}
              >
                {s || 'All'}
              </button>
            ))}
          </div>

          {/* Companies table */}
          <div className="border border-hairline bg-white">
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
              <div className="col-span-3">Company</div>
              <div className="col-span-2">Team</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-2">Equity Split</div>
              <div className="col-span-2">Timer</div>
              <div className="col-span-2">Actions</div>
            </div>
            {companies.length === 0 ? (
              <div className="p-12 text-center text-ink/40">
                <Building2 className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="font-serif italic">No company entities registered yet.</p>
              </div>
            ) : (
              companies.map(c => (
                <div key={c.id} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm">
                  <div className="col-span-3">
                    <div className="font-bold">{c.companyName}</div>
                    {c.sector && <div className="text-[10px] text-ink/40">{c.sector}</div>}
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs font-semibold">{c.team.name}</div>
                    <div className="text-[10px] text-ink/40">Batch #{c.team.batch.batchNumber} · {c.team.memberCount} members</div>
                  </div>
                  <div className="col-span-1">{statusBadge(c.status)}</div>
                  <div className="col-span-2">
                    <div className="flex items-center gap-1">
                      <div className="h-2 flex-1 bg-parchment flex">
                        <div className="h-full bg-forest" style={{ width: `${c.platformEquityPct}%` }}></div>
                        <div className="h-full bg-terracotta" style={{ width: `${c.foundersEquityPct}%` }}></div>
                      </div>
                    </div>
                    <div className="flex justify-between text-[9px] text-ink/40 mt-1">
                      <span>Platform {c.platformEquityPct}%</span>
                      <span>Founders {c.foundersEquityPct}%</span>
                    </div>
                  </div>
                  <div className="col-span-2">
                    {c.timerStartDate ? (
                      <div>
                        <div className="text-xs font-bold text-forest">Day {c.daysElapsed}/1000</div>
                        <div className="h-1.5 bg-parchment mt-1">
                          <div className="h-full bg-forest transition-all" style={{ width: `${Math.min(100, (c.daysElapsed / 1000) * 100)}%` }}></div>
                        </div>
                      </div>
                    ) : (
                      <span className="text-[10px] text-ink/30 uppercase tracking-widest">Not started</span>
                    )}
                  </div>
                  <div className="col-span-2 flex gap-2">
                    <button
                      onClick={() => openDetail(c.id)}
                      className="px-3 py-1.5 border border-hairline text-[10px] uppercase tracking-widest font-bold hover:border-forest hover:text-forest transition-colors flex items-center gap-1"
                    >
                      Detail <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* COMPANY DETAIL PANEL */}
      {panel === 'detail' && (
        <section className="animate-fade-in">
          <button onClick={() => { setPanel('list'); setDetail(null); }} className="text-forest text-sm uppercase tracking-widest font-bold mb-6 inline-block">
            ← Back to Companies
          </button>

          {loadingDetail ? (
            <div className="p-12 text-center">
              <div className="w-6 h-6 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            </div>
          ) : detail ? (
            <div className="space-y-8">
              {/* Company Header */}
              <div className="border border-hairline bg-white p-8">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-serif text-3xl font-bold">{detail.companyName}</h2>
                    <div className="flex items-center gap-4 mt-2">
                      {statusBadge(detail.status)}
                      <span className="text-ink/40 text-xs">Team: <strong className="text-ink/60">{detail.team?.name}</strong></span>
                      <span className="text-ink/40 text-xs">Batch #{detail.team?.batch?.batchNumber}</span>
                    </div>
                    {detail.registrationNumber && (
                      <div className="mt-3 text-xs text-ink/50">CIN: <code className="bg-alabaster px-2 py-0.5">{detail.registrationNumber}</code></div>
                    )}
                    {detail.sector && <div className="mt-1 text-xs text-ink/50">Sector: {detail.sector}</div>}
                  </div>
                  <div className="flex gap-2">
                    {!detail.timerStartDate && detail.status !== 'HANDED_OVER' && (
                      <button
                        onClick={() => startTimer(detail.id)}
                        disabled={actionLoading}
                        className="px-4 py-2 bg-forest text-white text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 flex items-center gap-2"
                      >
                        <Play className="w-3 h-3" /> Start Timer
                      </button>
                    )}
                    {detail.status === 'ACTIVE' && detail.daysElapsed >= 1000 && (
                      <button
                        onClick={() => doHandover(detail.id)}
                        disabled={actionLoading}
                        className="px-4 py-2 bg-terracotta text-white text-[10px] uppercase tracking-widest font-bold hover:bg-terracotta/90 disabled:opacity-50 flex items-center gap-2"
                      >
                        <ArrowRightLeft className="w-3 h-3" /> Execute Handover
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Timer Progress */}
              {detail.timerStartDate && (
                <div className="border border-hairline bg-ink text-parchment p-8">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-serif text-xl font-bold flex items-center gap-2">
                      <Clock className="w-5 h-5" /> 1000-Day Timer
                    </h3>
                    <span className="text-terracotta font-serif text-2xl font-bold">{detail.progressPct}%</span>
                  </div>
                  <div className="h-3 bg-parchment/10 w-full mb-4">
                    <div className="h-full bg-gradient-to-r from-terracotta to-forest transition-all" style={{ width: `${detail.progressPct}%` }}></div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-serif font-bold">{detail.daysElapsed}</div>
                      <div className="text-[9px] uppercase tracking-widest text-parchment/40">Days Elapsed</div>
                    </div>
                    <div>
                      <div className="text-2xl font-serif font-bold">{detail.daysRemaining ?? '—'}</div>
                      <div className="text-[9px] uppercase tracking-widest text-parchment/40">Days Remaining</div>
                    </div>
                    <div>
                      <div className="text-2xl font-serif font-bold">{detail.timerEndDate ? new Date(detail.timerEndDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</div>
                      <div className="text-[9px] uppercase tracking-widest text-parchment/40">Handover Date</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Equity split + Holders */}
              <div className="grid lg:grid-cols-2 gap-6">
                {/* Split visualization */}
                <div className="border border-hairline bg-white p-6">
                  <h3 className="font-serif text-lg font-bold mb-4">Current Equity Split</h3>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-32 h-32 rounded-full border-8 border-forest relative flex items-center justify-center"
                         style={{ borderColor: `conic-gradient(#2D5016 ${detail.platformEquityPct * 3.6}deg, #B7410E ${detail.platformEquityPct * 3.6}deg)` }}>
                      <div className="text-center">
                        <div className="font-serif text-xl font-bold text-forest">{detail.platformEquityPct}%</div>
                        <div className="text-[8px] uppercase tracking-widest text-ink/40">Platform</div>
                      </div>
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-forest"></div>
                        <span className="text-xs">Platform: <strong>{detail.platformEquityPct}%</strong></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-terracotta"></div>
                        <span className="text-xs">Founders: <strong>{detail.foundersEquityPct}%</strong></span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Holders table */}
                <div className="border border-hairline bg-white p-6">
                  <h3 className="font-serif text-lg font-bold mb-4">Equity Holders</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {detail.equityHolders?.map((h: any) => (
                      <div key={h.id} className={`flex items-center justify-between p-3 border border-hairline text-sm ${!h.isActive ? 'opacity-40' : ''}`}>
                        <div>
                          <span className="font-bold">{h.holderName}</span>
                          <span className={`ml-2 px-1.5 py-0.5 text-[8px] uppercase tracking-widest font-bold border ${
                            h.holderType === 'PLATFORM' ? 'bg-forest/10 text-forest border-forest/20' : 'bg-terracotta/10 text-terracotta border-terracotta/20'
                          }`}>{h.holderType}</span>
                        </div>
                        <div className="text-right">
                          <div className="font-serif font-bold">{h.equityPct}%</div>
                          <div className="text-[9px] text-ink/40">{h.vestedPct}% vested</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Event Timeline */}
              <div className="border border-hairline bg-white p-6">
                <h3 className="font-serif text-lg font-bold mb-4">Equity Event Log</h3>
                {detail.equityEvents?.length === 0 ? (
                  <p className="text-ink/40 text-sm font-serif italic">No events recorded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {detail.equityEvents?.map((e: any) => (
                      <div key={e.id} className="flex gap-4 items-start border-l-2 border-forest/20 pl-4 py-2 hover:border-forest transition-colors">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-2 py-0.5 text-[8px] uppercase tracking-widest font-bold border ${
                              e.eventType === 'HANDOVER' ? 'bg-green-100 text-green-800 border-green-200' :
                              e.eventType === 'GRANT' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                              'bg-gray-100 text-gray-600 border-gray-200'
                            }`}>{e.eventType}</span>
                            {e.dayNumber !== null && <span className="text-[10px] text-ink/40">Day {e.dayNumber}</span>}
                          </div>
                          <p className="text-sm text-ink/70">{e.description}</p>
                          {e.fromHolder && e.toHolder && (
                            <div className="text-[10px] text-ink/40 mt-1">
                              {e.fromHolder} → {e.toHolder} ({e.percentageAmount}%)
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-ink/30 whitespace-nowrap">
                          {new Date(e.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-ink/40">Failed to load company detail.</p>
          )}
        </section>
      )}

      {/* CREATE COMPANY PANEL */}
      {panel === 'create' && (
        <section className="animate-fade-in">
          <button onClick={() => setPanel('list')} className="text-forest text-sm uppercase tracking-widest font-bold mb-6 inline-block">
            ← Back to Companies
          </button>
          <div className="border border-hairline bg-white p-8 max-w-[640px]">
            <h2 className="font-serif text-2xl font-bold mb-6">Register New Company Entity</h2>

            <div className="space-y-5">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Team *</label>
                <select
                  className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest bg-white"
                  value={createForm.teamId}
                  onChange={e => setCreateForm({ ...createForm, teamId: e.target.value })}
                >
                  <option value="">Select a team...</option>
                  {teams.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.name} (Batch #{t.batchNumber})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Company Name *</label>
                <input
                  type="text" placeholder="e.g., NovaTech Solutions Pvt Ltd"
                  className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                  value={createForm.companyName}
                  onChange={e => setCreateForm({ ...createForm, companyName: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Sector</label>
                  <input type="text" placeholder="e.g., FinTech"
                    className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                    value={createForm.sector}
                    onChange={e => setCreateForm({ ...createForm, sector: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">CIN / Reg No.</label>
                  <input type="text" placeholder="U12345TG2026PTC..."
                    className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                    value={createForm.registrationNumber}
                    onChange={e => setCreateForm({ ...createForm, registrationNumber: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">GSTIN</label>
                  <input type="text" placeholder="36AAACU1234A1Z5"
                    className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                    value={createForm.gstin}
                    onChange={e => setCreateForm({ ...createForm, gstin: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">PAN</label>
                  <input type="text" placeholder="AAACU1234A"
                    className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                    value={createForm.panNumber}
                    onChange={e => setCreateForm({ ...createForm, panNumber: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Description</label>
                <textarea rows={3}
                  className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
                  placeholder="Brief description of the company..."
                  value={createForm.description}
                  onChange={e => setCreateForm({ ...createForm, description: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Registered Address</label>
                <textarea rows={2}
                  className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
                  placeholder="Company registered address..."
                  value={createForm.registeredAddress}
                  onChange={e => setCreateForm({ ...createForm, registeredAddress: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Admin Notes</label>
                <textarea rows={2}
                  className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
                  value={createForm.notes}
                  onChange={e => setCreateForm({ ...createForm, notes: e.target.value })}
                />
              </div>

              <div className="pt-4 border-t border-hairline flex items-center justify-between">
                <p className="text-[10px] text-ink/40 max-w-sm">
                  This will create a company entity with <strong>51% platform equity</strong> and <strong>49% split among team members</strong>.
                </p>
                <button
                  onClick={handleCreate}
                  disabled={actionLoading}
                  className="px-8 py-3 bg-forest text-white text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors"
                >
                  {actionLoading ? 'Creating...' : 'Create Company'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
