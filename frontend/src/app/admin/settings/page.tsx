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
  aggregatedPaths?: { path: string; count: number }[];
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
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  // Pledge Pricing State
  const [pledgePricing, setPledgePricing] = useState<{id: string, label: string, amount: number}[]>([]);
  const [pricingLoaded, setPricingLoaded] = useState(false);

  const addPricingItem = () => {
    setPledgePricing(prev => [...prev, { id: Math.random().toString(36).substring(2, 9), label: 'New Charge', amount: 0 }]);
  };

  const removePricingItem = (id: string) => {
    setPledgePricing(prev => prev.filter(item => item.id !== id));
  };

  const updatePricingItem = (id: string, field: 'label' | 'amount', value: string | number) => {
    setPledgePricing(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const savePricing = () => {
    saveSetting('pledgePricing', JSON.stringify(pledgePricing));
  };

  // Load settings
  useEffect(() => {
    api.getSettings()
      .then(setSettings)
      .catch(() => {})
      .finally(() => setSettingsLoading(false));
  }, []);

  // Initialize pledge pricing
  useEffect(() => {
    if (activeTab === 'settings' && !settingsLoading && !pricingLoaded) {
      if (settings.pledgePricing) {
        try {
          setPledgePricing(JSON.parse(settings.pledgePricing));
        } catch {
          setPledgePricing([{ id: 'base', label: 'Base Price', amount: 10000 }]);
        }
      } else {
        setPledgePricing([{ id: 'base', label: 'Base Price', amount: 10000 }]);
      }
      setPricingLoaded(true);
    }
  }, [activeTab, settingsLoading, settings.pledgePricing, pricingLoaded]);

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
      setExpandedRows({});
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

              {/* Pledge Pricing Structure */}
              <section className="bg-white border border-hairline p-8">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="font-serif text-2xl font-bold mb-2">Pledge Pricing Structure</h2>
                    <p className="text-xs uppercase tracking-widest text-ink/50">
                      Configure the exact line-item breakdown displayed during checkout
                    </p>
                  </div>
                  <button
                    onClick={savePricing}
                    disabled={saving}
                    className="bg-forest text-parchment px-6 py-2 text-xs uppercase tracking-widest font-semibold hover:bg-forest/90 transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Pricing Structure'}
                  </button>
                </div>

                <div className="space-y-4">
                  {pledgePricing.map((item, index) => (
                    <div key={item.id} className="flex items-center gap-4 bg-alabaster p-4 border border-hairline group">
                      <div className="flex-1 flex flex-col gap-2">
                        <label className="font-sans text-[10px] uppercase tracking-widest text-forest font-semibold">
                          Line Item Label
                        </label>
                        <input
                          type="text"
                          value={item.label}
                          onChange={(e) => updatePricingItem(item.id, 'label', e.target.value)}
                          placeholder="e.g. Base Price, Processing Fee"
                          className="border border-hairline px-4 py-2 text-sm bg-white focus:outline-none focus:border-forest"
                        />
                      </div>
                      <div className="w-48 flex flex-col gap-2">
                        <label className="font-sans text-[10px] uppercase tracking-widest text-forest font-semibold">
                          Amount (INR)
                        </label>
                        <input
                          type="number"
                          value={item.amount}
                          onChange={(e) => updatePricingItem(item.id, 'amount', Number(e.target.value))}
                          min="0"
                          className="border border-hairline px-4 py-2 text-sm bg-white focus:outline-none focus:border-forest"
                        />
                      </div>
                      <div className="pt-6">
                        <button
                          onClick={() => removePricingItem(item.id)}
                          className="p-2 text-ink/30 hover:text-terracotta transition-colors"
                          title="Remove item"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={addPricingItem}
                    className="w-full py-4 border-2 border-hairline border-dashed text-sm font-semibold text-forest hover:border-forest/30 hover:bg-forest/5 transition-all flex items-center justify-center gap-2"
                  >
                    <span>+</span> Add Fee / Line Item
                  </button>
                  
                  <div className="mt-6 pt-6 border-t border-hairline flex justify-between items-center bg-forest/5 p-4 border-l-4 border-l-forest">
                    <span className="font-serif italic text-forest">Total Calculated Pledge Amount</span>
                    <span className="text-xl font-mono font-bold text-forest">
                      ₹{pledgePricing.reduce((sum, item) => sum + Number(item.amount), 0).toLocaleString()}
                    </span>
                  </div>
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
                      {['User / IP', 'Last Active', 'Location', 'System Details', 'Paths Visited', 'Duration'].map((h) => (
                        <th key={h} className="px-4 py-3 text-[10px] uppercase tracking-widest text-ink/40 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                      <th className="px-4 py-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageViews.map((pv) => (
                      <div key={pv.id} className="contents">
                        <tr 
                          onClick={() => setExpandedRows(prev => ({ ...prev, [pv.id]: !prev[pv.id] }))}
                          className="border-b border-hairline/50 hover:bg-alabaster/50 transition-colors cursor-pointer"
                        >
                          <td className="px-4 py-4">
                            <div className="font-serif text-sm text-ink mb-1">{pv.applicantName || pv.applicantEmail || 'Anonymous'}</div>
                            <div className="font-mono text-[10px] text-ink/40 flex items-center gap-2">
                              <span className="bg-alabaster border border-hairline px-1.5 py-0.5 rounded">{pv.ip || 'Unknown IP'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-xs text-ink/60">
                            {new Date(pv.timestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-4">
                            <div className="text-xs font-semibold text-ink/80">{[pv.city, pv.country].filter(Boolean).join(', ') || 'Unknown Location'}</div>
                            <div className="text-[10px] text-ink/40 uppercase tracking-widest">{pv.region || '—'}</div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="text-xs text-ink/80">{[pv.browser, pv.os, pv.device].filter(Boolean).join(' • ') || '—'}</div>
                            <div className="text-[10px] text-ink/40 font-mono mt-1">{pv.screenWidth && pv.screenHeight ? `${pv.screenWidth}×${pv.screenHeight}` : '—'}</div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-forest">
                                {pv.aggregatedPaths ? pv.aggregatedPaths.reduce((acc, p) => acc + p.count, 0) : 0} Hits
                              </span>
                              <span className="text-[10px] text-ink/40 uppercase tracking-widest">
                                ({pv.aggregatedPaths?.length || 0} unique)
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="font-mono text-xs text-ink/60">
                              {Math.floor((pv.duration || 0) / 60)}m {(pv.duration || 0) % 60}s
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <span className={`inline-block transition-transform ${expandedRows[pv.id] ? 'rotate-180' : ''}`}>▼</span>
                          </td>
                        </tr>
                        {expandedRows[pv.id] && (
                          <tr className="bg-forest/5 border-b border-hairline/50">
                            <td colSpan={6} className="px-6 py-6 border-l-4 border-forest">
                              <h4 className="text-[10px] uppercase tracking-widest text-forest font-bold mb-4">Accessed URLs & Frequencies</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 max-w-4xl">
                                {pv.aggregatedPaths?.map((p, idx) => (
                                  <div key={idx} className="flex justify-between items-center py-2 border-b border-forest/10 last:border-0 hover:bg-forest/5 px-2 -mx-2 transition-colors">
                                    <span className="font-mono text-xs text-ink/70 truncate mr-4" title={p.path}>{p.path}</span>
                                    <span className="font-mono text-[10px] bg-forest/10 px-2 py-0.5 rounded-sm text-forest font-bold flex-shrink-0">
                                      {p.count} ×
                                    </span>
                                  </div>
                                ))}
                                {(!pv.aggregatedPaths || pv.aggregatedPaths.length === 0) && (
                                  <span className="text-xs text-ink/40 italic">No valid paths aggregated.</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </div>
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
