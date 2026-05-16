"use client";

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { ArrowLeft, Users2, Mail, Plus, X, Clock, CheckCircle2 } from 'lucide-react';

const RESOURCE_TYPES = [
  { value: 'INFRASTRUCTURE', label: 'Infrastructure' },
  { value: 'TOOLING', label: 'Tooling / Software' },
  { value: 'WORKSPACE', label: 'Workspace / Space' },
  { value: 'EXPERT', label: 'Expert / Advisor' },
  { value: 'LEGAL', label: 'Legal / Compliance' },
  { value: 'MARKETING', label: 'Marketing / PR' },
  { value: 'OTHER', label: 'Other' },
] as const;

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'border-ink/20 text-ink/50',
  IN_REVIEW: 'border-terracotta/40 text-terracotta',
  FULFILLED: 'border-forest/40 text-forest',
  REJECTED: 'border-ink/30 text-ink/40',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  IN_REVIEW: 'In Review',
  FULFILLED: 'Fulfilled',
  REJECTED: 'Rejected',
};

export default function HubCoFounderPage() {
  const [coFounder, setCoFounder] = useState<any>(null);
  const [team, setTeam] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'OTHER', description: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const hub = await api.getMyHub();
        const t = hub?.team ?? null;
        setTeam(t);
        setCoFounder(t?.coFounder ?? null);
        if (t?.id) {
          const reqs = await api.getTeamResourceRequests(t.id);
          setRequests(reqs);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSubmit() {
    if (!team?.id || !form.description.trim()) return;
    setSubmitting(true);
    try {
      const newReq = await api.submitResourceRequest(team.id, form);
      setRequests((prev) => [newReq, ...prev]);
      setForm({ type: 'OTHER', description: '' });
      setShowForm(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return (
    <Layout activeTab="hub">
      <div className="p-12 text-center text-ink/40 uppercase tracking-widest text-sm">Loading Co-Founder...</div>
    </Layout>
  );

  if (!team) return (
    <Layout activeTab="hub">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Link href="/hub" className="inline-flex items-center gap-2 text-ink/60 hover:text-ink mb-8 text-[13px] uppercase tracking-widest font-bold">
          <ArrowLeft className="w-4 h-4" /> Return to Hub
        </Link>
        <div className="text-center py-20 border border-dashed border-ink/20">
          <p className="text-ink/40 uppercase tracking-widest text-xs">You haven't been assigned to a team yet</p>
        </div>
      </div>
    </Layout>
  );

  return (
    <Layout activeTab="hub">
      <div className="max-w-5xl mx-auto px-6 py-12 space-y-10">
        <div>
          <Link href="/hub" className="inline-flex items-center gap-2 text-ink/60 hover:text-ink mb-6 text-[13px] uppercase tracking-widest font-bold">
            <ArrowLeft className="w-4 h-4" /> Return to Hub
          </Link>
          <h1 className="text-4xl font-serif font-black flex items-center gap-3">
            <Users2 className="w-8 h-8 text-forest" />
            Aryavartham Co-Founder
          </h1>
          <p className="text-ink/50 mt-1 text-sm uppercase tracking-widest">{team.name}</p>
        </div>

        {/* Co-Founder card */}
        {!coFounder ? (
          <div className="text-center py-20 border border-dashed border-ink/20">
            <Users2 className="w-10 h-10 text-ink/20 mx-auto mb-4" />
            <p className="text-ink/40 uppercase tracking-widest text-xs mb-2">No co-founder assigned yet</p>
            <p className="text-ink/30 text-xs">A co-founder is assigned after your team is locked in</p>
          </div>
        ) : (
          <div className="border border-ink/10 p-8">
            <div className="flex items-start gap-6">
              <div className="w-16 h-16 border border-ink/20 flex items-center justify-center shrink-0 bg-forest/5">
                <span className="text-2xl font-serif font-black text-forest">
                  {coFounder.firstName?.[0]}{coFounder.lastName?.[0]}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-widest font-bold text-forest mb-1">Aryavartham Co-Founder</p>
                <h2 className="text-2xl font-serif font-bold">
                  {coFounder.firstName} {coFounder.lastName}
                </h2>
                <a
                  href={`mailto:${coFounder.email}`}
                  className="inline-flex items-center gap-2 text-forest hover:underline mt-2 text-sm"
                >
                  <Mail className="w-3.5 h-3.5" />
                  {coFounder.email}
                </a>
                {coFounder.bio && (
                  <p className="mt-4 text-sm text-ink/60 leading-relaxed">{coFounder.bio}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Resource Requests */}
        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xs uppercase tracking-widest font-bold text-ink/60">Resource Requests</h2>
            <button
              onClick={() => setShowForm(true)}
              className="text-[11px] uppercase tracking-widest font-bold text-forest hover:underline flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Request Resource
            </button>
          </div>

          {showForm && (
            <div className="border border-ink/20 p-5 mb-4 space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-2">Resource Type</label>
                <div className="flex flex-wrap gap-2">
                  {RESOURCE_TYPES.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setForm((f) => ({ ...f, type: value }))}
                      className={`text-[11px] px-3 py-1 border uppercase tracking-widest font-bold transition-colors ${
                        form.type === value
                          ? 'bg-ink text-parchment border-ink'
                          : 'border-ink/20 text-ink/50 hover:border-ink/50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-2">Description</label>
                <textarea
                  className="w-full border-b border-ink/20 bg-transparent py-2 text-sm outline-none resize-none placeholder:text-ink/30"
                  rows={3}
                  placeholder="Describe what you need and why..."
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="text-[11px] uppercase tracking-widest text-ink/40 hover:text-ink px-3 py-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !form.description.trim()}
                  className="text-[11px] uppercase tracking-widest font-bold bg-forest text-parchment px-4 py-1 disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </div>
          )}

          {requests.length === 0 && !showForm ? (
            <p className="text-ink/30 text-sm">No resource requests yet</p>
          ) : (
            <div className="divide-y divide-ink/10 border border-ink/10">
              {requests.map((r: any) => (
                <div key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1.5">
                        <span className="text-[11px] uppercase tracking-widest font-bold text-ink/50">
                          {RESOURCE_TYPES.find((t) => t.value === r.type)?.label ?? r.type}
                        </span>
                        <span className={`text-[10px] uppercase tracking-widest font-bold border px-2 py-0.5 ${STATUS_STYLES[r.status] ?? 'border-ink/20 text-ink/40'}`}>
                          {STATUS_LABELS[r.status] ?? r.status}
                        </span>
                      </div>
                      <p className="text-sm text-ink/80">{r.description}</p>
                      {r.notes && (
                        <p className="text-xs text-ink/50 mt-2 border-l-2 border-forest/30 pl-3">{r.notes}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      {r.status === 'FULFILLED' ? (
                        <CheckCircle2 className="w-4 h-4 text-forest" />
                      ) : (
                        <Clock className="w-4 h-4 text-ink/30" />
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-ink/30 mt-2 uppercase tracking-widest">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Role explanation */}
        <div className="border border-ink/10 p-6 bg-parchment/50">
          <p className="text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-3">What your co-founder does</p>
          <ul className="text-sm text-ink/60 space-y-1.5 list-disc list-inside">
            <li>Holds co-founder responsibilities — they are part of your team, not above it</li>
            <li>Sources and requests all resources (infra, tools, workspace, experts) on your behalf</li>
            <li>Reports team performance and blockers to the platform weekly</li>
            <li>Verifies your weekly check-ins for platform records</li>
            <li>Bridges communication between your team and Aryavartham</li>
          </ul>
        </div>
      </div>
    </Layout>
  );
}
