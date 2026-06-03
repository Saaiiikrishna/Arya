'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface Props {
  teamId: string;
  // Notify the parent so it can refresh the batch/teams view after a mutation
  // that affects membership / lock state (lock, request resolution).
  onChange?: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  ON_TRACK: 'text-forest border-forest/30',
  DELAYED: 'text-terracotta border-terracotta/30',
  TRAINING: 'text-saffron-deep border-saffron/30',
  COMPLETED: 'text-ink/50 border-ink/20',
};

// Change-type requests are the ones an admin resolves here; leader-scoped types
// (SWAP/RESOURCE/COMPLAINT) are handled in the team workspace, not here.
const ADMIN_REQUEST_TYPES = ['SEPARATION', 'JOIN_EXISTING', 'CREATE_NEW'];

export default function AdminTeamControls({ teamId, onChange }: Props) {
  const [sprint, setSprint] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [showSprintForm, setShowSprintForm] = useState(false);
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [sprintForm, setSprintForm] = useState({ title: '', startDate: '', endDate: '' });
  const [milestoneForm, setMilestoneForm] = useState({ title: '', description: '', deadline: '' });

  // The team-sprint READ method (GET /sprints/team/:teamId) is not yet on the
  // api client (see the flag in the task report). Guard so we never call an
  // undefined method; when absent, sprint read/complete/add-milestone are hidden
  // but Create Sprint and team-request resolution still work.
  const canReadSprint = typeof (api as any).getSprintByTeamId === 'function';

  const load = async () => {
    // The sprint endpoint 404s when a team has none — treat that as "no sprint".
    const [sprintRes, reqRes] = await Promise.allSettled([
      canReadSprint ? (api as any).getSprintByTeamId(teamId) : Promise.reject(),
      api.getTeamRequests(teamId),
    ]);
    setSprint(sprintRes.status === 'fulfilled' ? sprintRes.value : null);
    if (reqRes.status === 'fulfilled') {
      setRequests(
        (reqRes.value || []).filter(
          (r: any) => r.status === 'PENDING' && ADMIN_REQUEST_TYPES.includes(r.type),
        ),
      );
    } else {
      setRequests([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const handleCreateSprint = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('create-sprint');
    try {
      // Dates go to the API as ISO strings (@IsDateString on the DTO).
      await api.createSprint({
        teamId,
        title: sprintForm.title,
        startDate: new Date(sprintForm.startDate).toISOString(),
        endDate: new Date(sprintForm.endDate).toISOString(),
      });
      setShowSprintForm(false);
      setSprintForm({ title: '', startDate: '', endDate: '' });
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleCompleteSprint = async () => {
    if (!sprint?.id) return;
    if (!confirm('Mark this sprint as COMPLETED? This counts toward the equity timer gate.')) return;
    setBusy('complete-sprint');
    try {
      await api.completeSprint(sprint.id);
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleAddMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sprint?.id) return;
    setBusy('add-milestone');
    try {
      await api.createMilestone(sprint.id, {
        title: milestoneForm.title,
        description: milestoneForm.description || undefined,
        deadline: new Date(milestoneForm.deadline).toISOString(),
        type: 'CUSTOM',
      });
      setShowMilestoneForm(false);
      setMilestoneForm({ title: '', description: '', deadline: '' });
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleResolveRequest = async (reqId: string, status: 'APPROVED' | 'REJECTED') => {
    if (!confirm(`${status === 'APPROVED' ? 'Approve' : 'Reject'} this team change request?`)) return;
    setBusy(`req-${reqId}`);
    try {
      await api.adminResolveTeamRequest(reqId, status);
      await load();
      onChange?.();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy('');
    }
  };

  if (loading) return null;

  return (
    <div className="mt-4 pt-4 border-t border-hairline">
      {/* ── Sprint management ── */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-ink/60 font-bold">Sprint</span>
        {sprint && (
          <span
            className={`px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${
              STATUS_STYLES[sprint.status] || 'text-ink/50 border-ink/20'
            }`}
          >
            #{sprint.sprintNumber} · {sprint.status?.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {sprint ? (
        <>
          <div className="text-[10px] text-ink/40 uppercase tracking-widest mb-2">
            {sprint.milestones?.length || 0} milestone(s)
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowMilestoneForm((v) => !v)}
              disabled={!!busy}
              className="text-[10px] uppercase tracking-widest font-bold border border-forest/30 text-forest px-3 py-1.5 hover:bg-forest hover:text-white transition-colors disabled:opacity-50"
            >
              {showMilestoneForm ? 'Close' : '+ Milestone'}
            </button>
            {sprint.status !== 'COMPLETED' && (
              <button
                onClick={handleCompleteSprint}
                disabled={!!busy}
                className="text-[10px] uppercase tracking-widest font-bold border border-saffron text-saffron-deep px-3 py-1.5 hover:bg-saffron hover:text-white transition-colors disabled:opacity-50"
              >
                {busy === 'complete-sprint' ? 'Completing...' : 'Complete Sprint'}
              </button>
            )}
          </div>

          {showMilestoneForm && (
            <form onSubmit={handleAddMilestone} className="flex flex-col gap-2 mt-3 bg-parchment/50 border border-hairline p-3">
              <input
                className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors"
                placeholder="Milestone title *"
                value={milestoneForm.title}
                onChange={(e) => setMilestoneForm({ ...milestoneForm, title: e.target.value })}
                required
              />
              <textarea
                className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors resize-y"
                placeholder="Description"
                rows={2}
                value={milestoneForm.description}
                onChange={(e) => setMilestoneForm({ ...milestoneForm, description: e.target.value })}
              />
              <label className="text-[9px] uppercase tracking-widest text-ink/50 font-bold">Deadline *</label>
              <input
                type="datetime-local"
                className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors"
                value={milestoneForm.deadline}
                onChange={(e) => setMilestoneForm({ ...milestoneForm, deadline: e.target.value })}
                required
              />
              <button
                type="submit"
                disabled={busy === 'add-milestone'}
                className="bg-saffron text-parchment px-3 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-saffron-deep transition-colors disabled:opacity-50"
              >
                {busy === 'add-milestone' ? 'Adding...' : 'Add Milestone'}
              </button>
            </form>
          )}
        </>
      ) : (
        <>
          {!canReadSprint && (
            <p className="text-[10px] uppercase tracking-widest text-ink/40 mb-2">
              Existing sprint status unavailable
            </p>
          )}
          {!showSprintForm ? (
            <button
              onClick={() => setShowSprintForm(true)}
              disabled={!!busy}
              className="text-[10px] uppercase tracking-widest font-bold border border-forest/30 text-forest px-3 py-1.5 hover:bg-forest hover:text-white transition-colors disabled:opacity-50"
            >
              + Create Sprint
            </button>
          ) : (
            <form onSubmit={handleCreateSprint} className="flex flex-col gap-2 bg-parchment/50 border border-hairline p-3">
              <input
                className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors"
                placeholder="Sprint title *"
                value={sprintForm.title}
                onChange={(e) => setSprintForm({ ...sprintForm, title: e.target.value })}
                required
              />
              <label className="text-[9px] uppercase tracking-widest text-ink/50 font-bold">Start *</label>
              <input
                type="date"
                className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors"
                value={sprintForm.startDate}
                onChange={(e) => setSprintForm({ ...sprintForm, startDate: e.target.value })}
                required
              />
              <label className="text-[9px] uppercase tracking-widest text-ink/50 font-bold">End *</label>
              <input
                type="date"
                className="w-full bg-white border-b border-ink/20 px-3 py-2 text-xs font-sans focus:outline-none focus:border-forest transition-colors"
                value={sprintForm.endDate}
                onChange={(e) => setSprintForm({ ...sprintForm, endDate: e.target.value })}
                required
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowSprintForm(false)}
                  className="flex-1 border border-ink/30 text-ink px-3 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-parchment transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy === 'create-sprint'}
                  className="flex-1 bg-saffron text-parchment px-3 py-2 text-[10px] uppercase tracking-widest font-semibold hover:bg-saffron-deep transition-colors disabled:opacity-50"
                >
                  {busy === 'create-sprint' ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {/* ── Pending team change requests (admin-resolvable) ── */}
      {requests.length > 0 && (
        <div className="mt-4 pt-3 border-t border-hairline">
          <span className="text-[10px] uppercase tracking-widest text-terracotta font-bold">
            {requests.length} pending request(s)
          </span>
          <div className="flex flex-col gap-2 mt-2">
            {requests.map((r) => (
              <div key={r.id} className="bg-terracotta/5 border border-terracotta/20 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/70">{r.type?.replace(/_/g, ' ')}</span>
                  {r.requester && (
                    <span className="text-[9px] text-ink/40">{r.requester.firstName} {r.requester.lastName}</span>
                  )}
                </div>
                {r.title && <p className="text-xs text-ink/70 mt-1">{r.title}</p>}
                {r.details && <p className="text-[11px] text-ink/50 italic mt-0.5">{r.details}</p>}
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleResolveRequest(r.id, 'APPROVED')}
                    disabled={busy === `req-${r.id}`}
                    className="text-[10px] uppercase tracking-widest font-bold border border-forest/30 text-forest px-3 py-1 hover:bg-forest hover:text-white transition-colors disabled:opacity-50"
                  >
                    {busy === `req-${r.id}` ? '...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => handleResolveRequest(r.id, 'REJECTED')}
                    disabled={busy === `req-${r.id}`}
                    className="text-[10px] uppercase tracking-widest font-bold border border-ink/20 text-ink/50 px-3 py-1 hover:bg-ink hover:text-white transition-colors disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
