"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Share2, Copy, Check, Award, ExternalLink, Users, Gift, ChevronRight } from 'lucide-react';

export default function ReferralHubPage() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copySuccess, setCopySuccess] = useState(false);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    fetchReferralData();
  }, [isAuthenticated, authLoading, router]);

  const fetchReferralData = async () => {
    try {
      const res = await api.getMyReferralProfile();
      setData(res);
    } catch (err) {
      console.error('Failed to fetch referral data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEnableAffiliate = async () => {
    setEnabling(true);
    try {
      await api.enableAffiliate();
      await fetchReferralData();
    } catch (err) {
      console.error('Failed to enable affiliate:', err);
    } finally {
      setEnabling(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-parchment">
        <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Define reward tiers
  const tiers = [
    { count: 5, label: 'Bronze Connector', icon: '🥉' },
    { count: 25, label: 'Silver Advocate', icon: '🥈' },
    { count: 100, label: 'Gold Visionary', icon: '🥇' },
  ];

  const nextTier = tiers.find(t => t.count > (data?.totalReferrals || 0));
  const progress = nextTier 
    ? ((data?.totalReferrals || 0) / nextTier.count) * 100 
    : 100;

  return (
    <div className="min-h-screen flex text-ink bg-parchment font-sans selection:bg-forest/20 selection:text-forest">
      {/* Sidebar (copied logic from Hub for consistency) */}
      <aside className="w-[250px] border-r border-hairline flex-shrink-0 h-screen sticky top-0 flex flex-col justify-between py-12 px-8">
        <div>
          <div className="mb-16">
            <span className="font-serif text-2xl font-bold tracking-tight">The Founder's<br />Club.</span>
          </div>
          <nav className="flex flex-col gap-6">
            {[
              { label: 'Overview', href: '/hub' },
              { label: 'Referrals & Rewards', active: true, href: '/hub/referrals' },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`group flex items-center gap-3 font-medium text-sm tracking-wide uppercase transition-colors ${item.active ? 'text-ink' : 'text-ink/40 hover:text-ink'}`}
              >
                <span className={`w-1 h-1 ${item.active ? 'bg-forest' : 'bg-transparent group-hover:bg-ink'}`} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </div>
      </aside>

      <main className="flex-1 px-16 py-12 overflow-y-auto">
        <div className="max-w-[1000px] mx-auto">
          <header className="mb-12">
            <p className="text-sm uppercase tracking-widest text-forest font-semibold mb-2 flex items-center gap-2">
              <Award className="w-4 h-4" /> Rewards & Recognition
            </p>
            <h1 className="font-serif text-5xl font-bold">Referral Hub</h1>
          </header>

          {!data?.isAffiliate ? (
            <section className="bg-white border border-hairline p-12 text-center flex flex-col items-center shadow-sm">
              <div className="w-20 h-20 bg-forest/10 rounded-full flex items-center justify-center mb-6">
                <Gift className="w-10 h-10 text-forest" />
              </div>
              <h2 className="font-serif text-3xl font-bold mb-4">Join the Affiliate Circle</h2>
              <p className="text-ink/60 text-lg mb-8 max-w-lg leading-relaxed">
                Refer other high-caliber founders to Arya and earn exclusive badges, digital certificates, and priority reviewer status.
              </p>
              <button 
                onClick={handleEnableAffiliate}
                disabled={enabling}
                className="bg-forest text-white px-10 py-4 font-bold uppercase tracking-widest hover:bg-forest/90 transition-all shadow-lg hover:shadow-forest/20"
              >
                {enabling ? 'Activating...' : 'Activate My Referral Link'}
              </button>
            </section>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
              {/* Left Column: Stats & Link */}
              <div className="lg:col-span-8 flex flex-col gap-10">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white border border-hairline p-6 shadow-sm">
                    <p className="text-[11px] uppercase tracking-widest text-ink/40 font-bold mb-1">Total Referrals</p>
                    <p className="font-serif text-4xl font-bold text-forest">{data.totalReferrals}</p>
                  </div>
                  <div className="bg-white border border-hairline p-6 shadow-sm">
                    <p className="text-[11px] uppercase tracking-widest text-ink/40 font-bold mb-1">Badges Earned</p>
                    <p className="font-serif text-4xl font-bold text-terracotta">{data.badges.length}</p>
                  </div>
                  <div className="bg-white border border-hairline p-6 shadow-sm">
                    <p className="text-[11px] uppercase tracking-widest text-ink/40 font-bold mb-1">Certificates</p>
                    <p className="font-serif text-4xl font-bold text-ink">{data.certificates.length}</p>
                  </div>
                </div>

                {/* Referral Link Card */}
                <div className="bg-ink text-parchment p-8 shadow-xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-forest/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-700"></div>
                  <div className="relative z-10">
                    <h3 className="font-serif text-2xl font-bold mb-2">Your Personal Invite Link</h3>
                    <p className="text-parchment/60 text-sm mb-6">Share this link with your network to track your referrals.</p>
                    <div className="flex gap-2">
                      <div className="flex-1 bg-white/10 border border-white/20 px-4 py-3 font-mono text-sm overflow-hidden text-ellipsis whitespace-nowrap">
                        {data.referralLink}
                      </div>
                      <button 
                        onClick={() => copyToClipboard(data.referralLink)}
                        className={`px-6 py-3 flex items-center gap-2 font-bold uppercase tracking-widest transition-all ${copySuccess ? 'bg-forest text-white' : 'bg-parchment text-ink hover:bg-white'}`}
                      >
                        {copySuccess ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        {copySuccess ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                {nextTier && (
                  <div className="bg-white border border-hairline p-8 shadow-sm">
                    <div className="flex justify-between items-end mb-4">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-ink/40 mb-1">Quest to {nextTier.label}</p>
                        <p className="font-serif text-xl font-bold">
                          {nextTier.count - data.totalReferrals} more to unlock
                        </p>
                      </div>
                      <p className="text-2xl">{nextTier.icon}</p>
                    </div>
                    <div className="w-full h-3 bg-parchment rounded-full overflow-hidden border border-hairline">
                      <div 
                        className="h-full bg-forest transition-all duration-1000 ease-out"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  </div>
                )}

                {/* Referrals List */}
                <section>
                  <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
                    <Users className="w-6 h-6 text-forest" />
                    My Referrals
                  </h2>
                  <div className="bg-white border border-hairline overflow-hidden">
                    {data.referrals.length > 0 ? (
                      <table className="w-full text-left">
                        <thead className="bg-parchment/50 border-b border-hairline">
                          <tr>
                            <th className="px-6 py-4 text-[11px] uppercase tracking-widest text-ink/40 font-bold">Full Name</th>
                            <th className="px-6 py-4 text-[11px] uppercase tracking-widest text-ink/40 font-bold">Date Applied</th>
                            <th className="px-6 py-4 text-[11px] uppercase tracking-widest text-ink/40 font-bold">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline text-sm">
                          {data.referrals.map((r: any) => (
                            <tr key={r.id} className="hover:bg-parchment/30 transition-colors">
                              <td className="px-6 py-4 font-medium">{r.name}</td>
                              <td className="px-6 py-4 text-ink/60">{new Date(r.appliedAt).toLocaleDateString()}</td>
                              <td className="px-6 py-4">
                                <span className={`inline-block px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded-sm ${
                                  r.status === 'ACCEPTED' ? 'bg-forest/10 text-forest' : 
                                  r.status === 'REJECTED' ? 'bg-terracotta/10 text-terracotta' : 
                                  'bg-ink/5 text-ink/40'
                                }`}>
                                  {r.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-12 text-center text-ink/40 uppercase tracking-widest text-xs">
                        No referrals tracked yet.
                      </div>
                    )}
                  </div>
                </section>
              </div>

              {/* Right Column: Badges & Certificates */}
              <div className="lg:col-span-4 flex flex-col gap-10">
                {/* Badges Section */}
                <section>
                  <h2 className="font-serif text-xl font-bold mb-6 flex items-center gap-3">
                    <Award className="w-5 h-5 text-terracotta" />
                    Achievements
                  </h2>
                  <div className="flex flex-col gap-4">
                    {data.badges.map((b: any) => (
                      <div key={b.id} className="bg-white border border-hairline p-5 flex items-center gap-4 group hover:border-terracotta/50 transition-colors">
                        <div className="w-12 h-12 bg-parchment rounded-full flex items-center justify-center text-2xl shadow-inner group-hover:bg-terracotta/10 transition-colors">
                          {b.icon || '🏅'}
                        </div>
                        <div>
                          <p className="font-bold text-sm mb-0.5">{b.name}</p>
                          <p className="text-[11px] text-ink/40 leading-snug">{b.description}</p>
                        </div>
                      </div>
                    ))}
                    {data.badges.length === 0 && (
                      <div className="bg-white/50 border border-dashed border-hairline p-8 text-center">
                        <p className="text-[10px] uppercase tracking-widest text-ink/40 italic">
                          Unlock badges by reaching referral milestones.
                        </p>
                      </div>
                    )}
                  </div>
                </section>

                {/* Certificates Section */}
                <section>
                  <h2 className="font-serif text-xl font-bold mb-6 flex items-center gap-3">
                    <Share2 className="w-5 h-5 text-ink" />
                    Credentials
                  </h2>
                  <div className="flex flex-col gap-4">
                    {data.certificates.map((c: any) => (
                      <div key={c.id} className="bg-white border-2 border-ink p-6 relative group overflow-hidden shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                        <div className="relative z-10">
                          <p className="text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-2">Verified Credential</p>
                          <h4 className="font-serif text-lg font-bold mb-4">{c.title}</h4>
                          <div className="flex flex-col gap-3">
                            <a 
                              href={c.linkedinUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="bg-[#0077B5] text-white py-2 px-4 text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#005a8d] transition-colors"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                              Add to Profile
                            </a>
                            <a 
                              href={c.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="bg-parchment text-ink border border-ink/10 py-2 px-4 text-xs font-bold flex items-center justify-center gap-2 hover:bg-white transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              View Certificate
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                    {data.certificates.length === 0 && (
                      <div className="bg-white/50 border border-dashed border-hairline p-8 text-center">
                        <p className="text-[10px] uppercase tracking-widest text-ink/40 italic">
                          Earn certificates as you climb the ranks.
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
