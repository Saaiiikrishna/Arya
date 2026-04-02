'use client';

import { useState, useEffect, use } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import SmartMatchingModal from '@/components/admin/SmartMatchingModal';
import AdminElectionControls from '@/components/admin/AdminElectionControls';

const STATUS_TRANSITIONS: Record<string, { next: string; label: string }> = {
  FILLING: { next: 'SCREENING', label: 'Start Screening' },
  SCREENING: { next: 'TEAM_FORMATION', label: 'Start Team Formation' },
  TEAM_FORMATION: { next: 'PROCESSING', label: 'Move to Processing' },
  PROCESSING: { next: 'PENDING_CONSENT', label: 'Request Consent' },
  PENDING_CONSENT: { next: 'FINALIZED', label: 'Finalize Batch' },
  FINALIZED: { next: 'PRODUCTION', label: '🚀 Move to Production' },
};

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [batch, setBatch] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [showInstructionModal, setShowInstructionModal] = useState(false);
  const [showMatchingModal, setShowMatchingModal] = useState(false);
  const [showCapacityModal, setShowCapacityModal] = useState(false);
  const [showElectionModal, setShowElectionModal] = useState(false);
  const [newCapacity, setNewCapacity] = useState(1000);
  const [instructionForm, setInstructionForm] = useState({
    title: '',
    content: '',
    explanation: '',
    deadline: '',
    additionalQuestionIds: [] as string[],
  });
  const [electionForm, setElectionForm] = useState({
    instructions: '',
    deadline: '',
  });

  const loadData = async () => {
    try {
      const [batchData, teamsData] = await Promise.all([
        api.getBatch(id),
        api.getTeamsByBatch(id),
      ]);
      setBatch(batchData);
      setTeams(teamsData);
      setNewCapacity(batchData.capacity);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [id]);

  const handleTransition = async () => {
    const transition = STATUS_TRANSITIONS[batch.status];
    if (!transition) return;
    if (!confirm(`Move batch to ${transition.next.replace(/_/g, ' ')}?`)) return;
    setActionLoading('transition');
    try {
      await api.transitionBatchStatus(id, transition.next);
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading('');
    }
  };

  const handleScreenBatch = async () => {
    setActionLoading('screen');
    try {
      const result = await api.screenBatch(id);
      alert(`Screening complete: ${result.eligibleCount} eligible, ${result.ineligibleCount} ineligible`);
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading('');
    }
  };

  const handleApprove = async () => {
    if (!confirm('Approve and move this batch to production? All users must have consented.')) return;
    setActionLoading('approve');
    try {
      await api.approveBatch(id);
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading('');
    }
  };

  const handleSendInstructions = async (e: React.FormEvent) => {
    e.preventDefault();
    const applicantCount = batch._count?.applicants || 0;
    if (!confirm(`All ${applicantCount} applicants in this batch will receive this questionnaire. Continue?`)) return;
    try {
      const result = await api.sendBatchInstructions(id, instructionForm);
      setShowInstructionModal(false);
      setInstructionForm({ title: '', content: '', explanation: '', deadline: '', additionalQuestionIds: [] });
      alert(`Instructions sent! ${result.emailsSent || 0} emails dispatched.`);
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleIncreaseCapacity = async () => {
    if (newCapacity <= batch.capacity) {
      alert('New capacity must be greater than current capacity');
      return;
    }
    try {
      await api.updateBatch(id, { capacity: newCapacity });
      setShowCapacityModal(false);
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRemoveNonResponders = async (instructionId: string) => {
    if (!confirm('This will remove all applicants who did not respond to this questionnaire. Continue?')) return;
    setActionLoading(`remove-${instructionId}`);
    try {
      const result = await api.removeNonResponders(id, instructionId);
      alert(`Removed ${result.removedCount} non-responder(s)`);
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading('');
    }
  };

  const handleStartBatchElections = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirm('This will start a leadership election for ALL teams in this batch. Continue?')) return;
    setActionLoading('election');
    try {
      const result = await api.startBatchElections(id, {
        instructions: electionForm.instructions || undefined,
        deadline: electionForm.deadline || undefined,
      });
      setShowElectionModal(false);
      setElectionForm({ instructions: '', deadline: '' });
      alert(`Elections started for ${result.totalTeams} teams. Check each team for details.`);
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading('');
    }
  };

  if (loading) return (
    <div className="flex-center min-h-[60vh]">
      <div className="spinner mb-4"></div>
      <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Batch Data</p>
    </div>
  );

  if (!batch) return (
    <div className="flex flex-col items-center justify-center py-24 px-6 border border-dashed border-ink/20 bg-parchment/50 text-center max-w-[600px] mx-auto mt-20">
      <div className="text-4xl mb-4">📦</div>
      <p className="text-ink/60 uppercase tracking-widest text-xs">Batch not found</p>
    </div>
  );

  const transition = STATUS_TRANSITIONS[batch.status];

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <Link href="/admin/batches" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← All Batches
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">
            Batch #{batch.batchNumber}
            {batch.name && <span className="text-2xl text-ink/50 ml-3 font-normal">— {batch.name}</span>}
          </h1>
          {batch.nickname && (
            <p className="text-xs text-ink/40 uppercase tracking-widest mt-1">"{batch.nickname}"</p>
          )}
          <div className="flex items-center gap-4 mt-4">
            <span className={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold border ${
              batch.status === 'PRODUCTION'
                ? 'bg-forest/10 text-forest border-forest/20'
                : 'bg-parchment text-ink/60 border-ink/20'
            }`}>
              {batch.status.replace(/_/g, ' ')}
            </span>
            <span className="text-sm text-ink/40 uppercase tracking-widest">
              {batch.currentCount} / {batch.capacity} applicants
            </span>
            <button
              onClick={() => setShowCapacityModal(true)}
              className="text-[10px] uppercase tracking-widest text-forest border border-forest/30 px-2 py-1 hover:bg-forest/10 transition-colors"
            >
              Increase Quota
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {batch.status === 'SCREENING' && (
            <button
              className="bg-white border border-hairline hover:border-forest text-ink px-6 py-3 text-xs uppercase tracking-widest font-semibold transition-colors"
              onClick={handleScreenBatch}
              disabled={!!actionLoading}
            >
              {actionLoading === 'screen' ? 'Screening...' : '🔍 Run Screening'}
            </button>
          )}
          {['SCREENING', 'TEAM_FORMATION'].includes(batch.status) && (
            <button
              className="bg-white border border-hairline hover:border-forest text-ink px-6 py-3 text-xs uppercase tracking-widest font-semibold transition-colors"
              onClick={() => setShowMatchingModal(true)}
              disabled={!!actionLoading}
            >
              🧩 Form Teams
            </button>
          )}
          {teams.length > 0 && ['TEAM_FORMATION', 'PROCESSING'].includes(batch.status) && (
            <button
              className="bg-terracotta text-white px-6 py-3 text-xs uppercase tracking-widest font-semibold hover:bg-terracotta/90 transition-colors"
              onClick={() => setShowElectionModal(true)}
              disabled={!!actionLoading}
            >
              🗳️ Start Election Procedure
            </button>
          )}
          <button
            className="bg-white border border-hairline hover:border-forest text-ink px-6 py-3 text-xs uppercase tracking-widest font-semibold transition-colors"
            onClick={() => setShowInstructionModal(true)}
          >
            ✉️ Send Instructions
          </button>
          {batch.status === 'FINALIZED' && (
            <button
              className="bg-forest hover:opacity-90 text-white px-6 py-3 text-xs uppercase tracking-widest font-semibold transition-opacity"
              onClick={handleApprove}
              disabled={!!actionLoading}
            >
              {actionLoading === 'approve' ? 'Approving...' : '🚀 Approve & Launch'}
            </button>
          )}
          {transition && batch.status !== 'FINALIZED' && (
            <button
              className="bg-ink hover:bg-terracotta text-white px-6 py-3 text-xs uppercase tracking-widest font-semibold transition-colors"
              onClick={handleTransition}
              disabled={!!actionLoading}
            >
              {actionLoading === 'transition' ? 'Processing...' : transition.label}
            </button>
          )}
        </div>
      </header>

      {/* Teams Section */}
      <section className="mb-16">
        <h2 className="font-serif text-2xl font-bold mb-6">
          Teams ({teams.length})
        </h2>
        {teams.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 border border-dashed border-ink/20 bg-parchment/50 text-center">
            <p className="text-ink/60 uppercase tracking-widest text-xs">No teams formed yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {teams.map((team) => (
              <div key={team.id} className="border border-hairline bg-white p-6 hover:border-forest transition-colors shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-serif text-xl font-bold">{team.name}</span>
                  <span className="px-3 py-1 text-[10px] uppercase tracking-widest font-bold bg-forest/10 text-forest border border-forest/20">
                    {team._count?.members || team.members?.length || 0} members
                  </span>
                </div>
                {team.members && team.members.slice(0, 5).map((m: any) => (
                  <div key={m.id} className="text-sm text-ink/60 py-1 border-b border-hairline/50 last:border-0">
                    {m.firstName} {m.lastName}
                  </div>
                ))}
                {team.members && team.members.length > 5 && (
                  <div className="text-xs text-ink/40 mt-2 uppercase tracking-widest">+{team.members.length - 5} more</div>
                )}
                <AdminElectionControls teamId={team.id} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Instructions History */}
      {batch.instructions && batch.instructions.length > 0 && (
        <section className="mb-16">
          <h2 className="font-serif text-2xl font-bold mb-6">Instructions Sent</h2>
          <div className="border border-hairline bg-white shadow-sm">
            {batch.instructions.map((inst: any) => (
              <div key={inst.id} className="p-6 border-b border-hairline last:border-0 hover:bg-parchment/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-serif text-lg font-bold">{inst.title}</span>
                  <div className="flex items-center gap-3">
                    {inst.deadline && (
                      <span className="text-[10px] uppercase tracking-widest text-terracotta font-semibold">
                        ⏰ {new Date(inst.deadline).toLocaleDateString()}
                      </span>
                    )}
                    <span className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold">
                      {new Date(inst.sentAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {inst.explanation && (
                  <p className="text-xs text-ink/50 italic mb-2">{inst.explanation}</p>
                )}
                <p className="text-sm text-ink/60 leading-relaxed">{inst.content}</p>
                {inst.additionalQuestionIds && inst.additionalQuestionIds.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-hairline flex justify-between items-center">
                    <span className="text-[10px] uppercase tracking-widest text-ink/40">
                      {inst.additionalQuestionIds.length} question(s) attached
                    </span>
                    <button
                      onClick={() => handleRemoveNonResponders(inst.id)}
                      disabled={actionLoading === `remove-${inst.id}`}
                      className="text-[10px] uppercase tracking-widest font-bold text-terracotta border border-terracotta/30 px-3 py-1.5 hover:bg-terracotta hover:text-white transition-colors"
                    >
                      {actionLoading === `remove-${inst.id}` ? 'Removing...' : 'Remove Non-Responders'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Instruction Modal */}
      {showInstructionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/80 backdrop-blur-sm" onClick={() => setShowInstructionModal(false)}>
          <div className="bg-white border-2 border-ink p-8 shadow-[8px_8px_0px_#1C1B19] w-full max-w-xl animate-fade-in max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-8 pb-4 border-b border-hairline">
              <h2 className="font-serif text-3xl font-bold">Send Instructions</h2>
              <button className="text-2xl text-ink/40 hover:text-terracotta transition-colors leading-none" onClick={() => setShowInstructionModal(false)}>×</button>
            </div>
            <div className="bg-amber-50 border border-amber-200 p-4 mb-6 text-sm text-amber-800">
              📢 This will be sent to <strong>{batch._count?.applicants || 0} applicant(s)</strong> in Batch #{batch.batchNumber}
            </div>
            <form onSubmit={handleSendInstructions} className="flex flex-col gap-6">
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Title *</label>
                <input
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                  value={instructionForm.title}
                  onChange={(e) => setInstructionForm({ ...instructionForm, title: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Explanation (Why participants need to answer)</label>
                <textarea
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors resize-y min-h-[80px]"
                  value={instructionForm.explanation}
                  onChange={(e) => setInstructionForm({ ...instructionForm, explanation: e.target.value })}
                  rows={3}
                  placeholder="Help participants understand the purpose of this questionnaire..."
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Content *</label>
                <textarea
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors resize-y min-h-[120px]"
                  value={instructionForm.content}
                  onChange={(e) => setInstructionForm({ ...instructionForm, content: e.target.value })}
                  required
                  rows={6}
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Response Deadline</label>
                <input
                  type="datetime-local"
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                  value={instructionForm.deadline}
                  onChange={(e) => setInstructionForm({ ...instructionForm, deadline: e.target.value })}
                />
                <p className="text-[10px] text-ink/40 mt-1">If set, non-responders can be removed after this deadline.</p>
              </div>
              <div className="flex gap-4 mt-4 pt-6 border-t border-hairline justify-end">
                <button type="button" className="px-6 py-3 border border-ink text-xs uppercase tracking-widest font-semibold text-ink hover:bg-parchment transition-colors" onClick={() => setShowInstructionModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="bg-forest hover:opacity-90 text-white px-8 py-3 text-xs uppercase tracking-widest font-semibold transition-colors">
                  Send to All Users
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Capacity Modal */}
      {showCapacityModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/80 backdrop-blur-sm" onClick={() => setShowCapacityModal(false)}>
          <div className="bg-white border-2 border-ink p-8 shadow-[8px_8px_0px_#1C1B19] w-full max-w-sm animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-2xl font-bold mb-6">Increase Batch Quota</h2>
            <p className="text-sm text-ink/60 mb-4">Current: {batch.capacity} | Filled: {batch.currentCount}</p>
            <input
              type="number"
              min={batch.capacity + 1}
              value={newCapacity}
              onChange={(e) => setNewCapacity(parseInt(e.target.value))}
              className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors mb-6"
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCapacityModal(false)} className="px-4 py-2 border border-ink text-xs uppercase tracking-widest font-semibold">Cancel</button>
              <button onClick={handleIncreaseCapacity} className="px-6 py-2 bg-forest text-white text-xs uppercase tracking-widest font-semibold">Update</button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Election Modal */}
      {showElectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/80 backdrop-blur-sm" onClick={() => setShowElectionModal(false)}>
          <div className="bg-white border-2 border-ink p-8 shadow-[8px_8px_0px_#1C1B19] w-full max-w-md animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-2xl font-bold mb-6">Start Election Procedure</h2>
            <p className="text-sm text-ink/60 mb-6">This will initiate elections for all {teams.length} teams in this batch simultaneously.</p>
            <form onSubmit={handleStartBatchElections} className="flex flex-col gap-5">
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Election Instructions</label>
                <textarea
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest resize-y min-h-[80px]"
                  value={electionForm.instructions}
                  onChange={(e) => setElectionForm({ ...electionForm, instructions: e.target.value })}
                  placeholder="Instructions about the election process..."
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Election Deadline</label>
                <input
                  type="datetime-local"
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest"
                  value={electionForm.deadline}
                  onChange={(e) => setElectionForm({ ...electionForm, deadline: e.target.value })}
                />
              </div>
              <div className="flex gap-3 justify-end mt-4 pt-4 border-t border-hairline">
                <button type="button" onClick={() => setShowElectionModal(false)} className="px-4 py-2 border border-ink text-xs uppercase tracking-widest font-semibold">Cancel</button>
                <button type="submit" disabled={actionLoading === 'election'} className="px-6 py-2 bg-terracotta text-white text-xs uppercase tracking-widest font-semibold">
                  {actionLoading === 'election' ? 'Starting...' : 'Start All Elections'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Smart Matching Modal */}
      {showMatchingModal && (
        <SmartMatchingModal
          batchId={id}
          onClose={() => setShowMatchingModal(false)}
          onSuccess={() => {
            setShowMatchingModal(false);
            loadData();
          }}
        />
      )}
    </div>
  );
}
