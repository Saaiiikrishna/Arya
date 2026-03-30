import { FileText, Users, Share2, LogOut, Check, Plus, ArrowRight } from 'lucide-react';

export default function Hub() {
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
              { label: 'Overview', active: true },
              { label: 'Team Roster', active: false },
              { label: 'The Brief', active: false },
              { label: 'Timeline & Capital', active: false },
            ].map((item) => (
              <a
                key={item.label}
                href="#"
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
                    <div className="flex gap-6 items-start">
                      <div className="w-8 h-8 rounded-full bg-forest flex items-center justify-center flex-shrink-0 mt-1">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <p className="text-[13px] uppercase tracking-widest text-forest font-bold mb-1">Day 1</p>
                        <p className="font-serif text-lg font-bold mb-2">Cohort Formation</p>
                        <p className="text-sm text-ink/40">Initial $10k disbursed. Team introductions complete.</p>
                      </div>
                    </div>
                    <div className="flex gap-6 items-start">
                      <div className="w-8 h-8 rounded-full bg-parchment border-2 border-forest flex items-center justify-center flex-shrink-0 mt-1 relative">
                        <div className="w-3 h-3 bg-forest rounded-full animate-pulse" />
                      </div>
                      <div className="bg-white border border-hairline p-4 shadow-sm w-full border-l-[3px] border-l-forest">
                        <p className="text-[13px] uppercase tracking-widest text-terracotta font-bold mb-1">Day 14 (Current)</p>
                        <p className="font-serif text-lg font-bold mb-2">Architecture Review</p>
                        <p className="text-sm text-ink mb-3">Submit technical architecture document and initial wireframes for approval.</p>
                        <button className="bg-forest hover:bg-forest/90 text-white text-[13px] uppercase tracking-widest py-2 px-4 transition-colors w-full">
                          Submit Documents
                        </button>
                      </div>
                    </div>
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
    </div>
  );
}
