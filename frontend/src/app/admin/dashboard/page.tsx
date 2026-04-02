'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { 
  FileQuestion, Package, Users, ShieldCheck, 
  BookOpen, BarChart2, Megaphone, Settings, 
  AlertCircle, CheckCircle2 
} from 'lucide-react';

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

// DangerZone component extracted to /admin/danger-zone

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const { admin, logout } = useAuth();
  const router = useRouter();

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
          <div className="flex items-center gap-4 mb-3">
            <p className="text-sm uppercase tracking-widest text-forest font-medium">Administrator Privileges</p>
            {admin?.role === 'SUPER_ADMIN' && (
              <button
                onClick={() => {
                  logout();
                  router.push('/admin/login');
                }}
                className="flex items-center gap-2 border border-terracotta text-terracotta px-3 py-1 text-[10px] uppercase tracking-widest hover:bg-terracotta hover:text-white transition-colors"
                title="Super Admin Disconnect"
              >
                <span>Disconnect</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              </button>
            )}
          </div>
          <h1 className="font-serif text-5xl font-bold leading-none">Command Center</h1>
        </div>
        <div className="text-left md:text-right flex flex-col md:items-end">
          {(() => {
            const hasAnomalies = stats.statusBreakdown.pending > 50 || !activeBatch;
            const systemStatus = hasAnomalies ? 'Attention Required' : 'Status: Optimal';
            const systemMessage = !activeBatch 
              ? 'Pipeline idle. Initialize new cohort.' 
              : (stats.statusBreakdown.pending > 50 ? 'High volume of pending applications.' : 'All systems and databases stable.');
            const StatusIcon = hasAnomalies ? AlertCircle : CheckCircle2;
            const statusColor = hasAnomalies ? 'text-terracotta' : 'text-forest';
            
            return (
              <>
                <div className={`flex items-center gap-2 ${statusColor} mb-2`}>
                  <StatusIcon className="w-7 h-7" />
                  <p className="font-serif text-3xl font-bold">{systemStatus}</p>
                </div>
                <p className="text-[10px] uppercase tracking-widest text-ink/60 font-semibold">{systemMessage}</p>
              </>
            );
          })()}
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 lg:gap-12">
        {/* Left Column - Core Operations */}
        <div className="xl:col-span-8 flex flex-col gap-10">
          
          {/* Executive Overview */}
          <section>
            <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
              Executive Overview
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="border border-hairline bg-white p-5 hover:bg-parchment/50 transition-colors flex flex-col justify-between group shadow-sm hover:shadow-md">
                <div className="text-[10px] uppercase tracking-widest text-ink/50 font-bold mb-3 block">Total Applic.</div>
                <div className="font-serif text-3xl lg:text-4xl pr-2">{stats.totalApplicants.toLocaleString()}</div>
              </div>
              <div className="border border-hairline bg-white p-5 hover:bg-parchment/50 transition-colors flex flex-col justify-between group shadow-sm hover:shadow-md">
                <div className="text-[10px] uppercase tracking-widest text-ink/50 font-bold mb-3 block">Batches Formed</div>
                <div className="font-serif text-3xl lg:text-4xl pr-2">{stats.totalBatches}</div>
              </div>
              <div className="border border-hairline bg-white p-5 hover:bg-parchment/50 transition-colors flex flex-col justify-between group shadow-sm hover:shadow-md border-b-4 border-b-forest">
                <div className="text-[10px] uppercase tracking-widest text-ink/50 font-bold mb-3 block">Active Founders</div>
                <div className="font-serif text-3xl lg:text-4xl pr-2 text-forest">{stats.statusBreakdown.active}</div>
              </div>
              <div className="border border-hairline bg-white p-5 hover:bg-parchment/50 transition-colors flex flex-col justify-between group shadow-sm hover:shadow-md border-b-4 border-b-terracotta">
                <div className="text-[10px] uppercase tracking-widest text-ink/50 font-bold mb-3 block">Pending Review</div>
                <div className="font-serif text-3xl lg:text-4xl pr-2 text-terracotta">{stats.statusBreakdown.pending}</div>
              </div>
            </div>
          </section>

          {/* System Modules Grid */}
          <section>
            <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
              System Modules
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <Link href="/admin/questions" className="border border-hairline p-5 bg-white hover:border-forest hover:shadow-md shadow-sm transition-all group flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <span className="group-hover:-rotate-12 transition-transform text-ink/40 group-hover:text-forest"><FileQuestion size={22} strokeWidth={1.5} /></span>
                  <span className="font-serif text-lg font-bold group-hover:text-forest transition-colors">Questions</span>
                </div>
                <span className="text-[10px] uppercase tracking-widest text-ink/60 leading-relaxed mt-auto">Configure applicant dossier</span>
              </Link>
              <Link href="/admin/batches" className="border border-hairline p-5 bg-white hover:border-forest hover:shadow-md shadow-sm transition-all group flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <span className="group-hover:scale-110 transition-transform text-ink/40 group-hover:text-forest"><Package size={22} strokeWidth={1.5} /></span>
                  <span className="font-serif text-lg font-bold group-hover:text-forest transition-colors">Batches</span>
                </div>
                <span className="text-[10px] uppercase tracking-widest text-ink/60 leading-relaxed mt-auto">Inspect network cohorts</span>
              </Link>
              <Link href="/admin/users" className="border border-hairline p-5 bg-white hover:border-forest hover:shadow-md shadow-sm transition-all group flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <span className="group-hover:scale-110 transition-transform text-ink/40 group-hover:text-forest"><Users size={22} strokeWidth={1.5} /></span>
                  <span className="font-serif text-lg font-bold group-hover:text-forest transition-colors">Roster</span>
                </div>
                <span className="text-[10px] uppercase tracking-widest text-ink/60 leading-relaxed mt-auto">Review accepted talent</span>
              </Link>
              <Link href="/admin/eligibility" className="border border-hairline p-5 bg-white hover:border-forest hover:shadow-md shadow-sm transition-all group flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <span className="group-hover:scale-110 transition-transform text-ink/40 group-hover:text-forest"><ShieldCheck size={22} strokeWidth={1.5} /></span>
                  <span className="font-serif text-lg font-bold group-hover:text-forest transition-colors">Eligibility</span>
                </div>
                <span className="text-[10px] uppercase tracking-widest text-ink/60 leading-relaxed mt-auto">Algorithmic criteria engine</span>
              </Link>
              <Link href="/admin/training" className="border border-hairline p-5 bg-white hover:border-forest hover:shadow-md shadow-sm transition-all group flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <span className="group-hover:scale-110 transition-transform text-ink/40 group-hover:text-forest"><BookOpen size={22} strokeWidth={1.5} /></span>
                  <span className="font-serif text-lg font-bold group-hover:text-forest transition-colors">Training</span>
                </div>
                <span className="text-[10px] uppercase tracking-widest text-ink/60 leading-relaxed mt-auto">Manage curriculum modules</span>
              </Link>
              <Link href="/admin/analytics" className="border border-hairline p-5 bg-white hover:border-forest hover:shadow-md shadow-sm transition-all group flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <span className="group-hover:scale-110 transition-transform text-ink/40 group-hover:text-forest"><BarChart2 size={22} strokeWidth={1.5} /></span>
                  <span className="font-serif text-lg font-bold group-hover:text-forest transition-colors">Analytics</span>
                </div>
                <span className="text-[10px] uppercase tracking-widest text-ink/60 leading-relaxed mt-auto">Platform telemetry & data</span>
              </Link>
              <Link href="/admin/announcements" className="border border-hairline p-5 bg-white hover:border-forest hover:shadow-md shadow-sm transition-all group flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <span className="group-hover:scale-110 transition-transform text-ink/40 group-hover:text-forest"><Megaphone size={22} strokeWidth={1.5} /></span>
                  <span className="font-serif text-lg font-bold group-hover:text-forest transition-colors">Dispatches</span>
                </div>
                <span className="text-[10px] uppercase tracking-widest text-ink/60 leading-relaxed mt-auto">Global announcements broadcast</span>
              </Link>
              <Link href="/admin/settings" className="border border-hairline p-5 bg-white hover:border-forest hover:shadow-md shadow-sm transition-all group flex flex-col xl:col-span-2">
                <div className="flex items-center gap-3 mb-3">
                  <span className="group-hover:rotate-90 transition-transform text-ink/40 group-hover:text-forest"><Settings size={22} strokeWidth={1.5} /></span>
                  <span className="font-serif text-lg font-bold group-hover:text-forest transition-colors">Site Configuration</span>
                </div>
                <span className="text-[10px] uppercase tracking-widest text-ink/60 leading-relaxed mt-auto">Global preferences, settings & visitor analytics</span>
              </Link>
            </div>
          </section>
        </div>

        {/* Right Column - Cohort & Status Info */}
        <div className="xl:col-span-4 flex flex-col gap-10">
          
          {/* Active Cohort Sidebar */}
          <section>
            <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
              Cohort Management
            </h2>
            <div className="bg-white border border-hairline p-6 font-sans shadow-sm">
              {activeBatch ? (
                <div className="flex flex-col gap-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-hairline">
                    <span className="font-serif text-xl font-bold">Batch #{activeBatch.batchNumber}</span>
                    <span className="bg-forest/10 text-forest px-2 py-1 text-[10px] uppercase tracking-widest font-bold border border-forest/20">
                      {activeBatch.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">
                      <span>Network Capacity</span>
                      <span>{activeBatch.currentCount} / {activeBatch.capacity}</span>
                    </div>
                    <div className="h-2 bg-parchment w-full shadow-inner rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-forest transition-all" 
                        style={{ width: `${Math.min(100, (activeBatch.currentCount / activeBatch.capacity) * 100)}%` }} 
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-sm items-center py-2">
                    <span className="text-ink/60 uppercase tracking-widest text-[10px] font-bold">Assigned Teams</span>
                    <span className="font-serif text-lg font-bold">{activeBatch.teamCount}</span>
                  </div>
                  <div className="pt-4 border-t border-hairline">
                    <Link href={`/admin/batches/${activeBatch.id}`} className="bg-ink hover:bg-terracotta text-white transition-colors text-[10px] uppercase tracking-widest px-4 py-3 text-center block font-bold w-full shadow-sm">
                      Manage Manifest →
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <p className="text-ink/50 uppercase tracking-widest text-[10px] font-bold mb-4">Pipeline Idle</p>
                  <Link href="/admin/batches" className="border border-forest text-forest hover:bg-forest hover:text-white transition-colors text-[10px] uppercase tracking-widest px-4 py-3 block text-center font-bold w-full shadow-sm">
                    Initialize New Cohort
                  </Link>
                </div>
              )}
            </div>
          </section>

          {/* Status Breakdown Sidebar */}
          <section>
            <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
              Network Dynamics
            </h2>
            <div className="bg-ink text-parchment p-6 shadow-sm border border-ink/80">
              <div className="flex flex-col gap-2">
                {Object.entries(stats.statusBreakdown).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between py-3 border-b border-ink/30 last:border-0 group">
                    <span className="text-[10px] uppercase tracking-widest font-bold group-hover:text-white transition-colors">{status}</span>
                    <span className="font-serif text-xl font-bold group-hover:text-white transition-colors bg-white/5 px-2 py-0.5 rounded">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>


      {/* Standalone Route for Danger Zone */}
      {admin?.role === 'SUPER_ADMIN' && (
        <section className="mt-16 bg-white border border-terracotta/10 hover:border-terracotta/50 shadow-sm transition-all group p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="max-w-xl">
            <h2 className="font-serif text-3xl font-bold text-terracotta mb-2 group-hover:text-terracotta transition-colors flex items-center gap-3">
              ⚠️ Danger Zone
            </h2>
            <p className="text-xs uppercase tracking-widest text-ink/60 font-semibold mb-2">Direct Database Operations & Management</p>
            <p className="text-sm font-sans text-ink/80 leading-relaxed">View all underlying Postgres tables, manually clear misconfigured schema data, drop entire columns, or orchestrate global data purges. Strictly restricted to Super Admins.</p>
          </div>
          <div className="text-left md:text-right w-full md:w-auto flex-shrink-0">
            <Link href="/admin/danger-zone" className="bg-terracotta hover:bg-ink text-white px-8 py-4 text-xs uppercase tracking-widest font-bold transition-colors shadow-sm hover:shadow-md inline-block w-full md:w-auto text-center">
              Enter Danger Zone →
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
