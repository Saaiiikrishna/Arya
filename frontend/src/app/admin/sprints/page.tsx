'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

type Milestone = {
  id: string;
  title: string;
  description?: string;
  deadline: string;
  type: string;
  isCompleted: boolean;
};

type Sprint = {
  id: string;
  teamId: string;
  startDate: string;
  endDate: string;
  milestones: Milestone[];
};

const SEVERITY_STYLE: Record<string, string> = {
  HIGH: 'bg-terracotta/10 text-terracotta border-terracotta/30',
  MED: 'bg-ink/5 text-ink/60 border-ink/20',
  LOW: 'bg-ink/5 text-ink/40 border-ink/20',
};

export default function AdminSprintsPage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedBatch, setSelectedBatch] = useState('');
  const [teams, setTeams] = useState<any[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [blockers, setBlockers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sprintLoading, setSprintLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Tab: 'sprint' | 'checkins'
  const [tab, setTab] = useState<'sprint' | 'checkins'>('sprint');

  // Check-ins overview
  const [checkInStatus, setCheckInStatus] = useState<any>(null);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInWeek, setCheckInWeek] = useState<number | ''>('');

  // Create sprint form
  const [showCreateSprint, setShowCreateSprint] = useState(false);
  const [sprintForm, setSprintForm] = useState({ startDate: '', endDate: '', title: '' });
  const [creatingSprint, setCreatingSprint] = useState(false);

  // Add milestone form
  const [showAddMilestone, setShowAddMilestone] = useState(false);
  const [milestoneForm, setMilestoneForm] = useState({ title: '', description: '', deadline: '' });
  const [addingMilestone, setAddingMilestone] = useState(false);

  // Bulk milestone form
  const [showBulkMilestone, setShowBulkMilestone] = useState(false);
  const [bulkForm, setBulkForm] = useState({ title: '', description: '', deadline: '' });
  const [addingBulk, setAddingBulk] = useState(false);

  useEffect(() => {
    api.getBatches()
      .then((bs) => {
        setBatches(bs);
        if (bs[0]?.id) {
          setSelectedBatch(bs[0].id);
          return api.getTeamsByBatch(bs[0].id);
        }
        return [];
      })
      .then((ts) => setTeams(ts))
      .finally(() => setLoading(false));
  }, []);

  async function handleBatchChange(batchId: string) {
    setSelectedBatch(batchId);
    setSelectedTeamId('');
    setSprint(null);
    setBlockers([]);
    setNotFound(false);
    setCheckInStatus(null);
    const ts = await api.getTeamsByBatch(batchId);
    setTeams(ts);
  }

  async function loadCheckInStatus(batchId: string, week?: number) {
    if (!batchId) return;
    setCheckInLoading(true);
    try {
      const data = await api.adminGetCheckInStatus(batchId, week);
      setCheckInStatus(data);
    } catch {
      setCheckInStatus(null);
    } finally {
      setCheckInLoading(false);
    }
  }

  function handleTabChange(t: 'sprint' | 'checkins') {
    setTab(t);
    if (t === 'checkins' && selectedBatch) {
      loadCheckInStatus(selectedBatch, checkInWeek !== '' ? Number(checkInWeek) : undefined);
    }
  }

  async function handleTeamChange(teamId: string) {
    setSelectedTeamId(teamId);
    setSprint(null);
    setBlockers([]);
    setNotFound(false);
    if (!teamId) return;
    setSprintLoading(true);
    try {
      const [s, bl] = await Promise.allSettled([
        api.adminGetSprintByTeam(teamId),
        api.getTeamBlockers(teamId),
      ]);
      if (s.status === 'fulfilled') setSprint(s.value);
      else setNotFound(true);
      if (bl.status === 'fulfilled') setBlockers(Array.isArray(bl.value) ? bl.value : []);
    } finally {
      setSprintLoading(false);
    }
  }

  async function handleCreateSprint(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTeamId) return;
    setCreatingSprint(true);
    try {
      await api.adminCreateSprint({ teamId: selectedTeamId, ...sprintForm });
      setShowCreateSprint(false);
      setSprintForm({ startDate: '', endDate: '', title: '' });
      handleTeamChange(selectedTeamId);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreatingSprint(false);
    }
  }

  async function handleAddMilestone(e: React.FormEvent) {
    e.preventDefault();
    if (!sprint) return;
    setAddingMilestone(true);
    try {
      await api.adminCreateMilestone(sprint.id, milestoneForm);
      setShowAddMilestone(false);
      setMilestoneForm({ title: '', description: '', deadline: '' });
      handleTeamChange(selectedTeamId);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setAddingMilestone(false);
    }
  }

  async function handleBulkMilestone(e: React.FormEvent) {
    e.preventDefault();
    setAddingBulk(true);
    try {
      await api.adminCreateBulkMilestone(bulkForm);
      setShowBulkMilestone(false);
      setBulkForm({ title: '', description: '', deadline: '' });
      if (selectedTeamId) handleTeamChange(selectedTeamId);
      alert('Milestone added to all teams.');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setAddingBulk(false);
    }
  }

  const completedCount = sprint?.milestones.filter((m) => m.isCompleted).length ?? 0;
  const totalCount = sprint?.milestones.length ?? 0;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const overdue = sprint?.milestones.filter((m) => !m.isCompleted && new Date(m.deadline) < new Date()) ?? [];

  if (loading) return (
    <div className="flex-center min-h-[60vh]">
      <div className="spinner mb-4"></div>
      <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading</p>
    </div>
  );

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      <header className="border-b border-hairline pb-8 mb-10 flex justify-between items-end">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Sprint Overview</h1>
          <p className="text-sm text-ink/50 mt-2">Select a batch and team to inspect their 90-day MVP sprint</p>
        </div>
        <button
          onClick={() => setShowBulkMilestone(true)}
          className="btn btn-secondary px-6 text-[11px]"
        >
          + Bulk Milestone (All Teams)
        </button>
      </header>

      {/* Tab strip */}
      <div className="flex border-b border-hairline mb-8 gap-0">
        {(['sprint', 'checkins'] as const).map((t) => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            className={`px-6 py-3 text-[11px] uppercase tracking-widest font-bold border-b-2 transition-colors ${
              tab === t
                ? 'border-forest text-forest'
                : 'border-transparent text-ink/50 hover:text-ink'
            }`}
          >
            {t === 'sprint' ? 'Sprint View' : 'Check-ins Overview'}
          </button>
        ))}
      </div>

      {/* Selectors */}
      <div className="flex flex-wrap gap-4 mb-10">
        <div className="flex items-center gap-3">
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
        {tab === 'sprint' && (
          <div className="flex items-center gap-3">
            <label className="text-[11px] uppercase tracking-widest font-bold text-ink/50">Team</label>
            <select
              value={selectedTeamId}
              onChange={(e) => handleTeamChange(e.target.value)}
              className="border border-hairline bg-white text-sm px-3 py-2 text-ink outline-none min-w-[220px]"
            >
              <option value="">— Select a team —</option>
              {teams.map((t: any) => (
                <option key={t.id} value={t.id}>{t.name} ({t.memberCount ?? '?'} members){t.isLocked ? '' : ' [unlocked]'}</option>
              ))}
            </select>
          </div>
        )}
        {tab === 'checkins' && (
          <div className="flex items-center gap-3">
            <label className="text-[11px] uppercase tracking-widest font-bold text-ink/50">Week</label>
            <input
              type="number" min={1} max={13}
              value={checkInWeek}
              onChange={(e) => setCheckInWeek(e.target.value ? Number(e.target.value) : '')}
              placeholder="Latest"
              className="border border-hairline bg-white text-sm px-3 py-2 text-ink outline-none w-24"
            />
            <button
              onClick={() => loadCheckInStatus(selectedBatch, checkInWeek !== '' ? Number(checkInWeek) : undefined)}
              className="btn btn-secondary text-[11px] px-4"
            >
              Load
            </button>
          </div>
        )}
      </div>

      {/* ── Check-ins tab ─────────────────────────────────────── */}
      {tab === 'checkins' && (
        <div>
          {!selectedBatch && (
            <div className="text-center py-24 border border-hairline bg-parchment/30">
              <p className="text-ink/50 uppercase tracking-widest text-xs font-semibold">Select a batch to view check-in status</p>
            </div>
          )}
          {selectedBatch && checkInLoading && (
            <div className="text-center py-16 text-ink/50 text-sm uppercase tracking-widest">Loading check-ins…</div>
          )}
          {selectedBatch && !checkInLoading && !checkInStatus && (
            <div className="text-center py-20 border border-hairline bg-parchment/30">
              <p className="text-ink/60 mb-4">No check-in data found. Select a batch and click Load.</p>
            </div>
          )}
          {selectedBatch && !checkInLoading && checkInStatus && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <p className="text-sm text-ink/60">
                  Week <span className="font-bold text-ink">{checkInStatus.week}</span> — {checkInStatus.teams.length} locked teams
                </p>
                <div className="flex gap-4 text-[11px] uppercase tracking-widest font-bold">
                  <span className="text-forest">{checkInStatus.teams.filter((t: any) => t.submitted).length} submitted</span>
                  <span className="text-terracotta">{checkInStatus.teams.filter((t: any) => !t.submitted).length} missing</span>
                </div>
              </div>
              <div className="border border-hairline divide-y divide-hairline">
                {checkInStatus.teams.map((team: any) => (
                  <div key={team.id} className={`flex items-center gap-4 px-6 py-4 ${team.submitted ? 'bg-white' : 'bg-terracotta/5'}`}>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${team.submitted ? 'bg-forest' : 'bg-terracotta'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm">{team.name}</p>
                      {team.checkIn && (
                        <p className="text-xs text-ink/50 mt-0.5 line-clamp-1">{team.checkIn.progressSummary}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      {team.checkIn && (
                        <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 border ${
                          team.checkIn.coFounderVerified
                            ? 'border-forest/30 text-forest bg-forest/5'
                            : 'border-ink/20 text-ink/40'
                        }`}>
                          {team.checkIn.coFounderVerified ? 'Verified' : 'Unverified'}
                        </span>
                      )}
                      <span className={`text-[10px] uppercase tracking-widest font-bold px-3 py-1 ${
                        team.submitted
                          ? 'bg-forest/10 text-forest'
                          : 'bg-terracotta/10 text-terracotta'
                      }`}>
                        {team.submitted ? 'Submitted' : 'Missing'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Sprint tab ─────────────────────────────────────────── */}
      {tab === 'sprint' && (
        <div>

      {/* Empty state */}
      {!selectedTeamId && (
        <div className="text-center py-24 border border-hairline bg-parchment/30">
          <p className="text-ink/50 uppercase tracking-widest text-xs font-semibold">Select a team to view their sprint</p>
        </div>
      )}

      {/* Loading sprint */}
      {selectedTeamId && sprintLoading && (
        <div className="text-center py-16 text-ink/50 text-sm uppercase tracking-widest">Loading sprint data…</div>
      )}

      {/* No sprint found */}
      {selectedTeamId && !sprintLoading && notFound && (
        <div className="border border-hairline bg-parchment/30 p-8 text-center">
          <p className="text-ink/60 mb-4">No sprint found for this team yet.</p>
          <button onClick={() => setShowCreateSprint(true)} className="btn btn-primary">Create Sprint</button>
        </div>
      )}

      {/* Sprint found */}
      {selectedTeamId && !sprintLoading && sprint && (
        <div className="space-y-8">
          {/* Sprint header card */}
          <div className="border border-hairline bg-white p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-ink/50 mb-1">Active Sprint</p>
              <p className="font-serif text-xl font-bold">
                {new Date(sprint.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                {' → '}
                {new Date(sprint.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
            <div className="flex items-center gap-6">
              {overdue.length > 0 && (
                <div className="text-center">
                  <p className="font-serif text-2xl font-bold text-terracotta">{overdue.length}</p>
                  <p className="text-[10px] uppercase tracking-widest text-terracotta/70 font-bold">Overdue</p>
                </div>
              )}
              <div className="text-center">
                <p className="font-serif text-2xl font-bold text-forest">{completedCount}/{totalCount}</p>
                <p className="text-[10px] uppercase tracking-widest text-ink/50 font-bold">Milestones Done</p>
              </div>
              <button onClick={() => setShowAddMilestone(true)} className="btn btn-secondary text-[11px]">
                + Milestone
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {totalCount > 0 && (
            <div>
              <div className="flex justify-between text-[10px] uppercase tracking-widest text-ink/50 mb-2 font-bold">
                <span>Progress</span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-2 bg-parchment w-full border border-hairline overflow-hidden">
                <div className="h-full bg-forest transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}

          {/* Milestones */}
          <section>
            <h2 className="font-serif text-xl font-bold mb-4">Milestones</h2>
            {sprint.milestones.length === 0 ? (
              <div className="border border-hairline p-6 text-center text-ink/50 text-sm">
                No milestones added yet.{' '}
                <button onClick={() => setShowAddMilestone(true)} className="text-forest underline">Add one</button>
              </div>
            ) : (
              <div className="divide-y divide-hairline border border-hairline">
                {sprint.milestones.map((m) => {
                  const isOverdue = !m.isCompleted && new Date(m.deadline) < new Date();
                  return (
                    <div key={m.id} className={`flex items-start gap-4 p-4 ${m.isCompleted ? 'bg-parchment/20' : ''}`}>
                      <div className={`mt-0.5 w-4 h-4 border flex items-center justify-center shrink-0 ${
                        m.isCompleted ? 'bg-forest border-forest' : isOverdue ? 'border-terracotta' : 'border-ink/30'
                      }`}>
                        {m.isCompleted && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-bold text-sm ${m.isCompleted ? 'line-through text-ink/40' : ''}`}>{m.title}</p>
                        {m.description && <p className="text-xs text-ink/50 mt-0.5">{m.description}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-xs font-bold uppercase tracking-widest ${isOverdue ? 'text-terracotta' : 'text-ink/50'}`}>
                          {new Date(m.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </p>
                        {isOverdue && <p className="text-[10px] text-terracotta uppercase tracking-widest">Overdue</p>}
                        <p className="text-[10px] text-ink/30 uppercase tracking-widest mt-0.5">{m.type}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Active Blockers */}
          {blockers.length > 0 && (
            <section>
              <h2 className="font-serif text-xl font-bold mb-4">Active Blockers</h2>
              <div className="divide-y divide-hairline border border-hairline">
                {blockers.filter((b) => !b.isResolved).map((b: any) => (
                  <div key={b.id} className="flex items-start gap-4 p-4">
                    <span className={`text-[10px] uppercase tracking-widest font-bold border px-2 py-0.5 shrink-0 ${SEVERITY_STYLE[b.severity] ?? SEVERITY_STYLE.MED}`}>
                      {b.severity}
                    </span>
                    <div>
                      <p className="text-sm text-ink">{b.description}</p>
                      <p className="text-[10px] text-ink/40 uppercase tracking-widest mt-0.5">Week {b.week}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

        </div>
      )}

      {/* ── Create Sprint Modal ── */}
      {showCreateSprint && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-hairline w-full max-w-md p-8">
            <h2 className="font-serif text-2xl font-bold mb-6">Create Sprint</h2>
            <form onSubmit={handleCreateSprint} className="space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Sprint Title (optional)</label>
                <input value={sprintForm.title} onChange={(e) => setSprintForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="90-Day MVP Sprint"
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Start Date</label>
                <input required type="date" value={sprintForm.startDate} onChange={(e) => setSprintForm((f) => ({ ...f, startDate: e.target.value }))}
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">End Date</label>
                <input required type="date" value={sprintForm.endDate} onChange={(e) => setSprintForm((f) => ({ ...f, endDate: e.target.value }))}
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreateSprint(false)} className="btn btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={creatingSprint} className="btn btn-primary flex-1">
                  {creatingSprint ? 'Creating...' : 'Create Sprint'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Add Milestone Modal ── */}
      {showAddMilestone && sprint && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-hairline w-full max-w-md p-8">
            <h2 className="font-serif text-2xl font-bold mb-6">Add Milestone</h2>
            <form onSubmit={handleAddMilestone} className="space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Title</label>
                <input required value={milestoneForm.title} onChange={(e) => setMilestoneForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Description (optional)</label>
                <input value={milestoneForm.description} onChange={(e) => setMilestoneForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Deadline</label>
                <input required type="date" value={milestoneForm.deadline} onChange={(e) => setMilestoneForm((f) => ({ ...f, deadline: e.target.value }))}
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAddMilestone(false)} className="btn btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={addingMilestone} className="btn btn-primary flex-1">
                  {addingMilestone ? 'Adding...' : 'Add Milestone'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Bulk Milestone Modal ── */}
      {showBulkMilestone && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-hairline w-full max-w-md p-8">
            <h2 className="font-serif text-2xl font-bold mb-2">Bulk Milestone</h2>
            <p className="text-sm text-ink/60 mb-6">This milestone will be added to <strong>all teams</strong> with an active sprint.</p>
            <form onSubmit={handleBulkMilestone} className="space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Title</label>
                <input required value={bulkForm.title} onChange={(e) => setBulkForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Description (optional)</label>
                <input value={bulkForm.description} onChange={(e) => setBulkForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Deadline</label>
                <input required type="date" value={bulkForm.deadline} onChange={(e) => setBulkForm((f) => ({ ...f, deadline: e.target.value }))}
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowBulkMilestone(false)} className="btn btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={addingBulk} className="btn btn-primary flex-1">
                  {addingBulk ? 'Adding to all...' : 'Add to All Teams'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
