'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

export default function AdminTrainingPage() {
  const [modules, setModules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState<string | null>(null);
  const [batches, setBatches] = useState<any[]>([]);

  // Forms
  const [createForm, setCreateForm] = useState({ title: '', description: '', contentType: 'VIDEO', contentUrl: '' });
  const [assignForm, setAssignForm] = useState({ batchId: '', requiredBy: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = async () => {
    try {
      const [mods, bts] = await Promise.all([
        api.getTrainingModules(),
        api.getBatches(),
      ]);
      setModules(mods);
      setBatches(bts);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleCreateModule = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.createTrainingModule(createForm);
      setShowCreateModal(false);
      setCreateForm({ title: '', description: '', contentType: 'VIDEO', contentUrl: '' });
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
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

      {modules.length === 0 ? (
        <div className="text-center py-20 border border-hairline bg-parchment/30">
          <p className="text-ink/60 mb-4">No training modules exist yet.</p>
          <button onClick={() => setShowCreateModal(true)} className="btn btn-secondary bg-white border border-hairline">
            Add First Module
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map(mod => (
            <div key={mod.id} className="border border-hairline bg-white flex flex-col h-full hover:shadow-sm">
              <div className="p-6 flex-1">
                <div className="flex justify-between items-start mb-3">
                  <span className="text-[10px] uppercase tracking-widest font-bold bg-ink/5 px-2 py-1">
                    {mod.contentType}
                  </span>
                  <span className="text-xs text-ink/50">{new Date(mod.createdAt).toLocaleDateString()}</span>
                </div>
                <h3 className="font-serif text-xl font-bold mb-2">{mod.title}</h3>
                <p className="text-sm text-ink/70 line-clamp-3 mb-4">{mod.description}</p>
                
                {mod._count && (
                  <div className="pt-4 border-t border-hairline text-xs uppercase tracking-widest font-semibold flex justify-between">
                    <span className="text-ink/60">Assigned To</span>
                    <span className="text-forest">{mod._count.assignments} Founders</span>
                  </div>
                )}
              </div>
              <div className="p-4 bg-parchment/30 border-t border-hairline flex gap-2">
                <button 
                  onClick={() => setShowAssignModal(mod.id)}
                  className="flex-1 text-xs uppercase tracking-widest font-bold border border-forest text-forest py-2 hover:bg-forest hover:text-white transition-colors"
                >
                  Assign to Batch
                </button>
                <a 
                  href={mod.contentUrl} 
                  target="_blank" 
                  rel="noreferrer"
                  className="flex-1 text-center text-xs uppercase tracking-widest font-bold border border-hairline bg-white text-ink/70 py-2 hover:text-ink hover:border-ink/30 transition-colors"
                >
                  Preview
                </a>
              </div>
            </div>
          ))}
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

      {/* Assign Modal */}
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
    </div>
  );
}
