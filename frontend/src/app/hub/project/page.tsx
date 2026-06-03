"use client";

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { ArrowLeft, Pencil, X, Check, Rocket } from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  UNDER_DEVELOPMENT: 'Under Development',
  TESTING: 'Testing',
  LAUNCHED: 'Launched',
  TRAINING: 'Training',
};

export default function HubProjectPage() {
  const [project, setProject] = useState<any>(null);
  const [team, setTeam] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    projectName: string;
    targetMarket: string;
    description: string;
    estimatedFunds: string;
  }>({ projectName: '', targetMarket: '', description: '', estimatedFunds: '' });

  const isLeader = team?.leaderId === team?.myId;

  useEffect(() => {
    async function load() {
      try {
        const hub = await api.getMyHub();
        const t = hub?.team ?? null;
        setTeam(t);
        setProject(t?.project ?? null);
        if (t?.project) {
          setForm({
            projectName: t.project.projectName ?? '',
            targetMarket: t.project.targetMarket ?? '',
            description: t.project.description ?? '',
            estimatedFunds: String(t.project.estimatedFunds ?? ''),
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave() {
    if (!team?.id) return;
    setSaving(true);
    try {
      const updated = await api.updateTeamProject(team.id, {
        projectName: form.projectName,
        targetMarket: form.targetMarket,
        description: form.description,
        estimatedFunds: parseFloat(form.estimatedFunds) || 0,
      });
      setProject(updated);
      setEditing(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (project) {
      setForm({
        projectName: project.projectName ?? '',
        targetMarket: project.targetMarket ?? '',
        description: project.description ?? '',
        estimatedFunds: String(project.estimatedFunds ?? ''),
      });
    }
    setEditing(false);
  }

  if (loading) return (
    <Layout activeTab="hub">
      <div className="p-12 text-center text-ink/40 uppercase tracking-widest text-sm">Loading Project...</div>
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
        <div className="flex items-start justify-between">
          <div>
            <Link href="/hub" className="inline-flex items-center gap-2 text-ink/60 hover:text-ink mb-6 text-[13px] uppercase tracking-widest font-bold">
              <ArrowLeft className="w-4 h-4" /> Return to Hub
            </Link>
            <h1 className="text-4xl font-serif font-black flex items-center gap-3">
              <Rocket className="w-8 h-8 text-forest" />
              {project?.projectName ?? 'Your Project'}
            </h1>
            {project && (
              <span className="inline-block mt-2 text-[11px] uppercase tracking-widest font-bold border border-ink/20 px-2 py-0.5 text-ink/60">
                {STATUS_LABELS[project.status] ?? project.status}
              </span>
            )}
          </div>

          {isLeader && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold border border-ink/20 px-4 py-2 hover:border-forest hover:text-forest transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
          {editing && (
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-bold border border-ink/20 px-4 py-2 text-ink/50 hover:text-ink"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-bold bg-forest text-parchment px-4 py-2 disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {!project && !editing ? (
          <div className="text-center py-20 border border-dashed border-ink/20">
            <p className="text-ink/40 uppercase tracking-widest text-xs mb-4">No project details yet</p>
            {isLeader && (
              <button
                onClick={() => setEditing(true)}
                className="text-[11px] uppercase tracking-widest font-bold text-forest hover:underline"
              >
                Add Project Details
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8">
            {/* Project Name */}
            <div className="border-b border-ink/10 pb-6">
              <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-2">Project Name</label>
              {editing ? (
                <input
                  type="text"
                  value={form.projectName}
                  onChange={(e) => setForm((f) => ({ ...f, projectName: e.target.value }))}
                  className="w-full border-b border-ink/30 bg-transparent py-2 text-2xl font-serif font-bold outline-none focus:border-forest"
                />
              ) : (
                <p className="text-2xl font-serif font-bold">{project?.projectName}</p>
              )}
            </div>

            {/* Target Market */}
            <div className="border-b border-ink/10 pb-6">
              <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-2">Target Market</label>
              {editing ? (
                <input
                  type="text"
                  value={form.targetMarket}
                  onChange={(e) => setForm((f) => ({ ...f, targetMarket: e.target.value }))}
                  className="w-full border-b border-ink/30 bg-transparent py-2 text-base outline-none focus:border-forest"
                  placeholder="Who is this for?"
                />
              ) : (
                <p className="text-base text-ink/80">{project?.targetMarket}</p>
              )}
            </div>

            {/* Description */}
            <div className="border-b border-ink/10 pb-6">
              <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-2">MVP Description</label>
              {editing ? (
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={5}
                  className="w-full border border-ink/20 bg-transparent p-3 text-sm outline-none focus:border-forest resize-none"
                  placeholder="Describe your MVP..."
                />
              ) : (
                <p className="text-sm text-ink/70 whitespace-pre-wrap leading-relaxed">{project?.description}</p>
              )}
            </div>

            {/* Estimated Funds */}
            <div>
              <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-2">Funding Target (INR)</label>
              {editing ? (
                <input
                  type="number"
                  value={form.estimatedFunds}
                  onChange={(e) => setForm((f) => ({ ...f, estimatedFunds: e.target.value }))}
                  className="w-full border-b border-ink/30 bg-transparent py-2 text-base outline-none focus:border-forest"
                  placeholder="0"
                />
              ) : (
                <p className="text-base text-ink/80">
                  ₹{Number(project?.estimatedFunds ?? 0).toLocaleString('en-IN')}
                  {project?.fundedAmount > 0 && (
                    <span className="text-forest ml-2 text-sm">· ₹{Number(project.fundedAmount).toLocaleString('en-IN')} raised</span>
                  )}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
