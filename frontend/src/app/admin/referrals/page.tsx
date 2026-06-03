'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Users, UserPlus, TrendingUp, Search, ChevronLeft, ChevronRight, ToggleLeft, ToggleRight, Copy, Check, ExternalLink } from 'lucide-react';

interface ReferralStats {
  totalReferrals: number;
  totalAffiliates: number;
  topReferrers: TopReferrer[];
}

interface TopReferrer {
  applicantId: string;
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  status: string;
  referralCode: string;
  totalReferrals: number;
  isActive: boolean;
  createdAt: string;
}

interface ReferredApplicant {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  status: string;
  appliedAt: string;
  referredBy: {
    id: string;
    name: string;
    email: string;
    referralCode: string | null;
  } | null;
}

export default function AdminReferralsPage() {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [referrals, setReferrals] = useState<ReferredApplicant[]>([]);
  const [meta, setMeta] = useState<{ total: number; page: number; totalPages: number }>({ total: 0, page: 1, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'referrals' | 'affiliates'>('overview');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Expanded affiliate detail
  const [expandedAffiliate, setExpandedAffiliate] = useState<string | null>(null);
  const [affiliateDetail, setAffiliateDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Load dashboard stats
  useEffect(() => {
    api.getAdminReferralStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Load referrals list
  const loadReferrals = (page = 1) => {
    setLoadingList(true);
    const params: Record<string, string> = { page: String(page), limit: '15' };
    if (search.trim()) params.search = search.trim();
    api.getAdminReferrals(params)
      .then(res => {
        setReferrals(res.data);
        setMeta(res.meta);
      })
      .catch(console.error)
      .finally(() => setLoadingList(false));
  };

  useEffect(() => {
    if (activeTab === 'referrals') {
      loadReferrals(1);
    }
  }, [activeTab]);

  // Load affiliate detail
  const loadAffiliateDetail = async (applicantId: string) => {
    if (expandedAffiliate === applicantId) {
      setExpandedAffiliate(null);
      return;
    }
    setExpandedAffiliate(applicantId);
    setLoadingDetail(true);
    try {
      const detail = await api.getAffiliateDetail(applicantId);
      setAffiliateDetail(detail);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Toggle affiliate status
  const toggleAffiliate = async (applicantId: string, currentActive: boolean) => {
    try {
      await api.toggleAffiliateStatus(applicantId, !currentActive);
      // Refresh stats
      const updated = await api.getAdminReferralStats();
      setStats(updated);
    } catch (e) {
      console.error(e);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/apply?ref=${code}`);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: 'bg-marigold/15 text-warning border-marigold/40',
      ELIGIBLE: 'bg-forest/10 text-forest border-forest/20',
      CONSENTED: 'bg-success/10 text-success border-success/25',
      ACTIVE: 'bg-saffron/10 text-saffron-deep border-saffron/20',
      REMOVED: 'bg-terracotta/10 text-terracotta border-terracotta/20',
      INELIGIBLE: 'bg-ink/5 text-ink/50 border-ink/15',
    };
    return (
      <span className={`px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${colors[status] || 'bg-ink/5 text-ink/50 border-ink/15'}`}>
        {status}
      </span>
    );
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Referral Data</p>
      </div>
    </div>
  );

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-12 flex justify-between items-end">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Referral Engine</h1>
          <p className="text-ink/50 mt-2 font-serif italic">Track affiliate performance and referral flows</p>
        </div>
      </header>

      {/* Stat Cards */}
      <section className="mb-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border border-hairline bg-white p-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-forest/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-forest" />
              </div>
              <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Total Referrals</span>
            </div>
            <div className="font-serif text-4xl font-bold text-forest">{stats?.totalReferrals || 0}</div>
            <p className="text-[10px] text-ink/40 mt-2 uppercase tracking-widest">Applicants who were referred</p>
          </div>

          <div className="border border-hairline bg-white p-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-terracotta-warm/10 flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-terracotta-warm" />
              </div>
              <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Active Affiliates</span>
            </div>
            <div className="font-serif text-4xl font-bold text-terracotta-warm">{stats?.totalAffiliates || 0}</div>
            <p className="text-[10px] text-ink/40 mt-2 uppercase tracking-widest">Members with referral links</p>
          </div>

          <div className="border border-hairline bg-white p-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-ink/5 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-ink/60" />
              </div>
              <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Conversion Rate</span>
            </div>
            <div className="font-serif text-4xl font-bold">
              {stats && stats.totalAffiliates > 0 
                ? `${Math.round((stats.totalReferrals / stats.totalAffiliates) * 10) / 10}x`
                : '0x'}
            </div>
            <p className="text-[10px] text-ink/40 mt-2 uppercase tracking-widest">Avg referrals per affiliate</p>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-hairline mb-8">
        {(['overview', 'referrals', 'affiliates'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-3 text-[10px] uppercase tracking-widest font-bold transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-saffron text-saffron-deep'
                : 'border-transparent text-ink/40 hover:text-terracotta-warm'
            }`}
          >
            {tab === 'overview' ? 'Top Referrers' : tab === 'referrals' ? 'All Referrals' : 'Affiliate Manager'}
          </button>
        ))}
      </div>

      {/* Tab Content */}

      {/* TOP REFERRERS */}
      {activeTab === 'overview' && (
        <section className="animate-fade-in">
          <div className="bg-ink text-parchment border border-hairline">
            <div className="p-6 border-b border-parchment/10">
              <h3 className="font-serif text-xl font-bold">Leaderboard — Top 50 Referrers</h3>
            </div>
            {!stats?.topReferrers?.length ? (
              <div className="p-12 text-center text-parchment/40">
                <UserPlus className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="font-serif italic">No affiliates have generated referrals yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-parchment/10">
                {stats.topReferrers.map((ref, idx) => (
                  <div key={ref.applicantId} className="flex items-center gap-6 p-5 hover:bg-parchment/5 transition-colors group">
                    {/* Rank */}
                    <span className={`font-serif text-2xl font-bold w-8 text-center ${idx < 3 ? 'text-terracotta-warm' : 'text-parchment/30'}`}>
                      {idx + 1}
                    </span>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-sm truncate">{ref.name}</span>
                        {statusBadge(ref.status)}
                        {!ref.isActive && (
                          <span className="px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border bg-red-900/20 text-red-400 border-red-400/30">
                            Disabled
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        <span className="text-[10px] text-parchment/40">{ref.email}</span>
                        {ref.phone && <span className="text-[10px] text-parchment/40">{ref.phone}</span>}
                        {ref.city && <span className="text-[10px] text-parchment/40">{ref.city}</span>}
                      </div>
                    </div>

                    {/* Referral Code */}
                    <div className="hidden md:flex items-center gap-2">
                      <code className="text-xs font-mono bg-parchment/10 px-3 py-1 text-parchment/70">{ref.referralCode}</code>
                      <button
                        onClick={() => copyCode(ref.referralCode)}
                        className="text-parchment/40 hover:text-parchment transition-colors"
                        title="Copy referral link"
                      >
                        {copiedCode === ref.referralCode ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>

                    {/* Count */}
                    <div className="text-right">
                      <div className="font-serif text-2xl font-bold text-terracotta-warm">{ref.totalReferrals}</div>
                      <div className="text-[9px] uppercase tracking-widest text-parchment/40">referrals</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ALL REFERRALS */}
      {activeTab === 'referrals' && (
        <section className="animate-fade-in">
          {/* Search */}
          <div className="flex gap-3 mb-6">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/30" />
              <input
                type="text"
                placeholder="Search by name or email..."
                className="w-full bg-white border border-hairline pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-forest transition-colors"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') loadReferrals(1); }}
              />
            </div>
            <button
              onClick={() => loadReferrals(1)}
              className="px-6 py-3 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep transition-colors"
            >
              Search
            </button>
          </div>

          {/* Results */}
          <div className="border border-hairline bg-white">
            {loadingList ? (
              <div className="p-12 text-center">
                <div className="w-6 h-6 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                <p className="text-ink/40 text-xs uppercase tracking-widest">Loading...</p>
              </div>
            ) : referrals.length === 0 ? (
              <div className="p-12 text-center text-ink/40">
                <Users className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="font-serif italic">No referred applicants found.</p>
              </div>
            ) : (
              <>
                {/* Table Header */}
                <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
                  <div className="col-span-3">Applicant</div>
                  <div className="col-span-2">Contact</div>
                  <div className="col-span-1">City</div>
                  <div className="col-span-1">Status</div>
                  <div className="col-span-3">Referred By</div>
                  <div className="col-span-2">Applied</div>
                </div>

                {/* Table Rows */}
                {referrals.map(ref => (
                  <div key={ref.id} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm">
                    <div className="col-span-3 font-bold truncate">{ref.name}</div>
                    <div className="col-span-2 text-ink/60 truncate text-xs">{ref.email}</div>
                    <div className="col-span-1 text-ink/60 text-xs">{ref.city || '—'}</div>
                    <div className="col-span-1">{statusBadge(ref.status)}</div>
                    <div className="col-span-3">
                      {ref.referredBy ? (
                        <div>
                          <span className="text-forest font-semibold text-xs">{ref.referredBy.name}</span>
                          {ref.referredBy.referralCode && (
                            <code className="ml-2 text-[10px] bg-forest/10 text-forest px-1.5 py-0.5">{ref.referredBy.referralCode}</code>
                          )}
                        </div>
                      ) : '—'}
                    </div>
                    <div className="col-span-2 text-ink/40 text-xs">
                      {new Date(ref.appliedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                ))}

                {/* Pagination */}
                <div className="flex items-center justify-between px-6 py-4 bg-alabaster/50">
                  <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">
                    {meta.total} total referrals · Page {meta.page} of {meta.totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      disabled={meta.page <= 1}
                      onClick={() => loadReferrals(meta.page - 1)}
                      className="p-2 border border-hairline hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      disabled={meta.page >= meta.totalPages}
                      onClick={() => loadReferrals(meta.page + 1)}
                      className="p-2 border border-hairline hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* AFFILIATE MANAGER */}
      {activeTab === 'affiliates' && (
        <section className="animate-fade-in">
          <p className="text-ink/50 text-sm mb-6 font-serif italic">
            Manage affiliate accounts. Toggle active status or view detailed referral chains for each affiliate.
          </p>

          {!stats?.topReferrers?.length ? (
            <div className="border border-hairline bg-white p-12 text-center text-ink/40">
              <UserPlus className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="font-serif italic">No affiliates registered yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {stats.topReferrers.map(ref => (
                <div key={ref.applicantId} className="border border-hairline bg-white">
                  {/* Affiliate Row */}
                  <div className="flex items-center gap-4 p-5">
                    {/* Toggle */}
                    <button
                      onClick={() => toggleAffiliate(ref.applicantId, ref.isActive)}
                      className={`transition-colors ${ref.isActive ? 'text-saffron-deep' : 'text-ink/20'}`}
                      title={ref.isActive ? 'Disable affiliate' : 'Enable affiliate'}
                    >
                      {ref.isActive ? <ToggleRight className="w-7 h-7" /> : <ToggleLeft className="w-7 h-7" />}
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="font-bold">{ref.name}</span>
                        {statusBadge(ref.status)}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-[10px] text-ink/40">
                        <span>{ref.email}</span>
                        {ref.phone && <span>{ref.phone}</span>}
                        {ref.city && <span>{ref.city}</span>}
                      </div>
                    </div>

                    {/* Code & Stats */}
                    <div className="flex items-center gap-6">
                      <div className="hidden md:flex items-center gap-2">
                        <code className="text-xs font-mono bg-forest/10 text-forest px-3 py-1.5 font-bold">{ref.referralCode}</code>
                        <button
                          onClick={() => copyCode(ref.referralCode)}
                          className="text-ink/30 hover:text-forest transition-colors"
                        >
                          {copiedCode === ref.referralCode ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>

                      <div className="text-center">
                        <div className="font-serif text-xl font-bold text-forest">{ref.totalReferrals}</div>
                        <div className="text-[9px] uppercase tracking-widest text-ink/40">referrals</div>
                      </div>

                      {/* Expand */}
                      <button
                        onClick={() => loadAffiliateDetail(ref.applicantId)}
                        className="p-2 border border-hairline hover:bg-alabaster transition-colors"
                        title="View referral chain"
                      >
                        <ExternalLink className="w-4 h-4 text-ink/40" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {expandedAffiliate === ref.applicantId && (
                    <div className="border-t border-hairline bg-alabaster/50 p-6">
                      {loadingDetail ? (
                        <div className="flex items-center gap-3 text-ink/40">
                          <div className="w-4 h-4 border-2 border-forest border-t-transparent rounded-full animate-spin"></div>
                          <span className="text-xs uppercase tracking-widest">Loading referral chain...</span>
                        </div>
                      ) : affiliateDetail?.referredApplicants?.length > 0 ? (
                        <div>
                          <h4 className="text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-4">
                            Referred Applicants ({affiliateDetail.referredApplicants.length})
                          </h4>
                          <div className="grid gap-2">
                            {affiliateDetail.referredApplicants.map((a: any) => (
                              <div key={a.id} className="flex items-center gap-4 bg-white border border-hairline p-3 text-sm">
                                <span className="font-bold flex-1">{a.name}</span>
                                <span className="text-ink/40 text-xs">{a.email}</span>
                                <span className="text-ink/40 text-xs">{a.city || '—'}</span>
                                {statusBadge(a.status)}
                                {a.batchNumber && (
                                  <span className="text-[10px] text-ink/30 uppercase tracking-widest">Batch #{a.batchNumber}</span>
                                )}
                                {a.teamName && (
                                  <span className="text-[10px] text-forest uppercase tracking-widest font-bold">{a.teamName}</span>
                                )}
                                <span className="text-[10px] text-ink/30">
                                  {new Date(a.appliedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-ink/40 text-sm font-serif italic">No referred applicants yet.</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
