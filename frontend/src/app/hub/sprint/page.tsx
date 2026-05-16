"use client";

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { ArrowLeft, CheckCircle2, Circle, AlertTriangle, ClipboardCheck, Plus, X } from 'lucide-react';

const SEVERITY_COLORS: Record<string, string> = {
  HIGH: 'border-terracotta text-terracotta',
  MED: 'border-ink/40 text-ink/70',
  LOW: 'border-ink/20 text-ink/40',
};

export default function HubSprintPage() {
  const [data, setData] = useState<{ sprint: any; blockers: any[]; checkIns: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamId, setTeamId] = useState<string | null>(null);

  // New blocker form
  const [showBlockerForm, setShowBlockerForm] = useState(false);
  const [blockerForm, setBlockerForm] = useState({ description: '', severity: 'MED' });
  const [submittingBlocker, setSubmittingBlocker] = useState(false);

  // Milestone completion
  const [completingMilestone, setCompletingMilestone] = useState<string | null>(null);

  // Check-in form
  const [showCheckInForm, setShowCheckInForm] = useState(false);
  const [checkInText, setCheckInText] = useState('');
  const [submittingCheckIn, setSubmittingCheckIn] = useState(false);

  const currentWeek = Math.ceil((Date.now() - new Date('2024-01-01').getTime()) / (7 * 24 * 60 * 60 * 1000));

  useEffect(() => {
    async function load() {
      try {
        const [dashboard, hub] = await Promise.all([
          api.getMySprintDashboard(),
          api.getMyHub(),
        ]);
        setData(dashboard);
        setTeamId(hub?.team?.id ?? null);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleLogBlocker() {
    if (!teamId || !blockerForm.description.trim()) return;
    setSubmittingBlocker(true);
    try {
      const newBlocker = await api.logBlocker(teamId, { week: currentWeek, ...blockerForm });
      setData((prev) => prev ? { ...prev, blockers: [newBlocker, ...prev.blockers] } : prev);
      setBlockerForm({ description: '', severity: 'MED' });
      setShowBlockerForm(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmittingBlocker(false);
    }
  }

  async function handleResolveBlocker(blockerId: string) {
    try {
      await api.resolveBlocker(blockerId);
      setData((prev) => prev
        ? { ...prev, blockers: prev.blockers.filter((b) => b.id !== blockerId) }
        : prev
      );
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleCompleteMilestone(milestoneId: string) {
    setCompletingMilestone(milestoneId);
    try {
      await api.completeMilestone(milestoneId);
      setData((prev) => {
        if (!prev) return prev;
        const updatedMilestones = prev.sprint.milestones.map((m: any) =>
          m.id === milestoneId ? { ...m, isCompleted: true, completedAt: new Date().toISOString() } : m
        );
        return { ...prev, sprint: { ...prev.sprint, milestones: updatedMilestones } };
      });
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCompletingMilestone(null);
    }
  }

  async function handleSubmitCheckIn() {
    if (!teamId || !checkInText.trim()) return;
    setSubmittingCheckIn(true);
    try {
      const checkIn = await api.submitCheckIn(teamId, { week: currentWeek, progressSummary: checkInText });
      setData((prev) => prev ? { ...prev, checkIns: [checkIn, ...prev.checkIns] } : prev);
      setCheckInText('');
      setShowCheckInForm(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmittingCheckIn(false);
    }
  }

  if (loading) return (
    <Layout activeTab="hub">
      <div className="p-12 text-center text-ink/40 uppercase tracking-widest text-sm">Loading Sprint...</div>
    </Layout>
  );

  if (!data?.sprint) return (
    <Layout activeTab="hub">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Link href="/hub" className="inline-flex items-center gap-2 text-ink/60 hover:text-ink mb-8 text-[13px] uppercase tracking-widest font-bold">
          <ArrowLeft className="w-4 h-4" /> Return to Hub
        </Link>
        <div className="text-center py-20 border border-dashed border-ink/20">
          <p className="text-ink/40 uppercase tracking-widest text-xs">No active sprint found</p>
          <p className="text-ink/30 text-xs mt-2">Your sprint will appear once your team is locked in</p>
        </div>
      </div>
    </Layout>
  );

  const { sprint, blockers, checkIns } = data;
  const milestones = sprint.milestones ?? [];
  const completedCount = milestones.filter((m: any) => m.isCompleted).length;
  const totalCount = milestones.length;

  return (
    <Layout activeTab="hub">
      <div className="max-w-5xl mx-auto px-6 py-12 space-y-12">
        <div>
          <Link href="/hub" className="inline-flex items-center gap-2 text-ink/60 hover:text-ink mb-8 text-[13px] uppercase tracking-widest font-bold">
            <ArrowLeft className="w-4 h-4" /> Return to Hub
          </Link>
          <h1 className="text-4xl font-serif font-black">Sprint Dashboard</h1>
          <p className="text-ink/50 mt-1 text-sm uppercase tracking-widest">
            {new Date(sprint.startDate).toLocaleDateString()} – {new Date(sprint.endDate).toLocaleDateString()}
          </p>
        </div>

        {/* Progress bar */}
        <div className="border border-ink/10 p-6">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs uppercase tracking-widest font-bold text-ink/60">Milestone Progress</span>
            <span className="text-xs text-ink/60">{completedCount}/{totalCount}</span>
          </div>
          <div className="h-1 bg-ink/10 w-full">
            <div
              className="h-1 bg-forest transition-all"
              style={{ width: totalCount ? `${(completedCount / totalCount) * 100}%` : '0%' }}
            />
          </div>
        </div>

        {/* Milestones */}
        <section>
          <h2 className="text-xs uppercase tracking-widest font-bold text-ink/60 mb-4">Milestones</h2>
          {milestones.length === 0 ? (
            <p className="text-ink/30 text-sm">No milestones set yet</p>
          ) : (
            <div className="divide-y divide-ink/10 border border-ink/10">
              {milestones.map((m: any) => (
                <div key={m.id} className="flex items-start gap-4 p-4">
                  {m.isCompleted
                    ? <CheckCircle2 className="w-5 h-5 text-forest mt-0.5 shrink-0" />
                    : (
                      <button
                        onClick={() => handleCompleteMilestone(m.id)}
                        disabled={completingMilestone === m.id}
                        title="Mark complete"
                        className="mt-0.5 shrink-0 hover:text-forest transition-colors text-ink/30 disabled:opacity-50"
                      >
                        <Circle className="w-5 h-5" />
                      </button>
                    )}
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium ${m.isCompleted ? 'line-through text-ink/40' : 'text-ink'}`}>{m.title}</p>
                    {m.description && <p className="text-xs text-ink/50 mt-1">{m.description}</p>}
                    <p className="text-[11px] text-ink/40 mt-1 uppercase tracking-widest">
                      Due {new Date(m.deadline).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Active blockers */}
        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xs uppercase tracking-widest font-bold text-ink/60">Active Blockers</h2>
            <button
              onClick={() => setShowBlockerForm(true)}
              className="text-[11px] uppercase tracking-widest font-bold text-forest hover:underline flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Log Blocker
            </button>
          </div>

          {showBlockerForm && (
            <div className="border border-ink/20 p-5 mb-4 space-y-3">
              <textarea
                className="w-full border-b border-ink/20 bg-transparent py-2 text-sm outline-none resize-none placeholder:text-ink/30"
                rows={3}
                placeholder="Describe the blocker..."
                value={blockerForm.description}
                onChange={(e) => setBlockerForm((f) => ({ ...f, description: e.target.value }))}
              />
              <div className="flex gap-3">
                {(['HIGH', 'MED', 'LOW'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setBlockerForm((f) => ({ ...f, severity: s }))}
                    className={`text-[11px] px-3 py-1 border uppercase tracking-widest font-bold transition-colors ${
                      blockerForm.severity === s ? 'bg-ink text-parchment border-ink' : 'border-ink/20 text-ink/50 hover:border-ink/50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
                <div className="ml-auto flex gap-2">
                  <button onClick={() => setShowBlockerForm(false)} className="text-[11px] uppercase tracking-widest text-ink/40 hover:text-ink px-3 py-1">Cancel</button>
                  <button
                    onClick={handleLogBlocker}
                    disabled={submittingBlocker}
                    className="text-[11px] uppercase tracking-widest font-bold bg-forest text-parchment px-4 py-1 disabled:opacity-50"
                  >
                    {submittingBlocker ? 'Logging...' : 'Log'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {blockers.length === 0 && !showBlockerForm ? (
            <p className="text-ink/30 text-sm">No active blockers</p>
          ) : (
            <div className="space-y-2">
              {blockers.map((b: any) => (
                <div key={b.id} className={`flex items-start gap-4 p-4 border ${SEVERITY_COLORS[b.severity] ?? 'border-ink/10'}`}>
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink">{b.description}</p>
                    <p className="text-[11px] text-ink/40 mt-1 uppercase tracking-widest">Week {b.week} · {b.severity}</p>
                  </div>
                  <button
                    onClick={() => handleResolveBlocker(b.id)}
                    title="Mark resolved"
                    className="text-ink/30 hover:text-forest transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Weekly check-in */}
        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xs uppercase tracking-widest font-bold text-ink/60">Weekly Check-ins</h2>
            <button
              onClick={() => setShowCheckInForm(true)}
              className="text-[11px] uppercase tracking-widest font-bold text-forest hover:underline flex items-center gap-1"
            >
              <ClipboardCheck className="w-3 h-3" /> Submit Check-in
            </button>
          </div>

          {showCheckInForm && (
            <div className="border border-ink/20 p-5 mb-4 space-y-3">
              <textarea
                className="w-full border-b border-ink/20 bg-transparent py-2 text-sm outline-none resize-none placeholder:text-ink/30"
                rows={4}
                placeholder="Summarise this week's progress..."
                value={checkInText}
                onChange={(e) => setCheckInText(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCheckInForm(false)} className="text-[11px] uppercase tracking-widest text-ink/40 hover:text-ink px-3 py-1">Cancel</button>
                <button
                  onClick={handleSubmitCheckIn}
                  disabled={submittingCheckIn}
                  className="text-[11px] uppercase tracking-widest font-bold bg-forest text-parchment px-4 py-1 disabled:opacity-50"
                >
                  {submittingCheckIn ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </div>
          )}

          {checkIns.length === 0 && !showCheckInForm ? (
            <p className="text-ink/30 text-sm">No check-ins submitted yet</p>
          ) : (
            <div className="divide-y divide-ink/10 border border-ink/10">
              {checkIns.map((c: any) => (
                <div key={c.id} className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[11px] uppercase tracking-widest font-bold text-ink/50">Week {c.week}</span>
                    {c.coFounderVerified && (
                      <span className="text-[10px] uppercase tracking-widest text-forest font-bold">Verified</span>
                    )}
                  </div>
                  <p className="text-sm text-ink/80">{c.progressSummary}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
