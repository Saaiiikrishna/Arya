'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { X } from 'lucide-react';

// Integer paise → ₹ display. Backend stores project funds as integer minor units (paise).
const fmtInr = (paise?: number) =>
  `₹${((paise ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AdminAnalyticsPage() {
  const [overview, setOverview] = useState<any>(null);
  const [rankings, setRankings] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<string>('');
  const [batchStats, setBatchStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingBatch, setLoadingBatch] = useState(false);

  // Per-team report drawer
  const [reportTeamId, setReportTeamId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getAnalyticsOverview(),
      api.getTeamRankings(),
      api.getBatches()
    ]).then(([ov, rnk, bts]) => {
      setOverview(ov);
      setRankings(rnk);
      setBatches(bts);
      if (bts.length > 0) {
        setSelectedBatch(bts[0].id);
      }
    }).catch(console.error)
    .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedBatch) return;
    setLoadingBatch(true);
    api.getBatchAnalytics(selectedBatch)
      .then(setBatchStats)
      .catch(console.error)
      .finally(() => setLoadingBatch(false));
  }, [selectedBatch]);

  if (loading) return (
    <div className="flex-center min-h-[60vh]">
      <div className="spinner mb-4"></div>
      <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Aggregating Telemetry Data</p>
    </div>
  );

  // Derive batch performance values from backend response
  const activeTeams = batchStats?.totalTeams || 0;
  const riskSummary = batchStats?.riskSummary || { green: 0, yellow: 0, red: 0 };
  const teamMetrics = batchStats?.teamMetrics || [];
  const avgCompletion = teamMetrics.length > 0
    ? Math.round(teamMetrics.reduce((sum: number, t: any) => sum + t.completionRate, 0) / teamMetrics.length)
    : 0;
  const milestoneOverview = overview?.milestoneOverview || { total: 0, completed: 0, completionRate: 0 };

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      <header className="border-b border-hairline pb-8 mb-12 flex justify-between items-end">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Telemetry & Analytics</h1>
        </div>
      </header>

      {/* Overview Stats — mapped to actual backend fields */}
      <section className="mb-16">
        <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
          Platform Overview
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="border border-hairline bg-white p-6">
            <div className="text-[10px] uppercase tracking-widest text-ink/40 mb-2">Total Batches</div>
            <div className="font-serif text-3xl font-bold text-forest">
              {overview?.totalBatches || 0}
            </div>
          </div>
          <div className="border border-hairline bg-white p-6">
            <div className="text-[10px] uppercase tracking-widest text-ink/40 mb-2">Total Teams</div>
            <div className="font-serif text-3xl font-bold">{overview?.totalTeams || 0}</div>
          </div>
          <div className="border border-hairline bg-white p-6">
            <div className="text-[10px] uppercase tracking-widest text-ink/40 mb-2">Total Applicants</div>
            <div className="font-serif text-3xl font-bold">{overview?.totalApplicants || 0}</div>
          </div>
          <div className="border border-hairline bg-white p-6">
            <div className="text-[10px] uppercase tracking-widest text-ink/40 mb-2">Milestone Completion</div>
            <div className="font-serif text-3xl font-bold">{milestoneOverview.completionRate}%</div>
          </div>
        </div>

        {/* Batch Status Breakdown */}
        {overview?.batchStatusBreakdown && overview.batchStatusBreakdown.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-3">
            {overview.batchStatusBreakdown.map((s: any) => (
              <div key={s.status} className="border border-hairline bg-white px-4 py-3 flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold">
                  {s.status.replace(/_/g, ' ')}
                </span>
                <span className="font-serif text-xl font-bold">{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-12 gap-12">
        {/* Batch Performance Insights */}
        <section className="lg:col-span-7">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-serif text-2xl font-bold">Batch Performance</h2>
            <select 
              className="bg-white border border-hairline px-4 py-2 text-sm outline-none focus:border-forest"
              value={selectedBatch}
              onChange={e => setSelectedBatch(e.target.value)}
            >
              <option disabled value="">Select Batch</option>
              {batches.map(b => (
                <option key={b.id} value={b.id}>Batch #{b.batchNumber}</option>
              ))}
            </select>
          </div>

          <div className="bg-white border border-hairline p-8 font-sans min-h-[300px]">
            {loadingBatch ? (
              <div className="flex-center h-full text-ink/40">Loading batch insights...</div>
            ) : !batchStats ? (
              <div className="flex-center h-full text-ink/40">No data available for this batch.</div>
            ) : (
              <div className="flex flex-col gap-8">
                <div className="grid grid-cols-3 gap-6 pb-6 border-b border-hairline text-center">
                  <div>
                    <div className="text-3xl font-serif font-bold">{activeTeams}</div>
                    <div className="text-[10px] uppercase tracking-widest text-ink/50 mt-1">Active Teams</div>
                  </div>
                  <div>
                    <div className="text-3xl font-serif font-bold">{avgCompletion}%</div>
                    <div className="text-[10px] uppercase tracking-widest text-ink/50 mt-1">Avg Completion</div>
                  </div>
                  <div>
                    <div className="text-3xl font-serif font-bold">{batchStats.dropOffRate || 0}%</div>
                    <div className="text-[10px] uppercase tracking-widest text-ink/50 mt-1">Drop-off Rate</div>
                  </div>
                </div>

                <div>
                  <h3 className="font-serif text-lg font-bold mb-4">Risk Distribution</h3>
                  <div className="space-y-4">
                    {/* High Risk */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="uppercase tracking-widest text-terracotta font-bold">High Risk</span>
                        <span>{riskSummary.red} Teams</span>
                      </div>
                      <div className="h-2 w-full bg-parchment">
                        <div className="h-full bg-terracotta" style={{width: `${activeTeams > 0 ? (riskSummary.red / activeTeams) * 100 : 0}%`}}></div>
                      </div>
                    </div>
                    {/* Medium Risk */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="uppercase tracking-widest text-warning font-bold">Intervention Needed</span>
                        <span>{riskSummary.yellow} Teams</span>
                      </div>
                      <div className="h-2 w-full bg-parchment">
                        <div className="h-full bg-marigold" style={{width: `${activeTeams > 0 ? (riskSummary.yellow / activeTeams) * 100 : 0}%`}}></div>
                      </div>
                    </div>
                    {/* Healthy */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="uppercase tracking-widest text-forest font-bold">Healthy Performing</span>
                        <span>{riskSummary.green} Teams</span>
                      </div>
                      <div className="h-2 w-full bg-parchment">
                        <div className="h-full bg-forest" style={{width: `${activeTeams > 0 ? (riskSummary.green / activeTeams) * 100 : 0}%`}}></div>
                      </div>
                    </div>
                  </div>
                </div>

                {teamMetrics.length > 0 && (
                  <div>
                    <h3 className="font-serif text-lg font-bold mb-4">Teams</h3>
                    <div className="border border-hairline divide-y divide-hairline">
                      {teamMetrics.map((t: any) => (
                        <button
                          key={t.teamId}
                          type="button"
                          onClick={() => setReportTeamId(t.teamId)}
                          className="w-full text-left flex items-center justify-between px-4 py-3 hover:bg-parchment transition-colors group cursor-pointer focus:outline-none focus:bg-parchment"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span
                              className={`w-2 h-2 shrink-0 ${t.riskLevel === 'RED' ? 'bg-terracotta' : t.riskLevel === 'YELLOW' ? 'bg-marigold' : 'bg-forest'}`}
                            ></span>
                            <span className="font-bold text-sm truncate group-hover:text-forest transition-colors">{t.teamName}</span>
                          </div>
                          <div className="flex items-center gap-4 shrink-0">
                            <span className="font-serif text-base font-bold">{t.completionRate}%</span>
                            <span className="text-[10px] uppercase tracking-widest text-forest font-semibold opacity-0 group-hover:opacity-100 transition-opacity">View →</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Global Team Rankings */}
        <section className="lg:col-span-5">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-serif text-2xl font-bold">Global Leaderboard</h2>
          </div>
          
          <div className="bg-ink text-parchment border border-hairline p-6 shadow-sm">
            {rankings.length === 0 ? (
              <p className="text-center text-parchment/60 py-8">Not enough data to rank teams.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {rankings.map((team, idx) => (
                  <button
                    key={team.teamId}
                    type="button"
                    onClick={() => setReportTeamId(team.teamId)}
                    className="w-full text-left flex items-center justify-between p-3 border-b border-parchment/10 last:border-0 hover:bg-parchment/5 transition-colors group cursor-pointer focus:outline-none focus:bg-parchment/10"
                  >
                    <div className="flex items-center gap-4">
                      <span className={`font-serif text-xl font-bold w-6 text-center ${idx < 3 ? 'text-terracotta-warm' : 'text-parchment/40'}`}>
                        {team.rank || idx + 1}
                      </span>
                      <div>
                        <div className="font-bold text-sm group-hover:text-saffron transition-colors">{team.teamName}</div>
                        <div className="text-[10px] uppercase tracking-widest text-parchment/40">Batch #{team.batchNumber}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-serif text-lg text-saffron font-bold">{team.score}</div>
                      <div className="text-[10px] uppercase tracking-widest text-parchment/40">Score</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {reportTeamId && (
        <TeamReportDrawer teamId={reportTeamId} onClose={() => setReportTeamId(null)} />
      )}
    </div>
  );
}

function TeamReportDrawer({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotFound(false);
    api.getTeamReport(teamId)
      .then(data => {
        if (!active) return;
        if (!data) setNotFound(true);
        else setReport(data);
      })
      .catch(() => active && setNotFound(true))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [teamId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const progress = report?.progress || { totalMilestones: 0, completed: 0, overdue: 0, completionRate: 0 };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 flex justify-end animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-parchment border-l border-hairline w-full max-w-md h-full overflow-y-auto text-ink shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-6 py-5 bg-white sticky top-0 z-10">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-ink/40 mb-1">Team Report</div>
            <h2 className="font-serif text-2xl font-bold truncate">
              {report?.team?.name || (loading ? 'Loading…' : 'Team')}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close report"
            className="text-ink/40 hover:text-ink transition-colors shrink-0 ml-3"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex-center min-h-[40vh] flex-col">
            <div className="spinner mb-4"></div>
            <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Team Report</p>
          </div>
        ) : notFound ? (
          <div className="flex-center min-h-[40vh] text-ink/40 text-sm">No report data for this team.</div>
        ) : (
          <div className="p-6 flex flex-col gap-8 font-sans">
            {/* Meta */}
            <div className="flex flex-wrap gap-3">
              <div className="border border-hairline bg-white px-3 py-2">
                <span className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold">Batch</span>{' '}
                <span className="font-bold text-sm">#{report.batch?.batchNumber}</span>
              </div>
              {report.team?.teamType && (
                <div className="border border-hairline bg-white px-3 py-2">
                  <span className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold">Type</span>{' '}
                  <span className="font-bold text-sm">{String(report.team.teamType).replace(/_/g, ' ')}</span>
                </div>
              )}
              <div className="border border-hairline bg-white px-3 py-2">
                <span className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold">Match</span>{' '}
                <span className="font-bold text-sm">{report.team?.matchScore ?? '—'}</span>
              </div>
            </div>

            {/* Progress */}
            <div>
              <h3 className="font-serif text-lg font-bold mb-4">Milestone Progress</h3>
              <div className="grid grid-cols-3 gap-3 text-center mb-4">
                <div className="border border-hairline bg-white p-4">
                  <div className="font-serif text-2xl font-bold">{progress.completed}</div>
                  <div className="text-[10px] uppercase tracking-widest text-ink/50 mt-1">Completed</div>
                </div>
                <div className="border border-hairline bg-white p-4">
                  <div className="font-serif text-2xl font-bold text-terracotta">{progress.overdue}</div>
                  <div className="text-[10px] uppercase tracking-widest text-ink/50 mt-1">Overdue</div>
                </div>
                <div className="border border-hairline bg-white p-4">
                  <div className="font-serif text-2xl font-bold">{progress.totalMilestones}</div>
                  <div className="text-[10px] uppercase tracking-widest text-ink/50 mt-1">Total</div>
                </div>
              </div>
              <div className="flex justify-between text-xs mb-1">
                <span className="uppercase tracking-widest text-forest font-bold">Completion</span>
                <span>{progress.completionRate}%</span>
              </div>
              <div className="h-2 w-full bg-white border border-hairline">
                <div className="h-full bg-forest" style={{ width: `${progress.completionRate}%` }}></div>
              </div>
            </div>

            {/* Members */}
            <div>
              <h3 className="font-serif text-lg font-bold mb-4">
                Members <span className="text-ink/40 font-sans text-sm font-normal">({report.members?.length || 0})</span>
              </h3>
              {(!report.members || report.members.length === 0) ? (
                <p className="text-ink/40 text-sm">No members recorded.</p>
              ) : (
                <div className="border border-hairline divide-y divide-hairline bg-white">
                  {report.members.map((m: any) => (
                    <div key={m.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-sm truncate">{m.name}</span>
                        <span className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold shrink-0">
                          {String(m.status).replace(/_/g, ' ')}
                        </span>
                      </div>
                      {Array.isArray(m.skills) && m.skills.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {m.skills.slice(0, 8).map((s: string, i: number) => (
                            <span key={i} className="text-[10px] uppercase tracking-wider border border-hairline px-1.5 py-0.5 text-ink/60">{s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Upcoming Milestones */}
            <div>
              <h3 className="font-serif text-lg font-bold mb-4">Upcoming Milestones</h3>
              {(!report.upcomingMilestones || report.upcomingMilestones.length === 0) ? (
                <p className="text-ink/40 text-sm">No upcoming milestones.</p>
              ) : (
                <div className="border border-hairline divide-y divide-hairline bg-white">
                  {report.upcomingMilestones.map((ms: any) => (
                    <div key={ms.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <span className="font-medium text-sm truncate">{ms.title}</span>
                      {ms.deadline && (
                        <span className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold shrink-0">
                          {new Date(ms.deadline).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Project */}
            {report.project && (
              <div>
                <h3 className="font-serif text-lg font-bold mb-4">Project</h3>
                <div className="border border-hairline bg-white p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-sm truncate">{report.project.name}</span>
                    <span className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold shrink-0">
                      {String(report.project.status).replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex gap-6 text-xs text-ink/60">
                    <span>Funded: <span className="font-bold text-ink">{fmtInr(report.project.fundedAmount)}</span></span>
                    <span>Estimated: <span className="font-bold text-ink">{fmtInr(report.project.estimatedFunds)}</span></span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
