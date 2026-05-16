'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

type CoFounder = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  bio?: string;
  isActive: boolean;
  createdAt: string;
  assignments: Array<{ team: { id: string; name: string; batchId: string } }>;
};

type Report = {
  id: string;
  week: number;
  summary: string;
  blockers?: string;
  nextSteps?: string;
  createdAt: string;
  team: { id: string; name: string };
  coFounder: { id: string; firstName: string; lastName: string };
};

const EMPTY_FORM = { email: '', password: '', firstName: '', lastName: '', bio: '' };

type Tab = 'roster' | 'reports';

export default function AdminCoFoundersPage() {
  const [tab, setTab] = useState<Tab>('roster');
  const [cofounders, setCofounders] = useState<CoFounder[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedBatch, setSelectedBatch] = useState('');
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [assignModal, setAssignModal] = useState<CoFounder | null>(null);
  const [assignTeamId, setAssignTeamId] = useState('');
  const [assigning, setAssigning] = useState(false);

  async function loadRoster(batchId?: string) {
    try {
      const [cfs, bs] = await Promise.all([api.listCoFounders(), api.getBatches()]);
      setCofounders(cfs);
      setBatches(bs);
      if (batchId || bs[0]?.id) {
        const bid = batchId || bs[0]?.id;
        const ts = await api.getTeamsByBatch(bid);
        setTeams(ts);
        setSelectedBatch(bid);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadReports(batchId?: string) {
    setReportsLoading(true);
    try {
      const rs = await api.getAdminWeeklyReports(batchId);
      setReports(rs);
    } catch (err) {
      console.error(err);
    } finally {
      setReportsLoading(false);
    }
  }

  useEffect(() => { loadRoster(); }, []);

  useEffect(() => {
    if (tab === 'reports') loadReports(selectedBatch || undefined);
  }, [tab]);

  async function handleBatchChange(batchId: string) {
    setSelectedBatch(batchId);
    const ts = await api.getTeamsByBatch(batchId);
    setTeams(ts);
    if (tab === 'reports') loadReports(batchId);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.createCoFounder(createForm);
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      loadRoster(selectedBatch);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleAssign() {
    if (!assignModal || !assignTeamId) return;
    setAssigning(true);
    try {
      await api.assignCoFounderToTeam(assignModal.id, assignTeamId);
      setAssignModal(null);
      setAssignTeamId('');
      loadRoster(selectedBatch);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setAssigning(false);
    }
  }

  if (loading) return (
    <div className="flex-center min-h-[60vh]">
      <div className="spinner mb-4"></div>
      <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Co-Founders</p>
    </div>
  );

  const lockedTeams = teams.filter((t: any) => t.isLocked);

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      <header className="border-b border-hairline pb-8 mb-10 flex justify-between items-end">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Co-Founders</h1>
          <p className="text-sm text-ink/50 mt-2">{cofounders.length} co-founder{cofounders.length !== 1 ? 's' : ''} registered</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary px-8">
          Add Co-Founder
        </button>
      </header>

      {/* Batch selector */}
      {batches.length > 0 && (
        <div className="mb-8 flex items-center gap-4">
          <label className="text-[11px] uppercase tracking-widest font-bold text-ink/50">Batch</label>
          <select
            value={selectedBatch}
            onChange={(e) => handleBatchChange(e.target.value)}
            className="border border-hairline bg-white text-sm px-3 py-2 text-ink outline-none"
          >
            {batches.map((b: any) => (
              <option key={b.id} value={b.id}>Batch {b.batchNumber} — {b.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-hairline mb-8">
        {(['roster', 'reports'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-6 py-3 text-[11px] uppercase tracking-widest font-bold transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-forest text-forest' : 'border-transparent text-ink/40 hover:text-ink'
            }`}
          >
            {t === 'roster' ? 'Roster' : 'Weekly Reports'}
          </button>
        ))}
      </div>

      {/* ── Roster Tab ── */}
      {tab === 'roster' && (
        <>
          {cofounders.length === 0 ? (
            <div className="text-center py-20 border border-hairline bg-parchment/30">
              <p className="text-ink/60 mb-4">No co-founders registered yet.</p>
              <button onClick={() => setShowCreate(true)} className="btn btn-secondary">Add First Co-Founder</button>
            </div>
          ) : (
            <div className="divide-y divide-hairline border border-hairline">
              {cofounders.map((cf) => (
                <div key={cf.id} className="flex items-start gap-6 p-6 hover:bg-parchment/30 transition-colors">
                  <div className="w-12 h-12 border border-ink/20 flex items-center justify-center shrink-0 bg-terracotta/5 font-serif font-bold text-terracotta text-lg">
                    {cf.firstName[0]}{cf.lastName[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-0.5">
                      <span className="font-bold text-ink">{cf.firstName} {cf.lastName}</span>
                      {!cf.isActive && (
                        <span className="text-[10px] uppercase tracking-widest font-bold border border-ink/20 text-ink/40 px-2 py-0.5">Inactive</span>
                      )}
                    </div>
                    <p className="text-sm text-ink/60">{cf.email}</p>
                    {cf.bio && <p className="text-xs text-ink/40 mt-1 line-clamp-1">{cf.bio}</p>}
                    {cf.assignments.length > 0 && (
                      <p className="text-xs text-ink/40 mt-2 uppercase tracking-widest">
                        Assigned to: {cf.assignments.map((a) => a.team.name).join(', ')}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => { setAssignModal(cf); setAssignTeamId(''); }}
                    className="shrink-0 text-[11px] uppercase tracking-widest font-bold border border-forest text-forest px-4 py-2 hover:bg-forest hover:text-white transition-colors"
                  >
                    Assign to Team
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Reports Tab ── */}
      {tab === 'reports' && (
        <>
          {reportsLoading ? (
            <div className="text-center py-16 text-ink/50 text-sm uppercase tracking-widest">Loading reports…</div>
          ) : reports.length === 0 ? (
            <div className="text-center py-20 border border-hairline bg-parchment/30">
              <p className="text-ink/60">No weekly reports submitted yet for this batch.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {reports.map((r) => (
                <div key={r.id} className="border border-hairline bg-white p-6">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <p className="font-bold text-ink">{r.team.name}</p>
                      <p className="text-[11px] uppercase tracking-widest text-ink/50 mt-0.5">
                        Week {r.week} · {r.coFounder.firstName} {r.coFounder.lastName} · {new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] uppercase tracking-widest font-bold border border-forest/30 text-forest px-2 py-0.5">
                      Week {r.week}
                    </span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest font-bold text-ink/50 mb-1">Summary</p>
                      <p className="text-sm text-ink/80 leading-relaxed">{r.summary}</p>
                    </div>
                    {r.blockers && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest font-bold text-terracotta/70 mb-1">Blockers</p>
                        <p className="text-sm text-ink/70 leading-relaxed">{r.blockers}</p>
                      </div>
                    )}
                    {r.nextSteps && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest font-bold text-forest/70 mb-1">Next Steps</p>
                        <p className="text-sm text-ink/70 leading-relaxed">{r.nextSteps}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Create Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center z-50 p-4">
          <div className="bg-parchment border border-ink/20 w-full max-w-lg p-8">
            <h2 className="font-serif text-2xl font-bold mb-6">Add Co-Founder</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">First Name</label>
                  <input required value={createForm.firstName} onChange={(e) => setCreateForm((f) => ({ ...f, firstName: e.target.value }))}
                    className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Last Name</label>
                  <input required value={createForm.lastName} onChange={(e) => setCreateForm((f) => ({ ...f, lastName: e.target.value }))}
                    className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Email</label>
                <input required type="email" value={createForm.email} onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Password</label>
                <input required type="password" value={createForm.password} onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Bio</label>
                <textarea value={createForm.bio} onChange={(e) => setCreateForm((f) => ({ ...f, bio: e.target.value }))}
                  rows={3} className="w-full border border-hairline px-3 py-2 text-sm outline-none resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={creating} className="btn btn-primary flex-1">
                  {creating ? 'Creating...' : 'Create Co-Founder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Assign Modal ── */}
      {assignModal && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center z-50 p-4">
          <div className="bg-parchment border border-ink/20 w-full max-w-md p-8">
            <h2 className="font-serif text-2xl font-bold mb-2">Assign Co-Founder</h2>
            <p className="text-sm text-ink/60 mb-1">
              Assigning <strong>{assignModal.firstName} {assignModal.lastName}</strong> to a locked team
            </p>
            <p className="text-[10px] uppercase tracking-widest text-ink/40 mb-6">
              Co-founders can only be assigned to teams that have been locked (Stage 2+)
            </p>
            <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-2">Select Locked Team</label>
            <select
              value={assignTeamId}
              onChange={(e) => setAssignTeamId(e.target.value)}
              className="w-full border border-hairline px-3 py-2 text-sm text-ink outline-none mb-6"
            >
              <option value="">— Select a team —</option>
              {lockedTeams.length === 0 ? (
                <option disabled>No locked teams in this batch</option>
              ) : (
                lockedTeams.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.memberCount} members)</option>
                ))
              )}
            </select>
            {lockedTeams.length === 0 && (
              <p className="text-xs text-terracotta mb-4">No locked teams found in the selected batch. Lock teams first before assigning co-founders.</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setAssignModal(null)} className="btn btn-secondary flex-1">Cancel</button>
              <button
                onClick={handleAssign}
                disabled={assigning || !assignTeamId}
                className="btn btn-primary flex-1"
              >
                {assigning ? 'Assigning...' : 'Confirm Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
