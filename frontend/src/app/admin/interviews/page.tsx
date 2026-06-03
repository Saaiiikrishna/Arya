'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Calendar, Video, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

const DECISIONS = ['SELECTED', 'REJECTED', 'WAITLISTED'] as const;

function formatDT(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function decisionBadge(d: string) {
  if (d === 'SELECTED') return 'bg-forest/10 text-forest';
  if (d === 'REJECTED') return 'bg-terracotta/10 text-terracotta';
  return 'bg-ink/5 text-ink/60';
}

export default function AdminInterviewsPage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedBatch, setSelectedBatch] = useState('');
  const [tab, setTab] = useState<'slots' | 'video'>('slots');
  const [slots, setSlots] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Create slot form
  const [showCreate, setShowCreate] = useState(false);
  const [slotForm, setSlotForm] = useState({
    startTime: '', endTime: '', capacity: '5', notes: '',
  });
  const [creating, setCreating] = useState(false);

  // Decision recording
  const [decisionState, setDecisionState] = useState<Record<string, {
    decision: string; score: string; notes: string; saving: boolean;
  }>>({});

  // Video scoring
  const [videoState, setVideoState] = useState<Record<string, {
    score: string; reviewNotes: string; saving: boolean;
  }>>({});

  useEffect(() => {
    api.getBatches().then(setBatches).catch(() => {});
  }, []);

  const loadSlots = useCallback(async () => {
    if (!selectedBatch) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.getAdminInterviewSlots(selectedBatch);
      setSlots(res);
      const init: typeof decisionState = {};
      res.forEach((slot: any) => {
        slot.bookings?.forEach((b: any) => {
          init[b.id] = {
            decision: b.decision ?? '',
            score: b.score?.toString() ?? '',
            notes: b.decisionNotes ?? '',
            saving: false,
          };
        });
      });
      setDecisionState(init);
    } catch (err: any) {
      setError(err.message || 'Failed to load slots');
    } finally {
      setLoading(false);
    }
  }, [selectedBatch]);

  const loadVideos = useCallback(async () => {
    if (!selectedBatch) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.getVideoSubmissions(selectedBatch);
      setVideos(res);
      const init: typeof videoState = {};
      res.forEach((v: any) => {
        init[v.id] = {
          score: v.score?.toString() ?? '',
          reviewNotes: v.reviewNotes ?? '',
          saving: false,
        };
      });
      setVideoState(init);
    } catch (err: any) {
      setError(err.message || 'Failed to load video submissions');
    } finally {
      setLoading(false);
    }
  }, [selectedBatch]);

  useEffect(() => {
    if (!selectedBatch) return;
    if (tab === 'slots') loadSlots();
    else loadVideos();
  }, [selectedBatch, tab, loadSlots, loadVideos]);

  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBatch) return;
    const start = new Date(slotForm.startTime);
    const end = new Date(slotForm.endTime);
    if (end <= start) {
      setError('End time must be after start time');
      return;
    }
    setCreating(true);
    setError('');
    try {
      await api.createInterviewSlot({
        batchId: selectedBatch,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        capacity: parseInt(slotForm.capacity, 10),
        notes: slotForm.notes || undefined,
      });
      setShowCreate(false);
      setSlotForm({ startTime: '', endTime: '', capacity: '5', notes: '' });
      setSuccess('Slot created.');
      loadSlots();
    } catch (err: any) {
      setError(err.message || 'Failed to create slot');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSlot = async (slotId: string) => {
    if (!confirm('Delete this slot? This cannot be undone.')) return;
    setError('');
    try {
      await api.deleteInterviewSlot(slotId);
      setSuccess('Slot deleted.');
      loadSlots();
    } catch (err: any) {
      setError(err.message || 'Failed to delete slot');
    }
  };

  const handleRecordDecision = async (bookingId: string) => {
    const state = decisionState[bookingId];
    if (!state?.decision) { setError('Select a decision first'); return; }
    setError('');
    setDecisionState(prev => ({ ...prev, [bookingId]: { ...prev[bookingId], saving: true } }));
    try {
      await api.recordInterviewDecision(bookingId, {
        decision: state.decision,
        score: state.score ? parseFloat(state.score) : undefined,
        notes: state.notes || undefined,
      });
      setSuccess('Decision saved.');
      loadSlots();
    } catch (err: any) {
      setError(err.message || 'Failed to save decision');
    } finally {
      setDecisionState(prev => ({ ...prev, [bookingId]: { ...prev[bookingId], saving: false } }));
    }
  };

  const handleScoreVideo = async (videoId: string) => {
    const state = videoState[videoId];
    if (!state?.score) { setError('Enter a score first'); return; }
    setError('');
    setVideoState(prev => ({ ...prev, [videoId]: { ...prev[videoId], saving: true } }));
    try {
      await api.reviewVideoSubmission(videoId, {
        score: parseFloat(state.score),
        reviewNotes: state.reviewNotes || undefined,
      });
      setSuccess('Score saved.');
      loadVideos();
    } catch (err: any) {
      setError(err.message || 'Failed to save score');
    } finally {
      setVideoState(prev => ({ ...prev, [videoId]: { ...prev[videoId], saving: false } }));
    }
  };

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      <header className="border-b border-hairline pb-8 mb-10">
        <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
          ← Command Center
        </Link>
        <h1 className="font-serif text-5xl font-bold leading-none">Interviews</h1>
        <p className="text-ink/50 mt-3 text-lg">Manage interview slots, bookings, and async video submissions.</p>
      </header>

      {/* Batch selector */}
      <div className="mb-8 flex items-center gap-4">
        <label className="text-xs uppercase tracking-widest font-bold text-ink/60">Batch</label>
        <select
          className="form-input max-w-[280px]"
          value={selectedBatch}
          onChange={e => { setSelectedBatch(e.target.value); setExpandedSlot(null); }}
        >
          <option value="">— Select batch —</option>
          {batches.map(b => (
            <option key={b.id} value={b.id}>Batch #{b.batchNumber} ({b.status.replace('_', ' ')})</option>
          ))}
        </select>
      </div>

      {(error || success) && (
        <div className={`mb-6 px-5 py-3 border text-sm ${error ? 'border-terracotta/30 bg-terracotta/10 text-terracotta' : 'border-forest/30 bg-forest/10 text-forest'}`}>
          {error || success}
        </div>
      )}

      {!selectedBatch ? (
        <div className="text-center py-20 border border-hairline bg-parchment/30">
          <p className="text-ink/50">Select a batch to manage its interviews.</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-0 border-b border-hairline mb-8">
            {(['slots', 'video'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-8 py-3 text-xs uppercase tracking-widest font-bold transition-colors border-b-2 -mb-px ${
                  tab === t ? 'border-saffron text-saffron-deep' : 'border-transparent text-ink/40 hover:text-terracotta-warm'
                }`}
              >
                {t === 'slots' ? (
                  <span className="flex items-center gap-2"><Calendar className="w-4 h-4" /> Live Slots</span>
                ) : (
                  <span className="flex items-center gap-2"><Video className="w-4 h-4" /> Async Videos</span>
                )}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-forest border-t-transparent rounded-full animate-spin" />
            </div>
          ) : tab === 'slots' ? (
            /* ── Slots Tab ── */
            <div>
              <div className="flex justify-end mb-6">
                <button onClick={() => setShowCreate(true)} className="btn btn-primary flex items-center gap-2 px-6">
                  <Plus className="w-4 h-4" /> Create Slot
                </button>
              </div>

              {slots.length === 0 ? (
                <div className="text-center py-16 border border-hairline bg-parchment/30">
                  <Calendar className="w-10 h-10 text-ink/20 mx-auto mb-4" />
                  <p className="text-ink/50 mb-4">No slots created for this batch yet.</p>
                  <button onClick={() => setShowCreate(true)} className="btn btn-secondary bg-white border border-hairline">
                    Create First Slot
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {slots.map((slot: any) => {
                    const bookings = slot.bookings ?? [];
                    const isExpanded = expandedSlot === slot.id;
                    return (
                      <div key={slot.id} className="border border-hairline bg-white">
                        <div className="px-6 py-5 flex items-center gap-6">
                          <div className="flex-1">
                            <p className="font-bold">{formatDT(slot.startTime)}</p>
                            <p className="text-xs text-ink/50 mt-1">
                              Ends {new Date(slot.endTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                              &nbsp;·&nbsp;
                              {bookings.length}/{slot.capacity} booked
                            </p>
                            {slot.notes && <p className="text-xs text-ink/40 italic mt-1">{slot.notes}</p>}
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 ${
                              bookings.length >= slot.capacity ? 'bg-ink/10 text-ink/60' : 'bg-saffron/10 text-saffron-deep'
                            }`}>
                              {bookings.length >= slot.capacity ? 'Full' : `${slot.capacity - bookings.length} open`}
                            </span>
                            {bookings.length === 0 && (
                              <button
                                onClick={() => handleDeleteSlot(slot.id)}
                                className="p-2 text-terracotta hover:bg-terracotta/10 transition-colors"
                                title="Delete slot"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                            {bookings.length > 0 && (
                              <button
                                onClick={() => setExpandedSlot(isExpanded ? null : slot.id)}
                                className="p-2 text-ink/40 hover:text-ink transition-colors"
                              >
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            )}
                          </div>
                        </div>

                        {isExpanded && bookings.length > 0 && (
                          <div className="border-t border-hairline divide-y divide-hairline">
                            {bookings.map((booking: any) => {
                              const ds = decisionState[booking.id] ?? { decision: '', score: '', notes: '', saving: false };
                              const applicant = booking.applicant;
                              return (
                                <div key={booking.id} className="px-6 py-5 bg-parchment/30">
                                  <div className="flex items-start gap-6">
                                    <div className="flex-1">
                                      <p className="font-bold text-sm">
                                        {applicant?.user?.firstName} {applicant?.user?.lastName}
                                      </p>
                                      <p className="text-xs text-ink/50">{applicant?.user?.email}</p>
                                      {booking.decision && (
                                        <span className={`inline-block mt-2 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 ${decisionBadge(booking.decision)}`}>
                                          {booking.decision}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-end gap-3 flex-shrink-0">
                                      <div>
                                        <label className="block text-[10px] uppercase tracking-widest text-ink/50 mb-1">Decision</label>
                                        <select
                                          className="form-input py-1.5 text-sm"
                                          value={ds.decision}
                                          onChange={e => setDecisionState(prev => ({ ...prev, [booking.id]: { ...prev[booking.id], decision: e.target.value } }))}
                                        >
                                          <option value="">— Select —</option>
                                          {DECISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                      </div>
                                      <div>
                                        <label className="block text-[10px] uppercase tracking-widest text-ink/50 mb-1">Score /10</label>
                                        <input
                                          type="number" min="0" max="10" step="0.5"
                                          className="form-input py-1.5 text-sm w-20"
                                          placeholder="—"
                                          value={ds.score}
                                          onChange={e => setDecisionState(prev => ({ ...prev, [booking.id]: { ...prev[booking.id], score: e.target.value } }))}
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[10px] uppercase tracking-widest text-ink/50 mb-1">Notes</label>
                                        <input
                                          type="text"
                                          className="form-input py-1.5 text-sm w-48"
                                          placeholder="Optional notes"
                                          value={ds.notes}
                                          onChange={e => setDecisionState(prev => ({ ...prev, [booking.id]: { ...prev[booking.id], notes: e.target.value } }))}
                                        />
                                      </div>
                                      <button
                                        onClick={() => handleRecordDecision(booking.id)}
                                        disabled={ds.saving || !ds.decision}
                                        className="btn btn-primary px-4 py-1.5 text-xs disabled:opacity-50"
                                      >
                                        {ds.saving ? 'Saving…' : 'Save'}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* ── Video Submissions Tab ── */
            <div>
              {videos.length === 0 ? (
                <div className="text-center py-16 border border-hairline bg-parchment/30">
                  <Video className="w-10 h-10 text-ink/20 mx-auto mb-4" />
                  <p className="text-ink/50">No video submissions for this batch yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {videos.map((v: any) => {
                    const vs = videoState[v.id] ?? { score: '', reviewNotes: '', saving: false };
                    const urls = [v.videoUrl1, v.videoUrl2, v.videoUrl3].filter(Boolean);
                    return (
                      <div key={v.id} className="border border-hairline bg-white p-6">
                        <div className="flex items-start gap-6">
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm">
                              {v.applicant?.user?.firstName} {v.applicant?.user?.lastName}
                            </p>
                            <p className="text-xs text-ink/50 mb-4">{v.applicant?.user?.email}</p>
                            <div className="flex flex-wrap gap-3">
                              {urls.map((url: string, i: number) => (
                                <a
                                  key={i}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs font-bold uppercase tracking-widest text-forest border border-forest px-3 py-1 hover:bg-forest hover:text-white transition-colors"
                                >
                                  Video {i + 1}
                                </a>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-end gap-3 flex-shrink-0">
                            <div>
                              <label className="block text-[10px] uppercase tracking-widest text-ink/50 mb-1">Score /10</label>
                              <input
                                type="number" min="0" max="10" step="0.5"
                                className="form-input py-1.5 text-sm w-20"
                                placeholder="—"
                                value={vs.score}
                                onChange={e => setVideoState(prev => ({ ...prev, [v.id]: { ...prev[v.id], score: e.target.value } }))}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] uppercase tracking-widest text-ink/50 mb-1">Review Notes</label>
                              <input
                                type="text"
                                className="form-input py-1.5 text-sm w-56"
                                placeholder="Optional notes"
                                value={vs.reviewNotes}
                                onChange={e => setVideoState(prev => ({ ...prev, [v.id]: { ...prev[v.id], reviewNotes: e.target.value } }))}
                              />
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              {v.score !== null && v.score !== undefined && (
                                <span className="text-xs text-ink/50">Current: {v.score}/10</span>
                              )}
                              <button
                                onClick={() => handleScoreVideo(v.id)}
                                disabled={vs.saving || !vs.score}
                                className="btn btn-primary px-4 py-1.5 text-xs disabled:opacity-50"
                              >
                                {vs.saving ? 'Saving…' : 'Save Score'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Create Slot Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Create Interview Slot</h2>
            <form onSubmit={handleCreateSlot} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">Start Time</label>
                  <input
                    type="datetime-local"
                    className="form-input"
                    required
                    value={slotForm.startTime}
                    onChange={e => setSlotForm({ ...slotForm, startTime: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">End Time</label>
                  <input
                    type="datetime-local"
                    className="form-input"
                    required
                    value={slotForm.endTime}
                    onChange={e => setSlotForm({ ...slotForm, endTime: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Capacity (max bookings)</label>
                <input
                  type="number" min="1" max="50"
                  className="form-input"
                  required
                  value={slotForm.capacity}
                  onChange={e => setSlotForm({ ...slotForm, capacity: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Notes (optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Zoom link, panel members…"
                  value={slotForm.notes}
                  onChange={e => setSlotForm({ ...slotForm, notes: e.target.value })}
                />
              </div>
              <div className="modal-actions mt-4">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating…' : 'Create Slot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
