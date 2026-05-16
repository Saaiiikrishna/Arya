'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

type Mentor = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  expertise: string[];
  isActive: boolean;
  createdAt: string;
  assignments: Array<{ team: { id: string; name: string } }>;
};

const EMPTY_FORM = { email: '', password: '', firstName: '', lastName: '', expertise: '', bio: '' };

export default function AdminMentorsPage() {
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedBatch, setSelectedBatch] = useState('');
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [assignModal, setAssignModal] = useState<Mentor | null>(null);
  const [assignTeamId, setAssignTeamId] = useState('');
  const [assigning, setAssigning] = useState(false);

  async function loadData(batchId?: string) {
    try {
      const [ms, bs] = await Promise.all([api.listMentors(), api.getBatches()]);
      setMentors(ms);
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

  useEffect(() => { loadData(); }, []);

  async function handleBatchChange(batchId: string) {
    setSelectedBatch(batchId);
    const ts = await api.getTeamsByBatch(batchId);
    setTeams(ts);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.createMentor({
        ...createForm,
        expertise: createForm.expertise ? createForm.expertise.split(',').map((s) => s.trim()).filter(Boolean) : [],
      });
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      loadData(selectedBatch);
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
      await api.assignMentorToTeam(assignModal.id, assignTeamId);
      setAssignModal(null);
      setAssignTeamId('');
      loadData(selectedBatch);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setAssigning(false);
    }
  }

  if (loading) return (
    <div className="flex-center min-h-[60vh]">
      <div className="spinner mb-4"></div>
      <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Mentors</p>
    </div>
  );

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      <header className="border-b border-hairline pb-8 mb-12 flex justify-between items-end">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Mentors</h1>
          <p className="text-sm text-ink/50 mt-2">{mentors.length} mentor{mentors.length !== 1 ? 's' : ''} registered</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary px-8">
          Add Mentor
        </button>
      </header>

      {/* Batch selector for team list */}
      {batches.length > 0 && (
        <div className="mb-8 flex items-center gap-4">
          <label className="text-[11px] uppercase tracking-widest font-bold text-ink/50">Assign to batch</label>
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

      {mentors.length === 0 ? (
        <div className="text-center py-20 border border-hairline bg-parchment/30">
          <p className="text-ink/60 mb-4">No mentors registered yet.</p>
          <button onClick={() => setShowCreate(true)} className="btn btn-secondary">Add First Mentor</button>
        </div>
      ) : (
        <div className="divide-y divide-hairline border border-hairline">
          {mentors.map((m) => (
            <div key={m.id} className="flex items-start gap-6 p-6 hover:bg-parchment/30 transition-colors">
              <div className="w-12 h-12 border border-ink/20 flex items-center justify-center shrink-0 bg-forest/5 font-serif font-bold text-forest text-lg">
                {m.firstName[0]}{m.lastName[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-0.5">
                  <span className="font-bold text-ink">{m.firstName} {m.lastName}</span>
                  {!m.isActive && (
                    <span className="text-[10px] uppercase tracking-widest font-bold border border-ink/20 text-ink/40 px-2 py-0.5">Inactive</span>
                  )}
                </div>
                <p className="text-sm text-ink/60">{m.email}</p>
                {m.expertise.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {m.expertise.map((tag) => (
                      <span key={tag} className="text-[10px] uppercase tracking-widest bg-ink/5 px-2 py-0.5 font-bold text-ink/60">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {m.assignments.length > 0 && (
                  <p className="text-xs text-ink/40 mt-2 uppercase tracking-widest">
                    Assigned to: {m.assignments.map((a) => a.team.name).join(', ')}
                  </p>
                )}
              </div>
              <button
                onClick={() => { setAssignModal(m); setAssignTeamId(''); }}
                className="shrink-0 text-[11px] uppercase tracking-widest font-bold border border-forest text-forest px-4 py-2 hover:bg-forest hover:text-white transition-colors"
              >
                Assign to Team
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create Mentor Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-hairline w-full max-w-lg p-8">
            <h2 className="font-serif text-2xl font-bold mb-6">Add Mentor</h2>
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
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Expertise (comma-separated)</label>
                <input value={createForm.expertise} onChange={(e) => setCreateForm((f) => ({ ...f, expertise: e.target.value }))}
                  placeholder="HealthTech, B2B SaaS, Growth"
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
                  {creating ? 'Creating...' : 'Create Mentor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Modal */}
      {assignModal && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-hairline w-full max-w-md p-8">
            <h2 className="font-serif text-2xl font-bold mb-2">Assign Mentor</h2>
            <p className="text-sm text-ink/60 mb-6">
              Assigning <strong>{assignModal.firstName} {assignModal.lastName}</strong> to a team
            </p>
            <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-2">Select Team</label>
            <select
              value={assignTeamId}
              onChange={(e) => setAssignTeamId(e.target.value)}
              className="w-full border border-hairline px-3 py-2 text-sm text-ink outline-none mb-6"
            >
              <option value="">— Select a team —</option>
              {teams.map((t: any) => (
                <option key={t.id} value={t.id}>{t.name} ({t.memberCount} members)</option>
              ))}
            </select>
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
