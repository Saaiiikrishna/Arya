'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

export default function AdminTrainingPage() {
  const [modules, setModules] = useState<any[]>([]);
  const [applicants, setApplicants] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState<string | null>(null);
  const [editModule, setEditModule] = useState<any | null>(null);
  const [assignOneModule, setAssignOneModule] = useState<any | null>(null);
  const [assignmentsModule, setAssignmentsModule] = useState<any | null>(null);
  const [moduleAssignments, setModuleAssignments] = useState<any[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [batches, setBatches] = useState<any[]>([]);

  // Forms
  const [createForm, setCreateForm] = useState({ title: '', description: '', contentType: 'VIDEO', contentUrl: '' });
  const [assignForm, setAssignForm] = useState({ batchId: '', requiredBy: '' });
  const [editForm, setEditForm] = useState({ title: '', description: '', contentType: 'VIDEO', contentUrl: '' });
  const [assignOneApplicantId, setAssignOneApplicantId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = async () => {
    try {
      const [mods, bts, st, appResult] = await Promise.all([
        api.getTrainingModules(),
        api.getBatches(),
        api.getTrainingStats().catch(() => null),
        api.getApplicants({ limit: '200' }).catch(() => ({ data: [] as any[] })),
      ]);
      setModules(mods);
      setBatches(bts);
      setStats(st);
      setApplicants(appResult?.data ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // Map applicantId -> readable label so the assignment drill-down isn't raw UUIDs.
  const applicantLabel = (applicantId: string) => {
    const a = applicants.find(x => x.id === applicantId);
    if (!a) return applicantId;
    const name = [a.firstName, a.lastName].filter(Boolean).join(' ').trim();
    return name || a.email || applicantId;
  };

  const handleCreateModule = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      // Map UI fields to the TrainingModule schema (content = URL/markdown, category = type).
      await api.createTrainingModule({
        title: createForm.title,
        description: createForm.description,
        content: createForm.contentUrl,
        category: createForm.contentType,
      });
      setShowCreateModal(false);
      setCreateForm({ title: '', description: '', contentType: 'VIDEO', contentUrl: '' });
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEdit = (mod: any) => {
    setEditModule(mod);
    setEditForm({
      title: mod.title ?? '',
      description: mod.description ?? '',
      // Existing modules store category/content; fall back for any legacy shape.
      contentType: mod.category ?? mod.contentType ?? 'VIDEO',
      contentUrl: mod.content ?? mod.contentUrl ?? '',
    });
  };

  const handleEditModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModule) return;
    setIsSubmitting(true);
    try {
      await api.updateTrainingModule(editModule.id, {
        title: editForm.title,
        description: editForm.description,
        content: editForm.contentUrl,
        category: editForm.contentType,
      });
      setEditModule(null);
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteModule = async (mod: any) => {
    if (!confirm(`Archive "${mod.title}"? It will be deactivated and hidden from founders.`)) return;
    try {
      await api.deleteTrainingModule(mod.id);
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleAssignModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAssignModal || !assignForm.batchId) return;
    setIsSubmitting(true);
    try {
      await api.bulkAssignTraining({
        moduleId: showAssignModal,
        batchId: assignForm.batchId,
        requiredBy: assignForm.requiredBy ? new Date(assignForm.requiredBy).toISOString() : undefined,
      });
      alert('Module assigned to batch successfully.');
      setShowAssignModal(null);
      setAssignForm({ batchId: '', requiredBy: '' });
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAssignOne = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignOneModule || !assignOneApplicantId) return;
    setIsSubmitting(true);
    try {
      await api.assignTraining({ moduleId: assignOneModule.id, applicantId: assignOneApplicantId });
      alert('Module assigned to founder successfully.');
      setAssignOneModule(null);
      setAssignOneApplicantId('');
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAssignments = async (mod: any) => {
    setAssignmentsModule(mod);
    setModuleAssignments([]);
    setAssignmentsLoading(true);
    try {
      const rows = await api.getTrainingAssignments(mod.id);
      setModuleAssignments(rows);
    } catch (err: any) {
      alert(err.message);
      setAssignmentsModule(null);
    } finally {
      setAssignmentsLoading(false);
    }
  };

  if (loading) return (
    <div className="flex-center min-h-[60vh]">
      <div className="spinner mb-4"></div>
      <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Training Data</p>
    </div>
  );

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      <header className="border-b border-hairline pb-8 mb-12 flex justify-between items-end">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Training Library</h1>
        </div>
        <div>
          <button onClick={() => setShowCreateModal(true)} className="btn btn-primary px-8">
            Create Module
          </button>
        </div>
      </header>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 border border-hairline bg-white mb-12 divide-x divide-hairline">
          {[
            { label: 'Active Modules', value: stats.totalModules },
            { label: 'Total Assignments', value: stats.totalAssignments },
            { label: 'Completed', value: stats.completedAssignments },
            { label: 'Completion Rate', value: `${stats.completionRate}%` },
            { label: 'Avg Score', value: stats.avgScore != null ? stats.avgScore : '—' },
          ].map((s) => (
            <div key={s.label} className="p-5">
              <div className="font-serif text-3xl font-bold leading-none">{s.value}</div>
              <div className="text-[10px] uppercase tracking-widest font-semibold text-ink/50 mt-2">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {modules.length === 0 ? (
        <div className="text-center py-20 border border-hairline bg-parchment/30">
          <p className="text-ink/60 mb-4">No training modules exist yet.</p>
          <button onClick={() => setShowCreateModal(true)} className="btn btn-secondary bg-white border border-hairline">
            Add First Module
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map(mod => {
            const isActive = mod.isActive !== false;
            return (
              <div key={mod.id} className={`border flex flex-col h-full ${isActive ? 'border-hairline bg-white' : 'border-ink/10 bg-parchment/40 opacity-70'}`}>
                <div className="p-6 flex-1">
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-[10px] uppercase tracking-widest font-bold bg-ink/5 px-2 py-1">
                      {mod.contentType || mod.category || 'MODULE'}
                    </span>
                    <div className="flex items-center gap-2">
                      {!isActive && (
                        <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40 bg-ink/5 px-2 py-1 border border-ink/10">Archived</span>
                      )}
                      <span className="text-xs text-ink/50">{mod.createdAt ? new Date(mod.createdAt).toLocaleDateString() : ''}</span>
                    </div>
                  </div>
                  <h3 className="font-serif text-xl font-bold mb-2">{mod.title}</h3>
                  <p className="text-sm text-ink/70 line-clamp-3 mb-4">{mod.description}</p>

                  {mod._count && (
                    <button
                      onClick={() => openAssignments(mod)}
                      className="w-full pt-4 border-t border-hairline text-xs uppercase tracking-widest font-semibold flex justify-between hover:text-forest transition-colors"
                    >
                      <span className="text-ink/60">Assigned To</span>
                      <span className="text-forest">{mod._count.assignments} Founders →</span>
                    </button>
                  )}
                </div>
                <div className="border-t border-hairline">
                  <div className="p-4 bg-parchment/30 flex gap-2">
                    <button
                      onClick={() => setShowAssignModal(mod.id)}
                      className="flex-1 text-xs uppercase tracking-widest font-bold border border-forest text-forest py-2 hover:bg-forest hover:text-white transition-colors"
                    >
                      Assign to Batch
                    </button>
                    <button
                      onClick={() => { setAssignOneModule(mod); setAssignOneApplicantId(''); }}
                      className="flex-1 text-xs uppercase tracking-widest font-bold border border-hairline bg-white text-ink/70 py-2 hover:text-ink hover:border-ink/30 transition-colors"
                    >
                      Assign Founder
                    </button>
                  </div>
                  <div className="px-4 pb-4 bg-parchment/30 flex gap-2">
                    <button
                      onClick={() => openEdit(mod)}
                      className="flex-1 text-xs uppercase tracking-widest font-bold border border-hairline bg-white text-ink/70 py-2 hover:text-ink hover:border-ink/30 transition-colors"
                    >
                      Edit
                    </button>
                    {(mod.contentUrl || mod.content) && (
                      <a
                        href={mod.contentUrl || mod.content}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 text-center text-xs uppercase tracking-widest font-bold border border-hairline bg-white text-ink/70 py-2 hover:text-ink hover:border-ink/30 transition-colors"
                      >
                        Preview
                      </a>
                    )}
                    {isActive && (
                      <button
                        onClick={() => handleDeleteModule(mod)}
                        className="flex-1 text-xs uppercase tracking-widest font-bold border border-terracotta/40 text-terracotta py-2 hover:bg-terracotta hover:text-white transition-colors"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Create Training Module</h2>
            <form onSubmit={handleCreateModule} className="flex flex-col gap-4">
              <div className="form-group">
                <label className="form-label">Title</label>
                <input className="form-input" required value={createForm.title} onChange={e => setCreateForm({...createForm, title: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-input form-textarea" required value={createForm.description} onChange={e => setCreateForm({...createForm, description: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Content Type</label>
                <select className="form-input" value={createForm.contentType} onChange={e => setCreateForm({...createForm, contentType: e.target.value})}>
                  <option value="VIDEO">Video (YouTube/Vimeo)</option>
                  <option value="ARTICLE">Article (Medium/Substack/Notion)</option>
                  <option value="QUIZ">Quiz / Assessment</option>
                  <option value="EXTERNAL_COURSE">External Course</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Content URL</label>
                <input type="url" className="form-input" required value={createForm.contentUrl} onChange={e => setCreateForm({...createForm, contentUrl: e.target.value})} />
              </div>
              <div className="modal-actions mt-4">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create Module'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editModule && (
        <div className="modal-overlay" onClick={() => setEditModule(null)}>
          <div className="modal max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Edit Training Module</h2>
            <form onSubmit={handleEditModule} className="flex flex-col gap-4">
              <div className="form-group">
                <label className="form-label">Title</label>
                <input className="form-input" required value={editForm.title} onChange={e => setEditForm({...editForm, title: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-input form-textarea" required value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Content Type</label>
                <select className="form-input" value={editForm.contentType} onChange={e => setEditForm({...editForm, contentType: e.target.value})}>
                  <option value="VIDEO">Video (YouTube/Vimeo)</option>
                  <option value="ARTICLE">Article (Medium/Substack/Notion)</option>
                  <option value="QUIZ">Quiz / Assessment</option>
                  <option value="EXTERNAL_COURSE">External Course</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Content URL</label>
                <input type="url" className="form-input" value={editForm.contentUrl} onChange={e => setEditForm({...editForm, contentUrl: e.target.value})} />
              </div>
              <div className="modal-actions mt-4">
                <button type="button" className="btn btn-secondary" onClick={() => setEditModule(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign to Batch Modal */}
      {showAssignModal && (
        <div className="modal-overlay" onClick={() => setShowAssignModal(null)}>
          <div className="modal max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Assign Module to Batch</h2>
            <p className="text-sm text-ink/60 mb-6">This will create training assignments for all founders currently within the selected batch.</p>
            <form onSubmit={handleAssignModule} className="flex flex-col gap-4">
              <div className="form-group">
                <label className="form-label">Select Batch</label>
                <select className="form-input" required value={assignForm.batchId} onChange={e => setAssignForm({...assignForm, batchId: e.target.value})}>
                  <option value="">-- Select a Batch --</option>
                  {batches.map(b => (
                    <option key={b.id} value={b.id}>Batch #{b.batchNumber} ({b.status.replace('_', ' ')})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Deadline (Optional)</label>
                <input type="date" className="form-input" value={assignForm.requiredBy} onChange={e => setAssignForm({...assignForm, requiredBy: e.target.value})} />
              </div>
              <div className="modal-actions mt-4">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAssignModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Assigning...' : 'Bulk Assign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Single Founder Modal */}
      {assignOneModule && (
        <div className="modal-overlay" onClick={() => setAssignOneModule(null)}>
          <div className="modal max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Assign Module to a Founder</h2>
            <p className="text-sm text-ink/60 mb-6">Assigning <span className="font-semibold text-ink">{assignOneModule.title}</span> to a single founder.</p>
            <form onSubmit={handleAssignOne} className="flex flex-col gap-4">
              <div className="form-group">
                <label className="form-label">Select Founder</label>
                <select className="form-input" required value={assignOneApplicantId} onChange={e => setAssignOneApplicantId(e.target.value)}>
                  <option value="">-- Select a Founder --</option>
                  {applicants.map(a => (
                    <option key={a.id} value={a.id}>
                      {[a.firstName, a.lastName].filter(Boolean).join(' ').trim() || a.email}{a.email ? ` (${a.email})` : ''}
                    </option>
                  ))}
                </select>
                {applicants.length === 0 && (
                  <p className="text-xs text-ink/50 mt-2">No founders are currently loaded.</p>
                )}
              </div>
              <div className="modal-actions mt-4">
                <button type="button" className="btn btn-secondary" onClick={() => setAssignOneModule(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting || !assignOneApplicantId}>
                  {isSubmitting ? 'Assigning...' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assignments Drill-down Modal */}
      {assignmentsModule && (
        <div className="modal-overlay" onClick={() => setAssignmentsModule(null)}>
          <div className="modal max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Assignments — {assignmentsModule.title}</h2>
            {assignmentsLoading ? (
              <div className="flex-center py-12">
                <div className="spinner" />
              </div>
            ) : moduleAssignments.length === 0 ? (
              <p className="text-sm text-ink/60 py-8 text-center">No founders have been assigned this module yet.</p>
            ) : (
              <div className="border border-hairline overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-parchment/50 text-left text-[10px] uppercase tracking-widest font-bold text-ink/50">
                      <th className="px-4 py-3">Founder</th>
                      <th className="px-4 py-3">Assigned</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {moduleAssignments.map(a => (
                      <tr key={a.id}>
                        <td className="px-4 py-3">{applicantLabel(a.applicantId)}</td>
                        <td className="px-4 py-3 text-ink/60">{a.assignedAt ? new Date(a.assignedAt).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3">
                          {a.completedAt ? (
                            <span className="text-[10px] uppercase tracking-widest font-bold text-forest bg-forest/10 px-2 py-1 border border-forest/20">Completed</span>
                          ) : (
                            <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40 bg-ink/5 px-2 py-1 border border-ink/10">Pending</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink/60">{a.score != null ? a.score : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="modal-actions mt-6">
              <button type="button" className="btn btn-secondary" onClick={() => setAssignmentsModule(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
