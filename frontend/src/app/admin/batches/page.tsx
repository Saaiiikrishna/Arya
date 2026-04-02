'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Plus, RefreshCw, Settings2 } from 'lucide-react';

export default function BatchesPage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAutoConfig, setShowAutoConfig] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', nickname: '', capacity: 1000 });
  const [creating, setCreating] = useState(false);

  // Auto-batch config
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoCapacity, setAutoCapacity] = useState(1000);
  const [autoNamingSequence, setAutoNamingSequence] = useState('Batch');
  const [autoNicknames, setAutoNicknames] = useState('');
  const [savingAuto, setSavingAuto] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [batchData, settings] = await Promise.all([
        api.getBatches(),
        api.getSettings(),
      ]);
      setBatches(batchData);

      setAutoEnabled(settings.auto_batch_enabled === 'true');
      setAutoCapacity(parseInt(settings.auto_batch_capacity || '1000', 10));
      setAutoNamingSequence(settings.auto_batch_naming_sequence || 'Batch');
      setAutoNicknames(
        settings.auto_batch_nicknames
          ? JSON.parse(settings.auto_batch_nicknames).join(', ')
          : ''
      );
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
      await api.createBatch({
        name: createForm.name,
        nickname: createForm.nickname || undefined,
        capacity: createForm.capacity,
      });
      setShowCreateModal(false);
      setCreateForm({ name: '', nickname: '', capacity: 1000 });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to create batch');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveAutoConfig = async () => {
    setSavingAuto(true);
    try {
      const nickArr = autoNicknames
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
      await api.updateSettings({
        auto_batch_enabled: String(autoEnabled),
        auto_batch_capacity: String(autoCapacity),
        auto_batch_naming_sequence: autoNamingSequence,
        auto_batch_nicknames: JSON.stringify(nickArr),
      });
      alert('Auto-batch config saved');
    } catch (err: any) {
      alert(err.message || 'Failed to save config');
    } finally {
      setSavingAuto(false);
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
          <h1 className="font-serif text-5xl font-bold leading-none">Network Batches</h1>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowAutoConfig(!showAutoConfig)}
            className="flex items-center gap-2 bg-white border border-hairline hover:border-forest text-ink px-5 py-3 text-xs uppercase tracking-widest font-semibold transition-colors"
          >
            <Settings2 className="w-4 h-4" /> Auto Config
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-forest text-white px-5 py-3 text-xs uppercase tracking-widest font-semibold hover:bg-forest/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Create Batch
          </button>
        </div>
      </header>

      {/* Auto-Batch Configuration */}
      {showAutoConfig && (
        <div className="mb-12 border border-hairline bg-white p-8 animate-fade-in">
          <div className="flex justify-between items-center mb-6 pb-4 border-b border-hairline">
            <h2 className="font-serif text-2xl font-bold">Auto-Create Batches</h2>
            <label className="flex items-center gap-3 cursor-pointer">
              <span className="text-xs uppercase tracking-widest font-bold text-ink/60">
                {autoEnabled ? 'ON' : 'OFF'}
              </span>
              <button
                onClick={() => setAutoEnabled(!autoEnabled)}
                className={`relative w-12 h-7 rounded-full transition-colors ${autoEnabled ? 'bg-forest' : 'bg-ink/20'}`}
              >
                <span
                  className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${autoEnabled ? 'left-6' : 'left-1'}`}
                />
              </button>
            </label>
          </div>

          {autoEnabled && (
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">
                  Applicants per Batch
                </label>
                <input
                  type="number"
                  min="10"
                  value={autoCapacity}
                  onChange={(e) => setAutoCapacity(parseInt(e.target.value) || 1000)}
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">
                  Naming Sequence
                </label>
                <input
                  type="text"
                  value={autoNamingSequence}
                  onChange={(e) => setAutoNamingSequence(e.target.value)}
                  placeholder="e.g., Batch, Cohort"
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">
                  Next 5 Batch Nicknames (comma-separated)
                </label>
                <input
                  type="text"
                  value={autoNicknames}
                  onChange={(e) => setAutoNicknames(e.target.value)}
                  placeholder="e.g., Genesis, Phoenix, Atlas, Titan, Nova"
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                />
                <p className="text-[10px] text-ink/40 mt-1">Nicknames are consumed in order as new batches are auto-created.</p>
              </div>
              <div className="md:col-span-2 flex justify-end">
                <button
                  onClick={handleSaveAutoConfig}
                  disabled={savingAuto}
                  className="bg-forest text-white px-6 py-3 text-xs uppercase tracking-widest font-semibold hover:bg-forest/90 transition-colors"
                >
                  {savingAuto ? 'Saving...' : 'Save Auto Config'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {batches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-6 border border-dashed border-ink/20 bg-parchment/50 text-center">
          <div className="text-4xl mb-4">📦</div>
          <p className="text-ink/60 uppercase tracking-widest text-xs mb-6">No batches yet. Click "Create Batch" to begin.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {batches.map((batch) => (
            <Link key={batch.id} href={`/admin/batches/${batch.id}`} className="group block h-full">
              <div className="border border-hairline bg-white p-8 h-full flex flex-col hover:border-forest hover:-translate-y-1 transition-all shadow-sm">
                <div className="flex justify-between items-start mb-4">
                  <div className="w-16 h-16 bg-ink flex items-center justify-center font-serif text-2xl text-white font-bold shadow-md">
                    #{batch.batchNumber}
                  </div>
                  <span className={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold border ${batch.status === 'PRODUCTION' ? 'bg-forest/10 text-forest border-forest/20' : 'bg-parchment text-ink/60 border-ink/20'}`}>
                    {batch.status.replace(/_/g, ' ')}
                  </span>
                </div>
                {(batch.name || batch.nickname) && (
                  <div className="mb-4">
                    {batch.name && <p className="font-serif text-lg font-bold">{batch.name}</p>}
                    {batch.nickname && <p className="text-xs text-ink/50 uppercase tracking-widest">{batch.nickname}</p>}
                  </div>
                )}
                <div className="mb-10 flex-1">
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-xs uppercase tracking-widest text-ink/60 font-semibold">Network Capacity</span>
                    <span className="font-serif text-xl font-bold">{batch.currentCount} / {batch.capacity}</span>
                  </div>
                  <div className="h-2 bg-parchment w-full shadow-inner border border-hairline">
                    <div
                      className={`h-full transition-all ${batch.status === 'PRODUCTION' ? 'bg-forest' : 'bg-ink'}`}
                      style={{ width: `${Math.min(100, (batch.currentCount / batch.capacity) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="pt-4 border-t border-hairline flex flex-wrap justify-between items-center text-[11px] uppercase tracking-widest text-ink/60 font-bold gap-3">
                  <span>{batch._count.applicants} Applic.</span>
                  <span className="w-1 h-1 bg-ink/20 rounded-full"></span>
                  <span>{batch._count.teams} Teams</span>
                  <span className="ml-auto text-forest group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create Batch Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/80 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div
            className="bg-white border-2 border-ink p-8 shadow-[8px_8px_0px_#1C1B19] w-full max-w-md animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-8 pb-4 border-b border-hairline">
              <h2 className="font-serif text-3xl font-bold">Create Batch</h2>
              <button
                className="text-2xl text-ink/40 hover:text-terracotta transition-colors leading-none"
                onClick={() => setShowCreateModal(false)}
              >×</button>
            </div>
            <form onSubmit={handleCreate} className="flex flex-col gap-6">
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Batch Name *</label>
                <input
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="e.g., Batch 1 - Genesis"
                  required
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Nickname</label>
                <input
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                  value={createForm.nickname}
                  onChange={(e) => setCreateForm({ ...createForm, nickname: e.target.value })}
                  placeholder="e.g., Genesis"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Number of Applications Allowed *</label>
                <input
                  type="number"
                  min="5"
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                  value={createForm.capacity}
                  onChange={(e) => setCreateForm({ ...createForm, capacity: parseInt(e.target.value) || 1000 })}
                  required
                />
              </div>
              <div className="flex gap-4 mt-4 pt-6 border-t border-hairline justify-end">
                <button
                  type="button"
                  className="px-6 py-3 border border-ink text-xs uppercase tracking-widest font-semibold text-ink hover:bg-parchment transition-colors"
                  onClick={() => setShowCreateModal(false)}
                >Cancel</button>
                <button
                  type="submit"
                  disabled={creating}
                  className="bg-forest hover:opacity-90 text-white px-8 py-3 text-xs uppercase tracking-widest font-semibold transition-colors"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
