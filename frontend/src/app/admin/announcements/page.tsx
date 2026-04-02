'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Plus, Megaphone, Pencil, Trash2 } from 'lucide-react';

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({
    title: '',
    content: '',
    deadline: '',
    batchId: '',
    sendEmail: true,
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [ann, batchData] = await Promise.all([
        api.getAnnouncements(),
        api.getBatches(),
      ]);
      setAnnouncements(ann);
      setBatches(batchData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.createAnnouncement({
        title: form.title,
        content: form.content,
        deadline: form.deadline || undefined,
        batchId: form.batchId || undefined,
        sendEmail: form.sendEmail,
      });
      setShowCreateModal(false);
      setForm({ title: '', content: '', deadline: '', batchId: '', sendEmail: true });
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this announcement?')) return;
    try {
      await api.deleteAnnouncement(id);
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    try {
      await api.updateAnnouncement(id, { isActive: !isActive });
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) return <div className="loading-page"><div className="spinner" /> Loading...</div>;

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      <header className="border-b border-hairline pb-8 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none flex items-center gap-4">
            <Megaphone className="w-10 h-10" />
            Announcements
          </h1>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-forest text-white px-5 py-3 text-xs uppercase tracking-widest font-semibold hover:bg-forest/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Announcement
        </button>
      </header>

      {announcements.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 border border-dashed border-ink/20 bg-parchment/50 text-center">
          <div className="text-4xl mb-4">📢</div>
          <p className="text-ink/60 uppercase tracking-widest text-xs">No announcements yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {announcements.map((ann) => (
            <div
              key={ann.id}
              className={`bg-white border p-6 hover:shadow-sm transition-shadow ${ann.isActive ? 'border-hairline' : 'border-ink/10 opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-serif text-xl font-bold">{ann.title}</h3>
                    {ann.isActive ? (
                      <span className="text-[10px] uppercase tracking-widest font-bold text-forest bg-forest/10 px-2 py-0.5 border border-forest/20">Active</span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40 bg-ink/5 px-2 py-0.5 border border-ink/10">Inactive</span>
                    )}
                    {ann.batchId && (
                      <span className="text-[10px] uppercase tracking-widest font-bold text-terracotta bg-terracotta/10 px-2 py-0.5 border border-terracotta/20">
                        Batch-specific
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-ink/60 leading-relaxed mb-3">{ann.content}</p>
                  <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest text-ink/40 font-semibold">
                    <span>Created {new Date(ann.createdAt).toLocaleDateString()}</span>
                    {ann.deadline && (
                      <span className="text-terracotta">⏰ Deadline: {new Date(ann.deadline).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggle(ann.id, ann.isActive)}
                    className={`p-2 text-xs uppercase tracking-widest font-bold border transition-colors ${ann.isActive ? 'border-ink/20 text-ink/40 hover:text-terracotta hover:border-terracotta' : 'border-forest/20 text-forest hover:bg-forest/10'}`}
                  >
                    {ann.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => handleDelete(ann.id)}
                    className="p-2 text-ink/30 hover:text-terracotta transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Announcement Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/80 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white border-2 border-ink p-8 shadow-[8px_8px_0px_#1C1B19] w-full max-w-lg animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-8 pb-4 border-b border-hairline">
              <h2 className="font-serif text-3xl font-bold">New Announcement</h2>
              <button className="text-2xl text-ink/40 hover:text-terracotta transition-colors leading-none" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate} className="flex flex-col gap-6">
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Title *</label>
                <input
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Content *</label>
                <textarea
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors resize-y min-h-[100px]"
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  required
                  rows={4}
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Deadline (optional)</label>
                <input
                  type="datetime-local"
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                  value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Target Batch (optional)</label>
                <select
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                  value={form.batchId}
                  onChange={(e) => setForm({ ...form, batchId: e.target.value })}
                >
                  <option value="">All Participants (Global)</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      Batch #{b.batchNumber} {b.name ? `- ${b.name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.sendEmail}
                  onChange={(e) => setForm({ ...form, sendEmail: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-xs uppercase tracking-widest font-semibold text-ink/60">
                  Send email notification to all participants
                </span>
              </label>
              <div className="flex gap-4 mt-2 pt-6 border-t border-hairline justify-end">
                <button type="button" onClick={() => setShowCreateModal(false)} className="px-6 py-3 border border-ink text-xs uppercase tracking-widest font-semibold">Cancel</button>
                <button type="submit" disabled={creating} className="bg-forest hover:opacity-90 text-white px-8 py-3 text-xs uppercase tracking-widest font-semibold">
                  {creating ? 'Publishing...' : 'Publish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
