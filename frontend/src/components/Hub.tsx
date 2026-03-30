"use client";

import { FileText, Users, Share2, LogOut, Check, Plus, ArrowRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import ChatWidget from './ChatWidget';

export default function Hub() {
  const [sprintData, setSprintData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Note: teamId would be fetched from auth context
    fetch('http://localhost:3000/sprints/team/dummy-team-id')
      .then(res => res.json())
      .then(data => {
        if (!data.error && data.id) setSprintData(data);
      })
      .catch(err => console.error('Failed to fetch sprint:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen flex text-ink selection:bg-forest/20 selection:text-forest">
      {/* Sidebar Navigation */}
      <aside className="w-[250px] border-r border-hairline flex-shrink-0 h-screen sticky top-0 flex flex-col justify-between py-12 px-8 bg-parchment">
        <div>
          <div className="mb-16">
            <span className="font-serif text-2xl font-bold tracking-tight">The Founder's<br />Club.</span>
          </div>
          <nav className="flex flex-col gap-6">
            {[
              { label: 'Overview', active: true, href: '/hub' },
              { label: 'Team Roster', active: false, href: '#' },
              { label: 'The Brief', active: false, href: '#' },
              { label: 'Timeline & Capital', active: false, href: '#' },
              { label: 'Training Modules', active: false, href: '/hub/training' },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`group flex items-center gap-3 font-medium text-sm tracking-wide uppercase transition-colors ${
                  item.active ? 'text-ink' : 'text-ink/40 hover:text-ink'
                }`}
              >
                <span className={`w-1 h-1 ${item.active ? 'bg-forest' : 'bg-transparent group-hover:bg-ink'}`} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </div>
        <div className="border-t border-hairline pt-8 mt-12">
          <p className="text-xs uppercase tracking-widest text-ink/40 mb-2">Cohort Beta</p>
          <p className="font-serif text-lg font-medium">Applicant #0842</p>
          <button className="mt-6 text-xs uppercase tracking-widest text-ink/40 hover:text-terracotta transition-colors flex items-center gap-2">
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 px-16 py-12 overflow-y-auto">
        <div className="max-w-[960px] mx-auto">
          {/* Header Section */}
          <header className="border-b border-hairline pb-8 mb-12 flex justify-between items-end">
            <div>
              <p className="text-sm uppercase tracking-widest text-forest font-medium mb-3">Command Center</p>
              <h1 className="font-serif text-5xl font-bold leading-none">Founder's Hub</h1>
            </div>
            <div className="text-right">
              <p className="text-3xl font-serif text-terracotta mb-1">Day 14 <span className="text-ink/40 text-xl">of 90</span></p>
              <p className="text-sm text-ink/40 uppercase tracking-widest">Prototype Phase</p>
            </div>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            {/* Left Column */}
            <div className="lg:col-span-7 flex flex-col gap-12">
              <section>
                <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
                  <FileText className="w-6 h-6 text-forest" />
                  The Idea Brief
                </h2>
                <div className="bg-white border border-hairline p-8">
                  <h3 className="font-serif text-xl font-medium mb-4">Project: Obsidian</h3>
                  <p className="text-base leading-relaxed text-ink mb-6">
                    A decentralized reputation protocol for peer-to-peer lending in emerging markets. The objective is to build a trustless ledger that assigns credit scores based on localized community vouching rather than traditional financial history.
                  </p>
                  <div className="grid grid-cols-2 gap-6 border-t border-hairline pt-6">
                    <div>
                      <p className="text-[13px] uppercase tracking-widest text-ink/40 mb-1">Target Market</p>
                      <p className="font-medium">Sub-Saharan Africa, SE Asia</p>
                    </div>
                    <div>
                      <p className="text-[13px] uppercase tracking-widest text-ink/40 mb-1">Initial Capital</p>
                      <p className="font-medium font-serif text-lg">$50,000 USD</p>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
                  <Users className="w-6 h-6 text-forest" />
                  Team Roster
                </h2>
                <div className="border-t border-hairline">
                  {[
                    { name: 'Elias Hayes', role: 'Technical Lead', email: 'elias.h@obsidian.pact', tz: 'GMT-5', initial: 'EH' },
                    { name: 'Sarah Chen', role: 'Product & Strategy', email: 'sarah.c@obsidian.pact', tz: 'GMT+8', initial: 'SC' },
                    { name: 'Marcus Kohl', role: 'Operations & GTM', email: 'marcus.k@obsidian.pact', tz: 'GMT+1', initial: 'MK' },
                  ].map((member) => (
                    <div key={member.name} className="flex items-center justify-between py-4 px-4 border-b border-hairline cursor-pointer group hover:bg-white hover:border-l-2 hover:border-l-terracotta transition-all">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-forest/10 flex items-center justify-center border border-forest/20">
                          <span className="font-serif font-bold text-forest">{member.initial}</span>
                        </div>
                        <div>
                          <p className="font-medium text-lg font-serif group-hover:text-terracotta transition-colors">{member.name}</p>
                          <p className="text-[13px] uppercase tracking-widest text-ink/40">{member.role}</p>
                        </div>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-sm text-ink">{member.email}</p>
                        <p className="text-xs text-ink/40">{member.tz}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <button className="mt-6 text-[13px] uppercase tracking-widest font-medium text-forest hover:text-terracotta transition-colors flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Request Additional Talent
                </button>
              </section>
            </div>

            {/* Right Column */}
            <div className="lg:col-span-5 flex flex-col gap-12">
              <section>
                <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
                  <Share2 className="w-6 h-6 text-forest" />
                  90-Day Sprint
                </h2>
                <div className="bg-white border border-hairline p-6 relative">
                  <div className="absolute left-[39px] top-6 bottom-6 w-[2px] bg-ink/10">
                    <div className="w-full bg-forest" style={{ height: '25%' }} />
                  </div>
                  <div className="flex flex-col gap-8 relative z-10">
                    {loading ? (
                      <div className="animate-pulse flex gap-6 items-start text-ink">Synchronizing sprint data...</div>
                    ) : sprintData && sprintData.milestones && sprintData.milestones.length > 0 ? (
                      sprintData.milestones.map((m: any) => (
                        <div key={m.id} className="flex gap-6 items-start">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${m.isCompleted ? 'bg-forest' : 'bg-parchment border-2 border-forest relative'}`}>
                            {m.isCompleted ? <Check className="w-4 h-4 text-white" /> : <div className="w-3 h-3 bg-forest rounded-full animate-pulse" />}
                          </div>
                          <div className={m.isCompleted ? "" : "bg-white border border-hairline p-4 shadow-sm w-full border-l-[3px] border-l-forest"}>
                            <p className={`text-[13px] uppercase tracking-widest font-bold mb-1 ${m.isCompleted ? 'text-forest' : 'text-terracotta'}`}>
                              Deadline: {new Date(m.deadline).toLocaleDateString()}
                            </p>
                            <p className="font-serif text-lg font-bold mb-2">{m.title}</p>
                            <p className={`text-sm mb-3 ${m.isCompleted ? 'text-ink/40' : 'text-ink'}`}>{m.description}</p>
                            {!m.isCompleted && (
                              <button className="bg-forest hover:bg-forest/90 text-white text-[13px] uppercase tracking-widest py-2 px-4 transition-colors w-full">
                                Mark Document Complete
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      // True Empty State for Production when no data exists
                      <div className="flex flex-col items-center justify-center py-12 px-6 border border-dashed border-ink/20 bg-parchment/50 text-center">
                        <div className="w-12 h-12 bg-forest/10 flex items-center justify-center border border-forest/20 mb-6">
                          <span className="font-serif text-xl font-bold text-forest">0</span>
                        </div>
                        <h3 className="font-serif text-2xl font-bold mb-2">Awaiting Cohort Formation</h3>
                        <p className="text-ink/60 mb-6 max-w-sm">No active sprints are mapped to your team yet as the admissions committee finalizes batch rosters.</p>
                        <button disabled className="bg-ink/10 text-ink/40 text-[13px] uppercase tracking-widest py-3 px-6 cursor-not-allowed">
                          Timeline Locked
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section>
                <div className="bg-ink text-parchment p-8 flex flex-col gap-6">
                  <div>
                    <p className="text-[13px] uppercase tracking-widest text-ink/40 mb-2">Capital Deployed</p>
                    <div className="flex items-end gap-3">
                      <p className="font-serif text-4xl font-bold text-white">$10,000</p>
                      <p className="text-sm text-ink/40 mb-1 pb-1">/ $50,000 Allocated</p>
                    </div>
                  </div>
                  <div className="w-full h-1 bg-ink/30 relative">
                    <div className="absolute top-0 left-0 h-full bg-forest" style={{ width: '20%' }} />
                  </div>
                  <div className="flex justify-between items-center pt-4 border-t border-ink/30">
                    <p className="text-sm text-ink/40">Next tranche: Day 45</p>
                    <a href="#" className="text-[13px] uppercase tracking-widest text-forest hover:text-white transition-colors flex items-center gap-1">
                      View Ledger
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>
      
      {/* Real-time Team Communications */}
      {sprintData?.teamId && (
        <ChatWidget 
          teamId={sprintData.teamId} 
          userId="dummy-user" // In production, this would come from AuthProvider
          userName="Applicant #0842"
        />
      )}
    </div>
  );
}
