'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

interface Stats {
  totalApplicants: number;
  statusBreakdown: {
    pending: number;
    eligible: number;
    active: number;
    removed: number;
  };
  totalBatches: number;
  activeBatch: {
    id: string;
    batchNumber: number;
    status: string;
    currentCount: number;
    capacity: number;
    teamCount: number;
  } | null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboardStats().then(setStats).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-ink">
        <div className="w-12 h-12 bg-forest/10 flex items-center justify-center border border-forest/20 mb-6 animate-pulse">
          <span className="font-serif text-xl font-bold text-forest">...</span>
        </div>
        <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Administrator Data</p>
      </div>
    );
  }

  if (!stats) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-ink">
      <h2 className="font-serif text-3xl font-bold mb-2">Connection Severed</h2>
      <p className="text-ink/60">Failed to load the operations dashboard.</p>
    </div>
  );

  const activeBatch = stats.activeBatch;

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <p className="text-sm uppercase tracking-widest text-forest font-medium mb-3">Administrator Privileges</p>
          <h1 className="font-serif text-5xl font-bold leading-none">Command Center</h1>
        </div>
        <div className="text-left md:text-right">
          <p className="text-3xl font-serif text-terracotta mb-1">
            Active
            <span className="text-ink/40 text-xl ml-2">System Status</span>
          </p>
        </div>
      </header>

      {/* Stats Quick Links (Top Bar) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
        <div className="border border-hairline bg-white p-6 hover:bg-parchment/50 transition-colors">
          <div className="text-[11px] uppercase tracking-widest text-ink/40 mb-3 block">Total Applic.</div>
          <div className="font-serif text-4xl pr-4">{stats.totalApplicants.toLocaleString()}</div>
        </div>
        <div className="border border-hairline bg-white p-6 hover:bg-parchment/50 transition-colors">
          <div className="text-[11px] uppercase tracking-widest text-ink/40 mb-3 block">Batches Formed</div>
          <div className="font-serif text-4xl pr-4">{stats.totalBatches}</div>
        </div>
        <div className="border border-hairline bg-white p-6 hover:bg-parchment/50 transition-colors">
          <div className="text-[11px] uppercase tracking-widest text-ink/40 mb-3 block">Active Founders</div>
          <div className="font-serif text-4xl pr-4 text-forest">{stats.statusBreakdown.active}</div>
        </div>
        <div className="border border-hairline bg-white p-6 hover:bg-parchment/50 transition-colors">
          <div className="text-[11px] uppercase tracking-widest text-ink/40 mb-3 block">Pending Review</div>
          <div className="font-serif text-4xl pr-4 text-terracotta">{stats.statusBreakdown.pending}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Left Column */}
        <div className="lg:col-span-8 flex flex-col gap-12">
          {/* Active Batch Card */}
          <section>
            <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
              Cohort Management
            </h2>
            <div className="bg-white border border-hairline p-8 font-sans">
              {activeBatch ? (
                <div className="flex flex-col gap-6">
                  <div className="flex items-center justify-between pb-4 border-b border-hairline">
                    <span className="font-serif text-2xl font-bold">Batch #{activeBatch.batchNumber}</span>
                    <span className="bg-forest/10 text-forest px-3 py-1 text-xs uppercase tracking-widest font-semibold border border-forest/20">
                      {activeBatch.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs uppercase tracking-widest text-ink/60 mb-2">
                      <span>Network Capacity</span>
                      <span>{activeBatch.currentCount} / {activeBatch.capacity}</span>
                    </div>
                    <div className="h-2 bg-parchment w-full shadow-inner">
                      <div 
                        className="h-full bg-forest transition-all" 
                        style={{ width: `${Math.min(100, (activeBatch.currentCount / activeBatch.capacity) * 100)}%` }} 
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-ink/60 uppercase tracking-widest text-xs">Assigned Teams</span>
                    <span className="font-serif text-xl font-bold">{activeBatch.teamCount}</span>
                  </div>
                  <div className="pt-4 border-t border-hairline">
                    <Link href={`/admin/batches/${activeBatch.id}`} className="bg-ink hover:bg-terracotta text-white transition-colors text-xs uppercase tracking-widest px-6 py-3 inline-block font-semibold">
                      Manage Batch Manifest →
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8">
                  <p className="text-ink/60 uppercase tracking-widest text-xs mb-4">Pipeline Idle</p>
                  <Link href="/admin/batches" className="border-2 border-forest text-forest hover:bg-forest hover:text-white transition-colors text-xs uppercase tracking-widest px-6 py-3 block text-center font-bold">
                    Initialize New Cohort
                  </Link>
                </div>
              )}
            </div>
          </section>

          {/* Quick Actions (Module Links) */}
          <section>
            <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
              System Operations
            </h2>
            <div className="grid grid-cols-2 gap-6">
              <Link href="/admin/questions" className="border border-hairline p-6 bg-white hover:border-forest hover:shadow-sm transition-all group">
                <span className="block text-2xl mb-4 group-hover:-translate-y-1 transition-transform">❓</span>
                <span className="font-serif text-lg font-bold block mb-1 group-hover:text-forest transition-colors">Manage Questions</span>
                <span className="text-xs uppercase tracking-widest text-ink/60">Configure applicant dossier</span>
              </Link>
              <Link href="/admin/batches" className="border border-hairline p-6 bg-white hover:border-forest hover:shadow-sm transition-all group">
                <span className="block text-2xl mb-4 group-hover:-translate-y-1 transition-transform">📦</span>
                <span className="font-serif text-lg font-bold block mb-1 group-hover:text-forest transition-colors">View Batches</span>
                <span className="text-xs uppercase tracking-widest text-ink/60">Inspect network cohorts</span>
              </Link>
              <Link href="/admin/users" className="border border-hairline p-6 bg-white hover:border-forest hover:shadow-sm transition-all group">
                <span className="block text-2xl mb-4 group-hover:-translate-y-1 transition-transform">👥</span>
                <span className="font-serif text-lg font-bold block mb-1 group-hover:text-forest transition-colors">Browse Roster</span>
                <span className="text-xs uppercase tracking-widest text-ink/60">Review accepted talent</span>
              </Link>
              <Link href="/admin/eligibility" className="border border-hairline p-6 bg-white hover:border-forest hover:shadow-sm transition-all group">
                <span className="block text-2xl mb-4 group-hover:-translate-y-1 transition-transform">✅</span>
                <span className="font-serif text-lg font-bold block mb-1 group-hover:text-forest transition-colors">Eligibility Protocol</span>
                <span className="text-xs uppercase tracking-widest text-ink/60">Filter algorithmic criteria</span>
              </Link>
              <Link href="/admin/training" className="border border-hairline p-6 bg-white hover:border-forest hover:shadow-sm transition-all group">
                <span className="block text-2xl mb-4 group-hover:-translate-y-1 transition-transform">📚</span>
                <span className="font-serif text-lg font-bold block mb-1 group-hover:text-forest transition-colors">Training Library</span>
                <span className="text-xs uppercase tracking-widest text-ink/60">Manage curriculum modules</span>
              </Link>
              <Link href="/admin/analytics" className="border border-hairline p-6 bg-white hover:border-forest hover:shadow-sm transition-all group">
                <span className="block text-2xl mb-4 group-hover:-translate-y-1 transition-transform">📊</span>
                <span className="font-serif text-lg font-bold block mb-1 group-hover:text-forest transition-colors">Analytics & Telemetry</span>
                <span className="text-xs uppercase tracking-widest text-ink/60">Platform performance data</span>
              </Link>
              <Link href="/admin/settings" className="border border-hairline p-6 bg-white hover:border-forest hover:shadow-sm transition-all group">
                <span className="block text-2xl mb-4 group-hover:-translate-y-1 transition-transform">⚙️</span>
                <span className="font-serif text-lg font-bold block mb-1 group-hover:text-forest transition-colors">Site Settings</span>
                <span className="text-xs uppercase tracking-widest text-ink/60">Manage visitor analytics & platform configuration</span>
              </Link>
            </div>
          </section>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-4 flex flex-col gap-12">
          {/* Status Breakdown */}
          <section>
            <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
              Network Status
            </h2>
            <div className="bg-ink text-parchment p-8">
              <div className="flex flex-col gap-4">
                {Object.entries(stats.statusBreakdown).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between py-3 border-b border-ink/30 last:border-0">
                    <span className="text-xs uppercase tracking-widest font-semibold">{status}</span>
                    <span className="font-serif text-2xl font-bold">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

      </div>
    </div>
  );
}
