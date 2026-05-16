'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Layout from '@/components/Layout';
import Link from 'next/link';

export default function InvestorShowcase() {
  const [showcases, setShowcases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShowcase, setSelectedShowcase] = useState<any>(null);
  const [meetingForm, setMeetingForm] = useState({ investorId: '', date: '', message: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Documentary
  const [docShowcase, setDocShowcase] = useState<any>(null);
  const [docClips, setDocClips] = useState<any[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [docStreamUrls, setDocStreamUrls] = useState<Record<string, string>>({});

  async function handleWatchDocumentary(showcase: any) {
    setDocShowcase(showcase);
    setDocClips([]);
    setDocStreamUrls({});
    setDocLoading(true);
    const teamId = showcase.teamId ?? showcase.team?.id;
    if (!teamId) { setDocLoading(false); return; }
    try {
      const clips = await api.getPublishedDocumentaryClips(teamId);
      setDocClips(clips);
    } catch {
      setDocClips([]);
    } finally {
      setDocLoading(false);
    }
  }

  async function handleGetStreamUrl(clipId: string) {
    if (docStreamUrls[clipId]) {
      window.open(docStreamUrls[clipId], '_blank', 'noopener');
      return;
    }
    try {
      const { url } = await api.getInvestorClipStreamUrl(clipId);
      setDocStreamUrls((prev) => ({ ...prev, [clipId]: url }));
      window.open(url, '_blank', 'noopener');
    } catch (err: any) {
      alert(err.message);
    }
  }

  useEffect(() => {
    api.getStartupShowcases()
      .then(setShowcases)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleRequestMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingForm.investorId) {
      alert("Please provide your Investor ID (received upon registration approval).");
      return;
    }
    
    setIsSubmitting(true);
    try {
      await api.requestMeeting(meetingForm.investorId, {
        showcaseId: selectedShowcase.id,
        date: meetingForm.date,
        message: meetingForm.message
      });
      alert("Meeting requested successfully. The founder will reach out to confirm.");
      setSelectedShowcase(null);
      setMeetingForm({ investorId: meetingForm.investorId, date: '', message: '' });
    } catch (err: any) {
      alert(err.message || "Failed to request meeting. Please check your Investor ID.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Layout activeTab="investors">
      <div className="max-w-[1200px] mx-auto py-20 px-6 animate-fade-in">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-16 border-b border-hairline pb-8">
          <div>
            <h1 className="font-serif text-5xl font-bold mb-4">Startup Showcase</h1>
            <p className="text-lg text-ink/70 max-w-2xl">
              Discover and connect with high-potential teams built within the Arya network. 
              Only actively fundraising alumni are showcased here.
            </p>
          </div>
          <div>
            <Link href="/investors/register" className="btn btn-primary px-8 py-4">
              Apply for Access
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="flex-center py-20">
            <div className="spinner mb-4"></div>
            <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Deal Flow...</p>
          </div>
        ) : showcases.length === 0 ? (
          <div className="text-center py-20 border border-hairline border-dashed bg-parchment/30">
            <h3 className="font-serif text-2xl font-bold mb-2">No Active Showcases</h3>
            <p className="text-ink/60">Our current cohort is still in the building phase. Check back later.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {showcases.map(showcase => (
              <div key={showcase.id} className="border border-hairline bg-white hover:shadow-lg transition-shadow flex flex-col h-full">
                <div className="p-6 flex-1">
                  <div className="flex justify-between items-start mb-4">
                    <span className="bg-forest/10 text-forest text-[10px] uppercase font-bold tracking-widest px-2 py-1">
                      {showcase.team.ideaCategory || 'General'}
                    </span>
                    <span className="text-xs font-semibold text-ink/60">Goal: ${showcase.fundingGoal.toLocaleString()}</span>
                  </div>
                  
                  <h3 className="font-serif text-2xl font-bold mb-2">{showcase.team.name}</h3>
                  <p className="text-sm text-ink/80 mb-6 line-clamp-3 leading-relaxed">
                    {showcase.description}
                  </p>

                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-4 border-t border-hairline pt-4 mb-6">
                    <div>
                      <span className="block text-[10px] uppercase tracking-widest text-ink/50 mb-1">Traction</span>
                      <span className="font-semibold text-sm">{showcase.metrics?.traction || 'Pre-seed'}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-widest text-ink/50 mb-1">Deck</span>
                      {showcase.pitchDeckUrl ? (
                        <a href={showcase.pitchDeckUrl} target="_blank" rel="noreferrer" className="text-forest hover:underline text-sm font-semibold">
                          View Deck ↗
                        </a>
                      ) : (
                        <span className="text-sm text-ink/40">Not available</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-hairline bg-parchment/30 flex gap-2">
                  <button
                    onClick={() => handleWatchDocumentary(showcase)}
                    className="flex-1 btn btn-secondary bg-white hover:text-forest hover:border-forest transition-colors text-[10px]"
                  >
                    Watch Journey ▶
                  </button>
                  <button
                    onClick={() => setSelectedShowcase(showcase)}
                    className="flex-1 btn btn-secondary bg-white hover:text-forest hover:border-forest transition-colors"
                  >
                    Request Meeting
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Meeting Modal */}
        {selectedShowcase && (
          <div className="fixed inset-0 z-50 bg-ink/90 backdrop-blur-sm flex justify-center items-center p-4" onClick={() => setSelectedShowcase(null)}>
            <div className="bg-white max-w-lg w-full p-8 relative animate-fade-in" onClick={e => e.stopPropagation()}>
              <button 
                onClick={() => setSelectedShowcase(null)} 
                className="absolute top-4 right-6 text-2xl text-ink/40 hover:text-terracotta transition-colors"
              >
                ✕
              </button>
              
              <h2 className="font-serif text-3xl font-bold mb-2">Request Meeting</h2>
              <p className="text-ink/60 mb-8 pb-6 border-b border-hairline">
                Connect with <span className="font-bold text-ink">{selectedShowcase.team.name}</span>
              </p>

              <form onSubmit={handleRequestMeeting} className="grid gap-6">
                <div>
                  <label className="block text-xs uppercase tracking-widest font-semibold text-ink/70 mb-2">
                    Your Investor ID
                  </label>
                  <input 
                    type="text" required 
                    placeholder="INV-..."
                    className="w-full bg-parchment/30 border border-hairline px-4 py-3 focus:border-forest outline-none"
                    value={meetingForm.investorId} onChange={e => setMeetingForm({...meetingForm, investorId: e.target.value})} 
                  />
                  <p className="text-[10px] text-ink/50 mt-1 uppercase tracking-widest">Provided in your approval email</p>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-widest font-semibold text-ink/70 mb-2">
                    Proposed Date
                  </label>
                  <input 
                    type="date" required 
                    className="w-full bg-parchment/30 border border-hairline px-4 py-3 focus:border-forest outline-none"
                    value={meetingForm.date} onChange={e => setMeetingForm({...meetingForm, date: e.target.value})} 
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-widest font-semibold text-ink/70 mb-2">
                    Message to Founders (Optional)
                  </label>
                  <textarea 
                    rows={3}
                    className="w-full bg-parchment/30 border border-hairline px-4 py-3 focus:border-forest outline-none resize-none"
                    value={meetingForm.message} onChange={e => setMeetingForm({...meetingForm, message: e.target.value})} 
                  />
                </div>

                <div className="pt-6 border-t border-hairline mt-2">
                  <button type="submit" disabled={isSubmitting} className="w-full btn bg-forest hover:bg-forest/90 text-white py-4 font-bold tracking-widest">
                    {isSubmitting ? 'Sending Request...' : 'SUBMIT REQUEST'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Documentary Modal */}
        {docShowcase && (
          <div className="fixed inset-0 z-50 bg-ink/90 backdrop-blur-sm flex justify-center items-center p-4" onClick={() => setDocShowcase(null)}>
            <div className="bg-white max-w-2xl w-full p-8 relative animate-fade-in max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setDocShowcase(null)} className="absolute top-4 right-6 text-2xl text-ink/40 hover:text-terracotta transition-colors">✕</button>
              <p className="text-[10px] uppercase tracking-widest text-forest font-bold mb-2">90-Day Journey</p>
              <h2 className="font-serif text-3xl font-bold mb-1">{docShowcase.team?.name}</h2>
              <p className="text-sm text-ink/60 mb-8 pb-6 border-b border-hairline">Documentary clips — watch their story before you decide.</p>

              {docLoading && (
                <div className="text-center py-12 text-ink/50 uppercase tracking-widest text-xs">Loading clips…</div>
              )}
              {!docLoading && docClips.length === 0 && (
                <div className="text-center py-12 border border-hairline bg-parchment/30">
                  <p className="text-ink/60 text-sm">No documentary clips have been published for this team yet.</p>
                  <p className="text-ink/40 text-xs mt-1 uppercase tracking-widest">Check back as the sprint progresses</p>
                </div>
              )}
              {!docLoading && docClips.length > 0 && (
                <div className="space-y-4">
                  {docClips.map((clip: any) => (
                    <div key={clip.id} className="flex items-center gap-4 border border-hairline p-4 hover:bg-parchment/30 transition-colors">
                      <div className="w-16 h-12 bg-ink/5 border border-hairline flex items-center justify-center shrink-0">
                        {clip.thumbnailUrl ? (
                          <img src={clip.thumbnailUrl} alt={clip.title} className="w-full h-full object-cover" />
                        ) : (
                          <svg className="w-6 h-6 text-ink/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.845v6.31a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm">{clip.title}</p>
                        {clip.description && <p className="text-xs text-ink/50 mt-0.5 line-clamp-1">{clip.description}</p>}
                        <p className="text-[10px] text-ink/30 uppercase tracking-widest mt-1">Week {clip.week}</p>
                      </div>
                      <button
                        onClick={() => handleGetStreamUrl(clip.id)}
                        className="shrink-0 text-[10px] uppercase tracking-widest font-bold border border-forest text-forest px-4 py-2 hover:bg-forest hover:text-white transition-colors"
                      >
                        Play ▶
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
