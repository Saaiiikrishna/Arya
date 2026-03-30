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

                <div className="p-4 border-t border-hairline bg-parchment/30">
                  <button 
                    onClick={() => setSelectedShowcase(showcase)}
                    className="w-full btn btn-secondary bg-white hover:text-forest hover:border-forest transition-colors"
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
      </div>
    </Layout>
  );
}
