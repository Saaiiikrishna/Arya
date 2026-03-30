'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import { useRouter } from 'next/navigation';

interface VisitorSummary {
  totalViews: number;
  uniqueSessions: number;
  todayViews: number;
  topPages: { path: string; views: number; unique_sessions: number }[];
  recentVisitors: any[];
  dailyTrend: { date: string; views: number; uniqueIps: number }[];
}

interface PageViewRecord {
  id: string;
  sessionId: string;
  path: string;
  referrer: string | null;
  ip: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  language: string | null;
  applicantId: string | null;
  applicantEmail: string | null;
  applicantName: string | null;
  duration: number | null;
  timestamp: string;
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const { refresh } = useSettings();
  const [activeTab, setActiveTab] = useState<'settings' | 'analytics'>('settings');

  // Settings state
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Analytics state
  const [summary, setSummary] = useState<VisitorSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Page views detail state
  const [showDetail, setShowDetail] = useState(false);
  const [pageViews, setPageViews] = useState<PageViewRecord[]>([]);
  const [pvMeta, setPvMeta] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [pvLoading, setPvLoading] = useState(false);
  const [pvSearch, setPvSearch] = useState('');

  // Load settings
  useEffect(() => {
    api.getSettings()
      .then(setSettings)
      .catch(() => {})
      .finally(() => setSettingsLoading(false));
  }, []);

  // Load analytics summary when tab is active
  useEffect(() => {
    if (activeTab === 'analytics') {
      setSummaryLoading(true);
      api.getVisitorSummary(30)
        .then(setSummary)
        .catch(() => {})
        .finally(() => setSummaryLoading(false));
    }
  }, [activeTab]);

  const saveSetting = async (key: string, value: string) => {
    setSaving(true);
    try {
      await api.updateSettings({ [key]: value });
      setSettings((prev) => ({ ...prev, [key]: value }));
      if (key === 'logoMode' || key.startsWith('social_')) {
        await refresh();
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const loadPageViews = async (page = 1) => {
    setPvLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: '50' };
      if (pvSearch) params.search = pvSearch;
      const result = await api.getVisitorPageViews(params);
      setPageViews(result.data);
      setPvMeta(result.meta);
    } catch {
      // ignore
    } finally {
      setPvLoading(false);
    }
  };

  const handleViewDetails = () => {
    setShowDetail(true);
    loadPageViews(1);
  };

  const logoMode = settings.logoMode || 'text';

  return (
    <div className="text-ink px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-12 relative">
        <button 
          onClick={() => router.push('/admin/dashboard')}
          className="absolute right-0 top-0 text-ink/40 hover:text-forest transition-colors font-sans text-[10px] uppercase tracking-widest cursor-pointer"
        >
          ← Dashboard
        </button>
        <p className="text-sm uppercase tracking-widest text-forest font-medium mb-3">Administration</p>
        <h1 className="font-serif text-5xl font-bold leading-none">Site Settings</h1>
      </header>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-12 border-b border-hairline">
        {(['settings', 'analytics'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setShowDetail(false); }}
            className={`px-6 py-3 text-xs uppercase tracking-widest font-semibold transition-colors border-b-2 -mb-px cursor-pointer ${
              activeTab === tab
                ? 'border-forest text-forest'
                : 'border-transparent text-ink/40 hover:text-ink/80'
            }`}
          >
            {tab === 'settings' ? '⚙️ General Settings' : '📊 Visitor Analytics'}
          </button>
        ))}
      </div>

      {/* ─── Settings Tab ────────────────────────────────── */}
      {activeTab === 'settings' && (
        <div className="space-y-8">
          {settingsLoading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 bg-forest/10 flex items-center justify-center border border-forest/20 animate-pulse">
                <span className="font-serif text-sm text-forest">...</span>
              </div>
            </div>
          ) : (
            <>
              {/* Logo Mode Toggle */}
              <section className="bg-white border border-hairline p-8">
                <h2 className="font-serif text-2xl font-bold mb-2">Logo Display Mode</h2>
                <p className="text-xs uppercase tracking-widest text-ink/50 mb-6">
                  Control whether the site displays the SVG logo or the text-based logo
                </p>

                <div className="flex gap-4">
                  <button
                    onClick={() => saveSetting('logoMode', 'text')}
                    disabled={saving}
                    className={`flex-1 p-6 border-2 transition-all cursor-pointer ${
                      logoMode === 'text'
                        ? 'border-forest bg-forest/5'
                        : 'border-hairline hover:border-forest/30'
                    }`}
                  >
                    <div className="flex flex-col items-center gap-4">
                      <div className="flex flex-col items-center">
                        <span className="text-2xl font-serif italic font-bold text-forest leading-none">Aryavartham</span>
                        <span className="text-[10px] font-serif italic text-forest mt-1 leading-none">- The Founder&apos;s Club</span>
                      </div>
                      <span className={`text-xs uppercase tracking-widest font-semibold ${
                        logoMode === 'text' ? 'text-forest' : 'text-ink/40'
                      }`}>
                        {logoMode === 'text' ? '✓ Active' : 'Text Logo'}
                      </span>
                    </div>
                  </button>

                  <button
                    onClick={() => saveSetting('logoMode', 'svg')}
                    disabled={saving}
                    className={`flex-1 p-6 border-2 transition-all cursor-pointer ${
                      logoMode === 'svg'
                        ? 'border-forest bg-forest/5'
                        : 'border-hairline hover:border-forest/30'
                    }`}
                  >
                    <div className="flex flex-col items-center gap-4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/logo-full.svg" alt="SVG Logo" className="h-10" />
                      <span className={`text-xs uppercase tracking-widest font-semibold ${
                        logoMode === 'svg' ? 'text-forest' : 'text-ink/40'
                      }`}>
                        {logoMode === 'svg' ? '✓ Active' : 'SVG Logo'}
                      </span>
                    </div>
                  </button>
                </div>

                {logoMode === 'svg' && (
                  <div className="mt-4 p-4 bg-alabaster border border-hairline text-xs text-ink/60">
                    <strong className="text-forest">Scroll Animation Active:</strong> When SVG mode is enabled, the full logo will smoothly transition to the short logo as users scroll down the page.
                  </div>
                )}
              </section>

              {/* Social Network Links */}
              <section className="bg-white border border-hairline p-8">
                <h2 className="font-serif text-2xl font-bold mb-2">Social Network Links</h2>
                <p className="text-xs uppercase tracking-widest text-ink/50 mb-6">
                  Configure external URLs for the footer navigation
                </p>
                <div className="space-y-4 max-w-xl">
                  {['social_twitter', 'social_linkedin', 'social_instagram'].map(key => (
                    <div key={key} className="flex flex-col gap-2">
                      <label className="font-sans text-[10px] uppercase tracking-widest text-forest font-semibold">
                        {key.replace('social_', '').replace(/^./, c => c.toUpperCase())} URL
                      </label>
                      <input
                        type="url"
                        value={settings[key] || ''}
                        onChange={(e) => setSettings(prev => ({ ...prev, [key]: e.target.value }))}
                        onBlur={(e) => saveSetting(key, e.target.value)}
                        placeholder={`https://${key.replace('social_', '')}.com/...`}
                        className="border border-hairline px-4 py-2 text-sm bg-white focus:outline-none focus:border-forest"
                      />
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {/* ─── Analytics Tab ───────────────────────────────── */}
      {activeTab === 'analytics' && !showDetail && (
        <div className="space-y-8">
          {summaryLoading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 bg-forest/10 flex items-center justify-center border border-forest/20 animate-pulse">
                <span className="font-serif text-sm text-forest">...</span>
              </div>
            </div>
          ) : summary ? (
            <>
              {/* Stats Cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="border border-hairline bg-white p-6">
                  <div className="text-[11px] uppercase tracking-widest text-ink/40 mb-3">Total Page Views (30d)</div>
                  <div className="font-serif text-4xl">{summary.totalViews.toLocaleString()}</div>
                </div>
                <div className="border border-hairline bg-white p-6">
                  <div className="text-[11px] uppercase tracking-widest text-ink/40 mb-3">Unique Sessions</div>
                  <div className="font-serif text-4xl">{summary.uniqueSessions.toLocaleString()}</div>
                </div>
                <div className="border border-hairline bg-white p-6">
                  <div className="text-[11px] uppercase tracking-widest text-ink/40 mb-3">Today&apos;s Views</div>
                  <div className="font-serif text-4xl text-terracotta">{summary.todayViews.toLocaleString()}</div>
                </div>
              </div>

              {/* Top Pages */}
              <section className="bg-white border border-hairline p-8">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="font-serif text-2xl font-bold">Top Pages</h2>
                  <button
                    onClick={handleViewDetails}
                    className="bg-ink hover:bg-terracotta text-white transition-colors text-xs uppercase tracking-widest px-6 py-3 font-semibold cursor-pointer"
                  >
                    View All Details →
                  </button>
                </div>
                <div className="space-y-1">
                  {summary.topPages.map((page, i) => (
                    <div key={i} className="flex items-center justify-between py-3 border-b border-hairline last:border-0">
                      <span className="font-mono text-sm">{page.path}</span>
                      <div className="flex gap-6">
                        <span className="text-xs uppercase tracking-widest text-ink/40">{page.views} views</span>
                        <span className="text-xs uppercase tracking-widest text-ink/40">{page.unique_sessions} sessions</span>
                      </div>
                    </div>
                  ))}
                  {summary.topPages.length === 0 && (
                    <p className="text-ink/40 text-center py-8 text-sm">No page views recorded yet</p>
                  )}
                </div>
              </section>

              {/* Recent Visitors */}
              <section className="bg-white border border-hairline p-8">
                <h2 className="font-serif text-2xl font-bold mb-6">Recent Visitors</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-left">
                        <th className="pb-3 text-[10px] uppercase tracking-widest text-ink/40 font-semibold">Time</th>
                        <th className="pb-3 text-[10px] uppercase tracking-widest text-ink/40 font-semibold">Page</th>
                        <th className="pb-3 text-[10px] uppercase tracking-widest text-ink/40 font-semibold">Location</th>
                        <th className="pb-3 text-[10px] uppercase tracking-widest text-ink/40 font-semibold">Browser</th>
                        <th className="pb-3 text-[10px] uppercase tracking-widest text-ink/40 font-semibold">User</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.recentVisitors.map((v) => (
                        <tr key={v.id} className="border-b border-hairline/50 hover:bg-alabaster transition-colors">
                          <td className="py-3 text-xs text-ink/60">{new Date(v.timestamp).toLocaleString()}</td>
                          <td className="py-3 font-mono text-xs">{v.path}</td>
                          <td className="py-3 text-xs">{[v.city, v.country].filter(Boolean).join(', ') || '—'}</td>
                          <td className="py-3 text-xs">{[v.browser, v.os].filter(Boolean).join(' / ') || '—'}</td>
                          <td className="py-3 text-xs">{v.applicantName || v.applicantEmail || <span className="text-ink/30">Anonymous</span>}</td>
                        </tr>
                      ))}
                      {summary.recentVisitors.length === 0 && (
                        <tr><td colSpan={5} className="text-ink/40 text-center py-8">No visitors recorded yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : (
            <p className="text-ink/40 text-center py-20">Failed to load analytics data</p>
          )}
        </div>
      )}

      {/* ─── Page Views Detail Table ────────────────────── */}
      {activeTab === 'analytics' && showDetail && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowDetail(false)}
              className="text-xs uppercase tracking-widest text-forest hover:text-terracotta transition-colors font-semibold cursor-pointer"
            >
              ← Back to Summary
            </button>
            <div className="flex gap-3">
              <input
                type="text"
                value={pvSearch}
                onChange={(e) => setPvSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadPageViews(1)}
                placeholder="Search IP, email, location, page..."
                className="border border-hairline px-4 py-2 text-sm w-72 bg-white focus:outline-none focus:border-forest"
              />
              <button
                onClick={() => loadPageViews(1)}
                className="bg-forest text-parchment px-4 py-2 text-xs uppercase tracking-widest font-semibold cursor-pointer"
              >
                Search
              </button>
            </div>
          </div>

          <div className="bg-white border border-hairline overflow-x-auto">
            {pvLoading ? (
              <div className="flex justify-center py-20">
                <span className="text-ink/40 text-sm">Loading...</span>
              </div>
            ) : (
              <>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-hairline text-left bg-alabaster">
                      {['Time', 'Page', 'IP', 'Location', 'Browser', 'OS', 'Device', 'Screen', 'Language', 'User', 'Email', 'Session'].map((h) => (
                        <th key={h} className="px-4 py-3 text-[10px] uppercase tracking-widest text-ink/40 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageViews.map((pv) => (
                      <tr key={pv.id} className="border-b border-hairline/50 hover:bg-alabaster/50 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-ink/60">{new Date(pv.timestamp).toLocaleString()}</td>
                        <td className="px-4 py-3 font-mono text-xs max-w-[200px] truncate">{pv.path}</td>
                        <td className="px-4 py-3 font-mono text-xs">{pv.ip || '—'}</td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">{[pv.city, pv.region, pv.country].filter(Boolean).join(', ') || '—'}</td>
                        <td className="px-4 py-3 text-xs">{pv.browser || '—'}</td>
                        <td className="px-4 py-3 text-xs">{pv.os || '—'}</td>
                        <td className="px-4 py-3 text-xs">{pv.device || '—'}</td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">{pv.screenWidth && pv.screenHeight ? `${pv.screenWidth}×${pv.screenHeight}` : '—'}</td>
                        <td className="px-4 py-3 text-xs">{pv.language || '—'}</td>
                        <td className="px-4 py-3 text-xs">{pv.applicantName || <span className="text-ink/30">Anon</span>}</td>
                        <td className="px-4 py-3 text-xs">{pv.applicantEmail || '—'}</td>
                        <td className="px-4 py-3 font-mono text-[10px] text-ink/30 max-w-[100px] truncate">{pv.sessionId}</td>
                      </tr>
                    ))}
                    {pageViews.length === 0 && (
                      <tr><td colSpan={12} className="text-ink/40 text-center py-12">No records found</td></tr>
                    )}
                  </tbody>
                </table>

                {/* Pagination */}
                {pvMeta.totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-4 border-t border-hairline">
                    <span className="text-xs text-ink/40">
                      Page {pvMeta.page} of {pvMeta.totalPages} ({pvMeta.total.toLocaleString()} total records)
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => loadPageViews(pvMeta.page - 1)}
                        disabled={pvMeta.page <= 1}
                        className="px-3 py-1 border border-hairline text-xs disabled:opacity-30 hover:bg-alabaster transition-colors cursor-pointer"
                      >
                        ← Prev
                      </button>
                      <button
                        onClick={() => loadPageViews(pvMeta.page + 1)}
                        disabled={pvMeta.page >= pvMeta.totalPages}
                        className="px-3 py-1 border border-hairline text-xs disabled:opacity-30 hover:bg-alabaster transition-colors cursor-pointer"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
