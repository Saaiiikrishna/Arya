'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import {
  Building2, Clock, ArrowRightLeft, Plus, ChevronRight,
  Play, HandMetal, AlertTriangle, CheckCircle, Timer, TrendingUp,
  FileSignature, Pencil, X, Stamp, FileText
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

  // Per-holder vesting override state
  const [vestingEdits, setVestingEdits] = useState<Record<string, string>>({});
  const [vestingSavingId, setVestingSavingId] = useState<string | null>(null);

  // Create form state
  const [teams, setTeams] = useState<any[]>([]);
  const [createForm, setCreateForm] = useState({
    teamId: '', companyName: '', sector: '', description: '', registrationNumber: '',
    registeredAddress: '', gstin: '', panNumber: '', notes: '',
  });

  // Equity agreement form state (company detail panel)
  const [showAgreementForm, setShowAgreementForm] = useState(false);
  const [agreementForm, setAgreementForm] = useState({
    agreementType: 'FOUNDING', title: '', equityPct: '', duration: '', notes: '',
  });
  const [signingAgreementId, setSigningAgreementId] = useState<string | null>(null);

  // Record-equity-event form state (company detail panel)
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventForm, setEventForm] = useState({
    eventType: 'TRANSFER', fromHolderId: '', toHolderId: '', percentageAmount: '', description: '',
  });

  // Company edit form state (company detail panel)
  const [showEditForm, setShowEditForm] = useState(false);
  const [editForm, setEditForm] = useState({
    companyName: '', sector: '', description: '', registrationNumber: '',
    registeredAddress: '', gstin: '', panNumber: '', notes: '', status: '',
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
    // Reset detail-scoped sub-forms when switching companies.
    setShowAgreementForm(false);
    setShowEventForm(false);
    setShowEditForm(false);
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

  const recomputeVesting = async (id: string) => {
    if (!confirm('Recompute founder vesting from the schedule? This will recalculate vested percentages for all holders.')) return;
    setActionLoading(true);
    try {
      await api.recomputeVesting(id);
      setVestingEdits({});
      await openDetail(id);
      await refresh();
    } catch (e) { alert('Failed to recompute vesting'); console.error(e); }
    finally { setActionLoading(false); }
  };

  const saveHolderVesting = async (holder: any) => {
    const raw = vestingEdits[holder.id];
    const value = Number(raw);
    if (raw === undefined || raw === '' || Number.isNaN(value)) {
      alert('Enter a valid vesting percentage');
      return;
    }
    const max = Number(holder.equityPct);
    if (value < 0 || value > max) {
      alert(`Vesting must be between 0 and ${max}% (the holder's equity stake)`);
      return;
    }
    setVestingSavingId(holder.id);
    try {
      await api.setHolderVesting(holder.id, value);
      setVestingEdits(prev => {
        const next = { ...prev };
        delete next[holder.id];
        return next;
      });
      if (selectedId) await openDetail(selectedId);
    } catch (e) { alert('Failed to update holder vesting'); console.error(e); }
    finally { setVestingSavingId(null); }
  };

  // ─── Equity Agreements ──────────────────────────────────
  const createAgreement = async () => {
    if (!selectedId) return;
    if (!agreementForm.title.trim()) {
      alert('Agreement title is required');
      return;
    }
    const equityPct = agreementForm.equityPct === '' ? undefined : Number(agreementForm.equityPct);
    const duration = agreementForm.duration === '' ? undefined : Number(agreementForm.duration);
    if (equityPct !== undefined && (Number.isNaN(equityPct) || equityPct < 0 || equityPct > 100)) {
      alert('Equity % must be between 0 and 100');
      return;
    }
    if (duration !== undefined && (Number.isNaN(duration) || duration < 0)) {
      alert('Duration must be a positive number of days');
      return;
    }
    setActionLoading(true);
    try {
      await api.createEquityAgreement({
        companyId: selectedId,
        agreementType: agreementForm.agreementType,
        title: agreementForm.title.trim(),
        ...(equityPct !== undefined && { equityPct }),
        ...(duration !== undefined && { duration }),
        ...(agreementForm.notes.trim() && { notes: agreementForm.notes.trim() }),
      });
      setShowAgreementForm(false);
      setAgreementForm({ agreementType: 'FOUNDING', title: '', equityPct: '', duration: '', notes: '' });
      await openDetail(selectedId);
    } catch (e: any) {
      alert(e?.message || 'Failed to create agreement');
    } finally { setActionLoading(false); }
  };

  const signPlatform = async (agreementId: string) => {
    if (!confirm('Sign this agreement on behalf of the platform? This records your signature.')) return;
    setSigningAgreementId(agreementId);
    try {
      await api.signAgreementPlatform(agreementId);
      if (selectedId) await openDetail(selectedId);
    } catch (e: any) {
      alert(e?.message || 'Failed to sign agreement');
    } finally { setSigningAgreementId(null); }
  };

  // ─── Record Equity Event ────────────────────────────────
  const recordEvent = async () => {
    if (!selectedId) return;
    const { eventType, fromHolderId, toHolderId, percentageAmount, description } = eventForm;
    if (!description.trim()) {
      alert('A description is required for the audit log');
      return;
    }
    // Per-type required-field validation, mirroring the backend contract.
    if (eventType === 'TRANSFER' && (!fromHolderId || !toHolderId)) {
      alert('TRANSFER requires both a source and a target holder');
      return;
    }
    if (eventType === 'TRANSFER' && fromHolderId === toHolderId) {
      alert('Source and target holders must differ');
      return;
    }
    if (eventType === 'BUYOUT' && !fromHolderId) {
      alert('BUYOUT requires a source holder');
      return;
    }
    if (eventType === 'DILUTE' && !toHolderId) {
      alert('DILUTE requires a target holder to receive the freed equity');
      return;
    }
    if (eventType === 'VEST' && !toHolderId) {
      alert('VEST requires a target holder');
      return;
    }
    // BUYOUT zeroes the source and uses no amount; the others need a positive amount.
    const amount = Number(percentageAmount);
    if (eventType !== 'BUYOUT') {
      if (percentageAmount === '' || Number.isNaN(amount) || amount <= 0) {
        alert('Enter a positive percentage amount');
        return;
      }
    }
    setActionLoading(true);
    try {
      await api.recordEquityEvent({
        companyId: selectedId,
        eventType,
        ...(fromHolderId && { fromHolderId }),
        ...(toHolderId && { toHolderId }),
        // BUYOUT ignores the amount server-side (it zeroes the source holder).
        percentageAmount: eventType === 'BUYOUT' ? 0 : amount,
        description: description.trim(),
      });
      setShowEventForm(false);
      setEventForm({ eventType: 'TRANSFER', fromHolderId: '', toHolderId: '', percentageAmount: '', description: '' });
      await openDetail(selectedId);
      await refresh();
    } catch (e: any) {
      alert(e?.message || 'Failed to record equity event');
    } finally { setActionLoading(false); }
  };

  // ─── Company Edit ───────────────────────────────────────
  const openEditForm = () => {
    if (!detail) return;
    setEditForm({
      companyName: detail.companyName || '',
      sector: detail.sector || '',
      description: detail.description || '',
      registrationNumber: detail.registrationNumber || '',
      registeredAddress: detail.registeredAddress || '',
      gstin: detail.gstin || '',
      panNumber: detail.panNumber || '',
      notes: detail.notes || '',
      status: detail.status || '',
    });
    setShowEditForm(true);
  };

  const saveCompanyEdit = async () => {
    if (!selectedId) return;
    if (!editForm.companyName.trim()) {
      alert('Company name is required');
      return;
    }
    setActionLoading(true);
    try {
      await api.updateEquityCompany(selectedId, {
        companyName: editForm.companyName.trim(),
        sector: editForm.sector,
        description: editForm.description,
        registrationNumber: editForm.registrationNumber,
        registeredAddress: editForm.registeredAddress,
        gstin: editForm.gstin,
        panNumber: editForm.panNumber,
        notes: editForm.notes,
        ...(editForm.status && { status: editForm.status }),
      });
      setShowEditForm(false);
      await openDetail(selectedId);
      await refresh();
    } catch (e: any) {
      alert(e?.message || 'Failed to update company');
    } finally { setActionLoading(false); }
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
      FORMATION: { className: 'bg-marigold/15 text-warning border-marigold/40', icon: Building2 },
      INCORPORATED: { className: 'bg-forest/10 text-forest border-forest/20', icon: Building2 },
      ACTIVE: { className: 'bg-saffron/10 text-saffron-deep border-saffron/20', icon: Timer },
      SUSPENDED: { className: 'bg-terracotta/10 text-terracotta border-terracotta/20', icon: AlertTriangle },
      HANDED_OVER: { className: 'bg-success/10 text-success border-success/25', icon: CheckCircle },
      DISSOLVED: { className: 'bg-ink/5 text-ink/50 border-ink/15', icon: AlertTriangle },
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
            // Load teams for the dropdown via the authenticated API client.
            api.getBatches()
              .then((batches: any) => {
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
          className="px-6 py-3 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep transition-colors shadow-pop flex items-center gap-2"
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
            <Timer className="w-5 h-5 text-terracotta-warm/60" />
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
                    ? 'border-saffron bg-saffron text-parchment'
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
                        <div className="h-full bg-terracotta-warm" style={{ width: `${c.foundersEquityPct}%` }}></div>
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
                        <div className="text-xs font-bold text-saffron-deep">Day {c.daysElapsed}/1000</div>
                        <div className="h-1.5 bg-parchment mt-1">
                          <div className="h-full bg-saffron transition-all" style={{ width: `${Math.min(100, (c.daysElapsed / 1000) * 100)}%` }}></div>
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
                  <div className="flex gap-2 flex-wrap justify-end">
                    <button
                      onClick={openEditForm}
                      disabled={actionLoading}
                      className="px-4 py-2 border border-hairline text-ink/70 text-[10px] uppercase tracking-widest font-bold hover:border-forest hover:text-forest transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      <Pencil className="w-3 h-3" /> Edit Company
                    </button>
                    {detail.status !== 'HANDED_OVER' && detail.status !== 'DISSOLVED' && (
                      <button
                        onClick={() => recomputeVesting(detail.id)}
                        disabled={actionLoading}
                        className="px-4 py-2 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        <TrendingUp className="w-3 h-3" /> Recompute Vesting
                      </button>
                    )}
                    {!detail.timerStartDate && detail.status !== 'HANDED_OVER' && (
                      <button
                        onClick={() => startTimer(detail.id)}
                        disabled={actionLoading}
                        className="px-4 py-2 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep shadow-pop disabled:opacity-50 flex items-center gap-2"
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

              {/* Edit Company Form */}
              {showEditForm && (
                <div className="border border-forest/30 bg-white p-8 animate-fade-in">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-serif text-xl font-bold flex items-center gap-2">
                      <Pencil className="w-5 h-5 text-forest/60" /> Edit Company Details
                    </h3>
                    <button onClick={() => setShowEditForm(false)} className="text-ink/40 hover:text-ink transition-colors">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Company Name *</label>
                        <input type="text"
                          className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                          value={editForm.companyName}
                          onChange={e => setEditForm({ ...editForm, companyName: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Status</label>
                        <select
                          className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest bg-white"
                          value={editForm.status}
                          onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                        >
                          {['FORMATION', 'INCORPORATED', 'ACTIVE', 'SUSPENDED', 'HANDED_OVER', 'DISSOLVED'].map(s => (
                            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Sector</label>
                        <input type="text"
                          className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                          value={editForm.sector}
                          onChange={e => setEditForm({ ...editForm, sector: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">CIN / Reg No.</label>
                        <input type="text"
                          className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                          value={editForm.registrationNumber}
                          onChange={e => setEditForm({ ...editForm, registrationNumber: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">GSTIN</label>
                        <input type="text"
                          className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                          value={editForm.gstin}
                          onChange={e => setEditForm({ ...editForm, gstin: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">PAN</label>
                        <input type="text"
                          className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                          value={editForm.panNumber}
                          onChange={e => setEditForm({ ...editForm, panNumber: e.target.value })}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Description</label>
                      <textarea rows={3}
                        className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
                        value={editForm.description}
                        onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Registered Address</label>
                      <textarea rows={2}
                        className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
                        value={editForm.registeredAddress}
                        onChange={e => setEditForm({ ...editForm, registeredAddress: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Admin Notes</label>
                      <textarea rows={2}
                        className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
                        value={editForm.notes}
                        onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                      />
                    </div>
                    <div className="pt-4 border-t border-hairline flex items-center justify-end gap-3">
                      <button
                        onClick={() => setShowEditForm(false)}
                        className="px-6 py-3 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveCompanyEdit}
                        disabled={actionLoading}
                        className="px-8 py-3 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors"
                      >
                        {actionLoading ? 'Saving…' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Timer Progress */}
              {detail.timerStartDate && (
                <div className="border border-hairline bg-ink text-parchment p-8">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-serif text-xl font-bold flex items-center gap-2">
                      <Clock className="w-5 h-5" /> 1000-Day Timer
                    </h3>
                    <span className="text-saffron font-serif text-2xl font-bold">{detail.progressPct}%</span>
                  </div>
                  <div className="h-3 bg-parchment/10 w-full mb-4">
                    <div className="h-full bg-gradient-to-r from-saffron to-forest transition-all" style={{ width: `${detail.progressPct}%` }}></div>
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
                         style={{ borderColor: `conic-gradient(#2D5016 ${detail.platformEquityPct * 3.6}deg, #C94A38 ${detail.platformEquityPct * 3.6}deg)` }}>
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
                        <div className="w-3 h-3 bg-terracotta-warm"></div>
                        <span className="text-xs">Founders: <strong>{detail.foundersEquityPct}%</strong></span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Holders table */}
                <div className="border border-hairline bg-white p-6">
                  <h3 className="font-serif text-lg font-bold mb-4">Equity Holders</h3>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {detail.equityHolders?.map((h: any) => (
                      <div key={h.id} className={`p-3 border border-hairline text-sm ${!h.isActive ? 'opacity-40' : ''}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-bold">{h.holderName}</span>
                            <span className={`ml-2 px-1.5 py-0.5 text-[8px] uppercase tracking-widest font-bold border ${
                              h.holderType === 'PLATFORM' ? 'bg-forest/10 text-forest border-forest/20' : 'bg-terracotta-warm/10 text-terracotta-warm border-terracotta-warm/20'
                            }`}>{h.holderType}</span>
                          </div>
                          <div className="text-right">
                            <div className="font-serif font-bold">{h.equityPct}%</div>
                            <div className="text-[9px] text-ink/40">{h.vestedPct}% vested</div>
                          </div>
                        </div>
                        {h.isActive && (
                          <div className="mt-3 pt-3 border-t border-hairline/60 flex items-center gap-2">
                            <label className="text-[9px] uppercase tracking-widest text-ink/40 font-bold whitespace-nowrap">Set Vested %</label>
                            <input
                              type="number"
                              min={0}
                              max={h.equityPct}
                              step="0.01"
                              placeholder={String(h.vestedPct)}
                              value={vestingEdits[h.id] ?? ''}
                              onChange={e => setVestingEdits(prev => ({ ...prev, [h.id]: e.target.value }))}
                              className="w-20 border border-hairline px-2 py-1.5 text-xs focus:outline-none focus:border-forest"
                            />
                            <span className="text-[9px] text-ink/30 whitespace-nowrap">of {h.equityPct}%</span>
                            <button
                              onClick={() => saveHolderVesting(h)}
                              disabled={vestingSavingId === h.id || (vestingEdits[h.id] ?? '') === ''}
                              className="ml-auto px-3 py-1.5 bg-forest text-parchment text-[9px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-40 transition-colors"
                            >
                              {vestingSavingId === h.id ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Equity Agreements */}
              <div className="border border-hairline bg-white p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-serif text-lg font-bold flex items-center gap-2">
                    <FileSignature className="w-5 h-5 text-forest/60" /> Equity Agreements
                  </h3>
                  <button
                    onClick={() => setShowAgreementForm(v => !v)}
                    className="px-4 py-2 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors flex items-center gap-2"
                  >
                    {showAgreementForm ? <><X className="w-3 h-3" /> Cancel</> : <><Plus className="w-3 h-3" /> New Agreement</>}
                  </button>
                </div>

                {/* New agreement form */}
                {showAgreementForm && (
                  <div className="border border-forest/30 bg-alabaster/40 p-5 mb-5 animate-fade-in space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Type</label>
                        <select
                          className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest bg-white"
                          value={agreementForm.agreementType}
                          onChange={e => setAgreementForm({ ...agreementForm, agreementType: e.target.value })}
                        >
                          {['FOUNDING', 'VESTING', 'HANDOVER', 'BUYOUT'].map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Title *</label>
                        <input type="text" placeholder="e.g., Founders Vesting Agreement"
                          className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                          value={agreementForm.title}
                          onChange={e => setAgreementForm({ ...agreementForm, title: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Equity % (optional)</label>
                        <input type="number" min={0} max={100} step="0.01" placeholder="e.g., 49"
                          className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                          value={agreementForm.equityPct}
                          onChange={e => setAgreementForm({ ...agreementForm, equityPct: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Duration in days (optional)</label>
                        <input type="number" min={0} step="1" placeholder="e.g., 1000"
                          className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                          value={agreementForm.duration}
                          onChange={e => setAgreementForm({ ...agreementForm, duration: e.target.value })}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Notes (optional)</label>
                      <textarea rows={2}
                        className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
                        value={agreementForm.notes}
                        onChange={e => setAgreementForm({ ...agreementForm, notes: e.target.value })}
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={createAgreement}
                        disabled={actionLoading}
                        className="px-6 py-3 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep shadow-pop disabled:opacity-50 transition-colors"
                      >
                        {actionLoading ? 'Creating…' : 'Create Agreement'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Agreement list */}
                {(!detail.equityAgreements || detail.equityAgreements.length === 0) ? (
                  <p className="text-ink/40 text-sm font-serif italic">No agreements drafted yet.</p>
                ) : (
                  <div className="space-y-3">
                    {detail.equityAgreements.map((a: any) => (
                      <div key={a.id} className="border border-hairline p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <FileText className="w-4 h-4 text-ink/40" />
                              <span className="font-bold text-sm">{a.title}</span>
                              <span className="px-1.5 py-0.5 text-[8px] uppercase tracking-widest font-bold border bg-ink/5 text-ink/50 border-ink/15">{a.agreementType}</span>
                              <span className={`px-1.5 py-0.5 text-[8px] uppercase tracking-widest font-bold border ${
                                a.status === 'ACTIVE' ? 'bg-success/10 text-success border-success/25' :
                                a.status === 'PENDING_SIGNATURE' ? 'bg-marigold/15 text-warning border-marigold/40' :
                                a.status === 'TERMINATED' || a.status === 'EXPIRED' ? 'bg-terracotta/10 text-terracotta border-terracotta/20' :
                                'bg-ink/5 text-ink/50 border-ink/15'
                              }`}>{String(a.status).replace(/_/g, ' ')}</span>
                            </div>
                            <div className="flex items-center gap-4 mt-2 text-[10px] text-ink/40">
                              {a.equityPct != null && <span>{a.equityPct}% equity</span>}
                              {a.duration != null && <span>{a.duration} days</span>}
                            </div>
                            <div className="flex items-center gap-4 mt-2 text-[10px]">
                              <span className={a.platformSignedAt ? 'text-success' : 'text-ink/40'}>
                                {a.platformSignedAt
                                  ? `Platform signed${a.platformSignedBy ? ` by ${a.platformSignedBy}` : ''}`
                                  : 'Platform not signed'}
                              </span>
                              <span className={a.founderSignedAt ? 'text-success' : 'text-ink/40'}>
                                {a.founderSignedAt ? 'Founder signed' : 'Founder not signed'}
                              </span>
                            </div>
                            {a.notes && <p className="text-xs text-ink/60 mt-2">{a.notes}</p>}
                          </div>
                          <div className="shrink-0">
                            {!a.platformSignedAt && (
                              <button
                                onClick={() => signPlatform(a.id)}
                                disabled={signingAgreementId === a.id}
                                className="px-3 py-2 bg-forest text-parchment text-[9px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                              >
                                <Stamp className="w-3 h-3" /> {signingAgreementId === a.id ? 'Signing…' : 'Sign (Platform)'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Record Equity Event */}
              {detail.status !== 'HANDED_OVER' && detail.status !== 'DISSOLVED' && (
                <div className="border border-hairline bg-white p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-serif text-lg font-bold flex items-center gap-2">
                      <ArrowRightLeft className="w-5 h-5 text-forest/60" /> Record Equity Event
                    </h3>
                    <button
                      onClick={() => setShowEventForm(v => !v)}
                      className="px-4 py-2 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors flex items-center gap-2"
                    >
                      {showEventForm ? <><X className="w-3 h-3" /> Cancel</> : <><Plus className="w-3 h-3" /> New Event</>}
                    </button>
                  </div>

                  {showEventForm && (
                    <div className="border border-forest/30 bg-alabaster/40 p-5 animate-fade-in space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Event Type</label>
                          <select
                            className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest bg-white"
                            value={eventForm.eventType}
                            onChange={e => setEventForm({ ...eventForm, eventType: e.target.value })}
                          >
                            <option value="TRANSFER">TRANSFER — move equity between holders</option>
                            <option value="BUYOUT">BUYOUT — zero out a holder</option>
                            <option value="DILUTE">DILUTE — free equity to a target</option>
                            <option value="VEST">VEST — raise a holder's vested %</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">
                            {eventForm.eventType === 'BUYOUT' ? 'Amount (auto — full stake)' : '% Amount *'}
                          </label>
                          <input type="number" min={0} max={100} step="0.01" placeholder="e.g., 5"
                            disabled={eventForm.eventType === 'BUYOUT'}
                            className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest disabled:bg-ink/5 disabled:text-ink/40"
                            value={eventForm.eventType === 'BUYOUT' ? '' : eventForm.percentageAmount}
                            onChange={e => setEventForm({ ...eventForm, percentageAmount: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">
                            From Holder {(eventForm.eventType === 'TRANSFER' || eventForm.eventType === 'BUYOUT') && '*'}
                          </label>
                          <select
                            disabled={eventForm.eventType === 'DILUTE' || eventForm.eventType === 'VEST'}
                            className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest bg-white disabled:bg-ink/5 disabled:text-ink/40"
                            value={eventForm.fromHolderId}
                            onChange={e => setEventForm({ ...eventForm, fromHolderId: e.target.value })}
                          >
                            <option value="">Select source…</option>
                            {detail.equityHolders?.filter((h: any) => h.isActive).map((h: any) => (
                              <option key={h.id} value={h.id}>{h.holderName} ({h.equityPct}%)</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">
                            To Holder {(eventForm.eventType === 'TRANSFER' || eventForm.eventType === 'DILUTE' || eventForm.eventType === 'VEST') && '*'}
                            {eventForm.eventType === 'BUYOUT' && ' (optional)'}
                          </label>
                          <select
                            className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest bg-white"
                            value={eventForm.toHolderId}
                            onChange={e => setEventForm({ ...eventForm, toHolderId: e.target.value })}
                          >
                            <option value="">{eventForm.eventType === 'BUYOUT' ? 'Distribute to remaining holders' : 'Select target…'}</option>
                            {detail.equityHolders?.filter((h: any) => h.isActive).map((h: any) => (
                              <option key={h.id} value={h.id}>{h.holderName} ({h.equityPct}%)</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Description * (audit log)</label>
                        <textarea rows={2}
                          className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
                          placeholder="Reason / context for this equity event…"
                          value={eventForm.description}
                          onChange={e => setEventForm({ ...eventForm, description: e.target.value })}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-ink/40 max-w-md">
                          The cap table is mutated server-side and must still sum to exactly 100%. This action is logged.
                        </p>
                        <button
                          onClick={recordEvent}
                          disabled={actionLoading}
                          className="px-6 py-3 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep shadow-pop disabled:opacity-50 transition-colors"
                        >
                          {actionLoading ? 'Recording…' : 'Record Event'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
                              e.eventType === 'HANDOVER' ? 'bg-success/10 text-success border-success/25' :
                              e.eventType === 'GRANT' ? 'bg-info/10 text-info border-info/25' :
                              'bg-ink/5 text-ink/50 border-ink/15'
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
                  className="px-8 py-3 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep shadow-pop disabled:opacity-50 transition-colors"
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
