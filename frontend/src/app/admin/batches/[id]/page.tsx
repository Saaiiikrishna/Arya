'use client';

import { useState, useEffect, use } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

const STATUS_TRANSITIONS: Record<string, { next: string; label: string; color: string }> = {
  FILLING: { next: 'SCREENING', label: 'Start Screening', color: 'btn-primary' },
  SCREENING: { next: 'TEAM_FORMATION', label: 'Start Team Formation', color: 'btn-primary' },
  TEAM_FORMATION: { next: 'PROCESSING', label: 'Move to Processing', color: 'btn-primary' },
  PROCESSING: { next: 'PENDING_CONSENT', label: 'Request Consent', color: 'btn-primary' },
  PENDING_CONSENT: { next: 'FINALIZED', label: 'Finalize Batch', color: 'btn-primary' },
  FINALIZED: { next: 'PRODUCTION', label: '🚀 Move to Production', color: 'btn-primary' },
};

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [batch, setBatch] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [showInstructionModal, setShowInstructionModal] = useState(false);
  const [instructionForm, setInstructionForm] = useState({ title: '', content: '' });

  const loadData = async () => {
    try {
      const [batchData, teamsData] = await Promise.all([
        api.getBatch(id),
        api.getTeamsByBatch(id),
      ]);
      setBatch(batchData);
      setTeams(teamsData);
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

  const handleFormTeams = async () => {
    if (!confirm('Form teams for this batch? This will replace existing teams.')) return;
    setActionLoading('teams');
    try {
      const result = await api.formTeams(id);
      alert(`${result.teamsCreated} teams created!`);
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
    try {
      await api.sendBatchInstructions(id, instructionForm);
      setShowInstructionModal(false);
      setInstructionForm({ title: '', content: '' });
      alert('Instructions sent!');
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) return <div className="loading-page"><div className="spinner" /> Loading...</div>;
  if (!batch) return <div className="empty-state">Batch not found</div>;

  const transition = STATUS_TRANSITIONS[batch.status];

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <Link href="/admin/batches" className="text-sm text-muted" style={{ marginBottom: 4, display: 'block' }}>
            ← Back to Batches
          </Link>
          <h1 className="page-title">Batch #{batch.batchNumber}</h1>
          <div className="flex items-center gap-sm mt-sm">
            <span className={`badge badge-${batch.status.toLowerCase()}`}>
              {batch.status.replace(/_/g, ' ')}
            </span>
            <span className="text-sm text-muted">
              {batch.currentCount} / {batch.capacity} applicants
            </span>
          </div>
        </div>
        <div className="flex gap-sm">
          {batch.status === 'SCREENING' && (
            <button className="btn btn-secondary" onClick={handleScreenBatch} disabled={!!actionLoading}>
              {actionLoading === 'screen' ? 'Screening...' : '🔍 Run Screening'}
            </button>
          )}
          {['SCREENING', 'TEAM_FORMATION'].includes(batch.status) && (
            <button className="btn btn-secondary" onClick={handleFormTeams} disabled={!!actionLoading}>
              {actionLoading === 'teams' ? 'Forming...' : '🧩 Form Teams'}
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setShowInstructionModal(true)}>
            ✉️ Send Instructions
          </button>
          {batch.status === 'FINALIZED' && (
            <button className="btn btn-primary" onClick={handleApprove} disabled={!!actionLoading}>
              {actionLoading === 'approve' ? 'Approving...' : '🚀 Approve & Launch'}
            </button>
          )}
          {transition && batch.status !== 'FINALIZED' && (
            <button className={`btn ${transition.color}`} onClick={handleTransition} disabled={!!actionLoading}>
              {actionLoading === 'transition' ? 'Processing...' : transition.label}
            </button>
          )}
        </div>
      </div>

      {/* Teams Section */}
      <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 'var(--space-md)' }}>
          Teams ({teams.length})
        </h3>
        {teams.length === 0 ? (
          <p className="text-muted text-sm">No teams formed yet.</p>
        ) : (
          <div className="grid-3">
            {teams.map((team) => (
              <div key={team.id} className="card" style={{ padding: 'var(--space-md)' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-sm)' }}>
                  <span className="font-semibold">{team.name}</span>
                  <span className="badge badge-active">{team._count?.members || team.members?.length || 0} members</span>
                </div>
                {team.members && team.members.slice(0, 5).map((m: any) => (
                  <div key={m.id} className="text-sm text-secondary" style={{ padding: '2px 0' }}>
                    {m.firstName} {m.lastName}
                  </div>
                ))}
                {team.members && team.members.length > 5 && (
                  <div className="text-xs text-muted">+{team.members.length - 5} more</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Instructions History */}
      {batch.instructions && batch.instructions.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 'var(--space-md)' }}>
            Instructions Sent
          </h3>
          {batch.instructions.map((inst: any) => (
            <div key={inst.id} style={{
              padding: 'var(--space-md)',
              borderBottom: '1px solid var(--color-border)',
            }}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{inst.title}</span>
                <span className="text-xs text-muted">
                  {new Date(inst.sentAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-sm text-secondary mt-sm">{inst.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* Instruction Modal */}
      {showInstructionModal && (
        <div className="modal-overlay" onClick={() => setShowInstructionModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Send Instructions to Batch</h2>
            <form onSubmit={handleSendInstructions} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div className="form-group">
                <label className="form-label">Title</label>
                <input className="form-input" value={instructionForm.title} onChange={(e) => setInstructionForm({ ...instructionForm, title: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Content</label>
                <textarea className="form-input form-textarea" value={instructionForm.content} onChange={(e) => setInstructionForm({ ...instructionForm, content: e.target.value })} required rows={6} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowInstructionModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Send to All Users</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
