'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

type PitchEvent = {
  id: string;
  teamId: string;
  scheduledAt: string;
  venue?: string;
  notes?: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  team: { id: string; name: string; batchId: string };
  investorInterests: Array<{ id: string; investorId: string; status: string }>;
  fundingDecisions: Array<{ id: string; investorId: string; outcome: string; amount?: number }>;
};

const STATUS_STYLE: Record<string, string> = {
  SCHEDULED: 'border-forest/30 text-forest bg-forest/5',
  COMPLETED: 'border-ink/20 text-ink/50 bg-ink/5',
  CANCELLED: 'border-terracotta/30 text-terracotta bg-terracotta/5',
};

const OUTCOME_STYLE: Record<string, string> = {
  FUNDED: 'bg-forest text-white',
  PASSED: 'bg-ink/10 text-ink/60',
};

export default function AdminPitchPage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedBatch, setSelectedBatch] = useState('');
  const [teams, setTeams] = useState<any[]>([]);
  const [investors, setInvestors] = useState<any[]>([]);
  const [events, setEvents] = useState<PitchEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ teamId: '', scheduledAt: '', venue: '', notes: '' });
  const [creating, setCreating] = useState(false);

  const [selectedEvent, setSelectedEvent] = useState<PitchEvent | null>(null);
  const [interestForm, setInterestForm] = useState({ investorId: '', status: 'SHORTLISTED', notes: '' });
  const [fundingForm, setFundingForm] = useState({ investorId: '', outcome: 'FUNDED', amount: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [fundingTab, setFundingTab] = useState<'interest' | 'funding'>('interest');

  async function loadAll(batchId?: string) {
    try {
      const [bs, invs] = await Promise.all([api.getBatches(), api.getAdminInvestors(true)]);
      setBatches(bs);
      setInvestors(invs);
      const bid = batchId ?? bs[0]?.id;
      if (bid) {
        setSelectedBatch(bid);
        const [ts, evs] = await Promise.all([api.getTeamsByBatch(bid), api.listPitchEvents(undefined, bid)]);
        setTeams(ts);
        setEvents(evs);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function handleBatchChange(batchId: string) {
    setSelectedBatch(batchId);
    setEvents([]);
    const [ts, evs] = await Promise.all([api.getTeamsByBatch(batchId), api.listPitchEvents(undefined, batchId)]);
    setTeams(ts);
    setEvents(evs);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.createPitchEvent({ ...createForm, venue: createForm.venue || undefined, notes: createForm.notes || undefined });
      setShowCreate(false);
      setCreateForm({ teamId: '', scheduledAt: '', venue: '', notes: '' });
      handleBatchChange(selectedBatch);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(event: PitchEvent, status: string) {
    try {
      await api.updatePitchEventStatus(event.id, status);
      setEvents((prev) => prev.map((e) => e.id === event.id ? { ...e, status: status as any } : e));
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleInterest(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEvent) return;
    setSubmitting(true);
    try {
      await api.recordInvestorInterest(selectedEvent.id, { ...interestForm, notes: interestForm.notes || undefined });
      const evs = await api.listPitchEvents(undefined, selectedBatch);
      setEvents(evs);
      const updated = evs.find((ev: PitchEvent) => ev.id === selectedEvent.id);
      if (updated) setSelectedEvent(updated);
      setInterestForm({ investorId: '', status: 'SHORTLISTED', notes: '' });
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFunding(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEvent) return;
    setSubmitting(true);
    try {
      await api.recordFundingDecision(selectedEvent.id, {
        ...fundingForm,
        amount: fundingForm.amount ? Number(fundingForm.amount) : undefined,
        notes: fundingForm.notes || undefined,
      });
      const evs = await api.listPitchEvents(undefined, selectedBatch);
      setEvents(evs);
      const updated = evs.find((ev: PitchEvent) => ev.id === selectedEvent.id);
      if (updated) setSelectedEvent(updated);
      setFundingForm({ investorId: '', outcome: 'FUNDED', amount: '', notes: '' });
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const investorName = (id: string) => {
    const inv = investors.find((i: any) => i.id === id);
    return inv ? `${inv.firstName} ${inv.lastName}${inv.firm ? ` (${inv.firm})` : ''}` : id.slice(0, 8);
  };

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
          <h1 className="font-serif text-5xl font-bold leading-none">Pitch Calendar</h1>
          <p className="text-sm text-ink/50 mt-2">Schedule pitch events, track investor interest and funding decisions</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary px-8">
          + Schedule Pitch
        </button>
      </header>

      {/* Batch selector */}
      {batches.length > 0 && (
        <div className="mb-8 flex items-center gap-4">
          <label className="text-[11px] uppercase tracking-widest font-bold text-ink/50">Batch</label>
          <select value={selectedBatch} onChange={(e) => handleBatchChange(e.target.value)}
            className="border border-hairline bg-white text-sm px-3 py-2 text-ink outline-none">
            {batches.map((b: any) => (
              <option key={b.id} value={b.id}>Batch {b.batchNumber} — {b.name}</option>
            ))}
          </select>
        </div>
      )}

      {events.length === 0 ? (
        <div className="text-center py-20 border border-hairline bg-parchment/30">
          <p className="text-ink/60 mb-4">No pitch events scheduled for this batch.</p>
          <button onClick={() => setShowCreate(true)} className="btn btn-primary">Schedule First Pitch</button>
        </div>
      ) : (
        <div className="space-y-4">
          {events.map((event) => {
            const funded = event.fundingDecisions.filter((d) => d.outcome === 'FUNDED');
            const totalFunded = funded.reduce((sum, d) => sum + (d.amount ?? 0), 0);
            return (
              <div key={event.id} className="border border-hairline bg-white p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <p className="font-bold text-lg font-serif">{event.team.name}</p>
                      <span className={`text-[10px] uppercase tracking-widest font-bold border px-2 py-0.5 ${STATUS_STYLE[event.status]}`}>
                        {event.status}
                      </span>
                    </div>
                    <p className="text-sm text-ink/60">
                      {new Date(event.scheduledAt).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                      {' at '}
                      {new Date(event.scheduledAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      {event.venue && <span className="text-ink/40"> · {event.venue}</span>}
                    </p>
                    {event.notes && <p className="text-xs text-ink/40 mt-1">{event.notes}</p>}
                    <div className="flex items-center gap-4 mt-3">
                      <span className="text-[11px] uppercase tracking-widest font-bold text-ink/50">
                        {event.investorInterests.length} interested · {funded.length} funded
                        {totalFunded > 0 && <span className="text-forest ml-1">₹{totalFunded.toLocaleString('en-IN')}</span>}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <select
                      value={event.status}
                      onChange={(e) => handleStatusChange(event, e.target.value)}
                      className="text-[10px] uppercase tracking-widest font-bold border border-hairline px-2 py-1 outline-none bg-white text-ink"
                    >
                      <option value="SCHEDULED">Scheduled</option>
                      <option value="COMPLETED">Completed</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                    <button
                      onClick={() => { setSelectedEvent(event); setFundingTab('interest'); }}
                      className="text-[10px] uppercase tracking-widest font-bold border border-forest text-forest px-3 py-1.5 hover:bg-forest hover:text-white transition-colors"
                    >
                      Manage
                    </button>
                  </div>
                </div>

                {/* Funding decisions summary */}
                {event.fundingDecisions.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-hairline flex flex-wrap gap-2">
                    {event.fundingDecisions.map((d) => (
                      <span key={d.id} className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 ${OUTCOME_STYLE[d.outcome]}`}>
                        {investorName(d.investorId)}: {d.outcome}{d.amount ? ` ₹${d.amount.toLocaleString('en-IN')}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Pitch Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-hairline w-full max-w-md p-8">
            <h2 className="font-serif text-2xl font-bold mb-6">Schedule Pitch Event</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Team</label>
                <select required value={createForm.teamId} onChange={(e) => setCreateForm((f) => ({ ...f, teamId: e.target.value }))}
                  className="w-full border border-hairline px-3 py-2 text-sm text-ink outline-none">
                  <option value="">— Select team —</option>
                  {teams.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Date & Time</label>
                <input required type="datetime-local" value={createForm.scheduledAt}
                  onChange={(e) => setCreateForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Venue (optional)</label>
                <input value={createForm.venue} onChange={(e) => setCreateForm((f) => ({ ...f, venue: e.target.value }))}
                  placeholder="Virtual / Aryavartham HQ / Mumbai"
                  className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Notes (optional)</label>
                <textarea value={createForm.notes} onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2} className="w-full border border-hairline px-3 py-2 text-sm outline-none resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={creating} className="btn btn-primary flex-1">
                  {creating ? 'Scheduling…' : 'Schedule Pitch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Event Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-ink/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-hairline w-full max-w-lg p-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-serif text-2xl font-bold">{selectedEvent.team.name}</h2>
                <p className="text-xs text-ink/50 uppercase tracking-widest mt-0.5">
                  {new Date(selectedEvent.scheduledAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="text-ink/40 hover:text-ink text-xl">×</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-hairline mb-6">
              {(['interest', 'funding'] as const).map((t) => (
                <button key={t} onClick={() => setFundingTab(t)}
                  className={`px-5 py-2.5 text-[11px] uppercase tracking-widest font-bold border-b-2 -mb-px transition-colors ${
                    fundingTab === t ? 'border-forest text-forest' : 'border-transparent text-ink/40'
                  }`}>
                  {t === 'interest' ? 'Investor Interest' : 'Funding Decision'}
                </button>
              ))}
            </div>

            {fundingTab === 'interest' && (
              <>
                {selectedEvent.investorInterests.length > 0 && (
                  <div className="mb-6 space-y-2">
                    {selectedEvent.investorInterests.map((i) => (
                      <div key={i.id} className="flex items-center justify-between border border-hairline px-3 py-2">
                        <span className="text-sm">{investorName(i.investorId)}</span>
                        <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 ${
                          i.status === 'SHORTLISTED' ? 'bg-forest/10 text-forest' :
                          i.status === 'PASSED' ? 'bg-terracotta/10 text-terracotta' :
                          'bg-ink/5 text-ink/50'
                        }`}>{i.status}</span>
                      </div>
                    ))}
                  </div>
                )}
                <form onSubmit={handleInterest} className="space-y-3 border-t border-hairline pt-5">
                  <p className="text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-3">Record Interest</p>
                  <div>
                    <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Investor</label>
                    <select required value={interestForm.investorId} onChange={(e) => setInterestForm((f) => ({ ...f, investorId: e.target.value }))}
                      className="w-full border border-hairline px-3 py-2 text-sm text-ink outline-none">
                      <option value="">— Select investor —</option>
                      {investors.map((inv: any) => (
                        <option key={inv.id} value={inv.id}>{inv.firstName} {inv.lastName}{inv.firm ? ` · ${inv.firm}` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Status</label>
                    <select value={interestForm.status} onChange={(e) => setInterestForm((f) => ({ ...f, status: e.target.value }))}
                      className="w-full border border-hairline px-3 py-2 text-sm text-ink outline-none">
                      <option value="PENDING">Pending</option>
                      <option value="SHORTLISTED">Shortlisted</option>
                      <option value="PASSED">Passed</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Notes</label>
                    <input value={interestForm.notes} onChange={(e) => setInterestForm((f) => ({ ...f, notes: e.target.value }))}
                      className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
                  </div>
                  <button type="submit" disabled={submitting} className="btn btn-primary w-full">
                    {submitting ? 'Saving…' : 'Record Interest'}
                  </button>
                </form>
              </>
            )}

            {fundingTab === 'funding' && (
              <>
                {selectedEvent.fundingDecisions.length > 0 && (
                  <div className="mb-6 space-y-2">
                    {selectedEvent.fundingDecisions.map((d) => (
                      <div key={d.id} className="flex items-center justify-between border border-hairline px-3 py-2">
                        <span className="text-sm">{investorName(d.investorId)}</span>
                        <div className="flex items-center gap-2">
                          {d.amount && <span className="text-sm font-bold text-forest">₹{d.amount.toLocaleString('en-IN')}</span>}
                          <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 ${OUTCOME_STYLE[d.outcome]}`}>{d.outcome}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <form onSubmit={handleFunding} className="space-y-3 border-t border-hairline pt-5">
                  <p className="text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-3">Record Funding Decision</p>
                  <div>
                    <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Investor</label>
                    <select required value={fundingForm.investorId} onChange={(e) => setFundingForm((f) => ({ ...f, investorId: e.target.value }))}
                      className="w-full border border-hairline px-3 py-2 text-sm text-ink outline-none">
                      <option value="">— Select investor —</option>
                      {investors.map((inv: any) => (
                        <option key={inv.id} value={inv.id}>{inv.firstName} {inv.lastName}{inv.firm ? ` · ${inv.firm}` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Outcome</label>
                    <select value={fundingForm.outcome} onChange={(e) => setFundingForm((f) => ({ ...f, outcome: e.target.value }))}
                      className="w-full border border-hairline px-3 py-2 text-sm text-ink outline-none">
                      <option value="FUNDED">Funded</option>
                      <option value="PASSED">Passed</option>
                    </select>
                  </div>
                  {fundingForm.outcome === 'FUNDED' && (
                    <div>
                      <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Amount (₹)</label>
                      <input type="number" min={0} value={fundingForm.amount}
                        onChange={(e) => setFundingForm((f) => ({ ...f, amount: e.target.value }))}
                        placeholder="500000"
                        className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
                    </div>
                  )}
                  <div>
                    <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-1">Notes</label>
                    <input value={fundingForm.notes} onChange={(e) => setFundingForm((f) => ({ ...f, notes: e.target.value }))}
                      className="w-full border border-hairline px-3 py-2 text-sm outline-none" />
                  </div>
                  <button type="submit" disabled={submitting} className="btn btn-primary w-full">
                    {submitting ? 'Saving…' : 'Record Decision'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
