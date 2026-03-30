"use client";

import { ArrowRight, Edit3, Users, Layers, Compass, CheckCircle2, XCircle } from 'lucide-react';

interface ManifestoProps {
  onApply: () => void;
}

export default function Manifesto({ onApply }: ManifestoProps) {
  return (
    <div className="max-w-screen-2xl mx-auto px-8">
      {/* Hero Section */}
      <section className="pt-24 pb-32">
        <div className="grid grid-cols-12 gap-8 lg:gap-16">
          <div className="col-span-12 md:col-span-5 lg:col-span-5 flex flex-col justify-end order-2 md:order-1 pt-8 md:pt-0">
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-terracotta block mb-6">
              Timeline
            </span>
            <h2 className="text-6xl md:text-[5rem] font-serif leading-[0.9] text-forest tracking-tighter mb-6 italic">
              Build a Startup in <span className="text-terracotta not-italic">180 Days.</span>
            </h2>
            <p className="text-lg font-sans leading-relaxed text-ink/80 mb-8">
              We don&rsquo;t invest in you. <span className="font-bold text-forest underline decoration-terracotta/30">We build with you.</span>
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={onApply}
                className="px-8 py-4 bg-forest text-parchment font-sans text-[10px] uppercase tracking-widest hover:bg-forest/90 transition-all shadow-[4px_4px_0px_0px_rgba(91,9,2,0.2)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
              >
                Apply Now
              </button>
              <button
                onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-8 py-4 border border-forest text-forest font-sans text-[10px] uppercase tracking-widest hover:bg-forest/5 transition-all outline-none"
              >
                How It Works
              </button>
            </div>
          </div>

          <div className="col-span-12 md:col-span-7 lg:col-span-7 order-1 md:order-2 flex flex-col justify-center pb-12 md:pb-0 md:pl-12 lg:pl-16">
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-terracotta block mb-8">
              Philosophy
            </span>
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-serif leading-[0.9] text-forest tracking-tighter mb-8 max-w-2xl">
              Passion is the only <span className="italic text-terracotta">prerequisite.</span>
            </h1>
            <p className="text-xl md:text-2xl font-serif italic leading-relaxed text-forest/90 max-w-2xl">
              &quot;We are not looking for polished pitch decks or three-year financial projections. We are looking for the obsessive, the restless, and the relentlessly curious.&quot;
            </p>
          </div>
        </div>
      </section>

      <div className="w-full border-t border-hairline" />

      {/* The Pact Section */}
      <section className="py-24">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
          <div className="md:col-span-3 border-r border-hairline pr-8">
            <h2 className="font-serif text-3xl italic text-forest mb-6">The Pact</h2>
            <p className="font-sans text-[10px] uppercase tracking-widest leading-loose text-ink/60">
              A three-year co-founder commitment that transcends traditional incubation.
            </p>
          </div>
          <div className="md:col-span-9 grid grid-cols-1 md:grid-cols-3 gap-12">
            {[
              {
                title: 'I. Radical Tenure',
                text: 'The startup cycle is broken. We replace the 3-month demo day sprint with a 36-month architectural build. We are your co-founders from day zero to exit.',
              },
              {
                title: 'II. Shared Risk',
                text: "We don&rsquo;t take &quot;advisory shares.&quot; We invest capital, labor, and reputation. When you bleed, we bleed. When you win, we rebuild the world together.",
              },
              {
                title: 'III. Unyielding Focus',
                text: 'We eliminate the noise. No networking mixers. No vanity metrics. Just pure, unadulterated execution within the quiet of the Club.',
              },
            ].map((item) => (
              <div key={item.title} className="space-y-6">
                <h3 className="font-serif text-2xl text-forest">{item.title}</h3>
                <p className="font-sans text-ink/70 leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="w-full border-t border-hairline" />

      {/* Stats Section */}
      <section className="py-32 bg-alabaster -mx-8 px-8">
        <div className="max-w-screen-2xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-16 items-center">
          <div className="lg:col-span-6 space-y-8">
            <blockquote className="border-l-2 border-terracotta pl-8">
              <p className="font-serif text-4xl text-forest italic leading-snug">
                &quot;The most dangerous founders aren&rsquo;t the ones with the best ideas, but the ones with the longest horizons.&quot;
              </p>
            </blockquote>
          </div>
          <div className="lg:col-span-6 flex flex-col items-center lg:items-end">
            <div className="text-center lg:text-right">
              <span className="text-[12rem] font-serif leading-none text-terracotta font-bold tracking-tighter">1000</span>
              <p className="font-sans text-[12px] uppercase tracking-[0.4em] text-forest mt-[-2rem]">
                Visionaries per batch
              </p>
            </div>
          </div>
        </div>
      </section>



      {/* Problem Section */}
      <section className="py-24">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
          <div className="md:col-span-12 mb-12">
            <h2 className="text-4xl md:text-5xl font-serif text-forest leading-tight max-w-3xl">
              Most people fail not because of ideas, but because of <span className="italic text-terracotta">execution.</span>
            </h2>
          </div>
          <div className="md:col-span-12 grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { title: "No Team", text: "Brilliant minds working in isolation eventually burn out.", icon: <Users className="w-6 h-6 text-terracotta mb-4" /> },
              { title: "No Structure", text: "Chaos is the enemy of scale. We provide the architectural blueprint.", icon: <Layers className="w-6 h-6 text-terracotta mb-4" /> },
              { title: "No Guidance", text: "The path is treacherous. We&apos;ve navigated it before.", icon: <Compass className="w-6 h-6 text-terracotta mb-4" /> },
            ].map((item) => (
              <div key={item.title} className="p-8 border border-hairline bg-alabaster/50 hover:bg-alabaster transition-all hover:-translate-y-1">
                {item.icon}
                <h3 className="font-serif text-2xl text-forest mb-4">{item.title}</h3>
                <p className="font-sans text-ink/70 leading-relaxed text-sm italic">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="w-full border-t border-hairline" />

      {/* How It Works (Timeline UI) */}
      <section id="how-it-works" className="py-24 bg-alabaster -mx-8 px-8">
        <div className="max-w-screen-2xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-serif text-forest mb-20 text-center tracking-tighter">The <span className="text-terracotta italic">180-Day</span> Visual</h2>

          {/* Desktop Timeline */}
          <div className="hidden md:block relative pt-12 pb-24">
            <div className="absolute top-[60px] left-0 w-full h-[2px] bg-forest/10" />
            <div className="absolute top-[60px] left-0 h-[2px] bg-terracotta w-full origin-left animate-in fade-in slide-in-from-left duration-1000 shadow-[0_0_10px_rgba(91,9,0,0.3)]" />

            <div className="grid grid-cols-5 gap-4">
              {[
                { step: "01", title: "Apply", desc: "Submit your vision." },
                { step: "02", title: "Team Formation", desc: "Find your co-builders." },
                { step: "03", title: "Idea Validation", desc: "Stress-test the hypothesis." },
                { step: "04", title: "Build (90 Days)", desc: "Hardcore MVP execution." },
                { step: "05", title: "Launch (Next 90)", desc: "Go-to-market scale." },
              ].map((item, i) => (
                <div key={i} className="relative pt-12 text-center group">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-forest border-2 border-parchment z-10 group-hover:scale-150 transition-transform" />
                  <span className="font-serif text-terracotta text-sm italic block mb-2">{item.step}</span>
                  <h4 className="font-serif text-xl text-forest mb-2">{item.title}</h4>
                  <p className="font-sans text-[10px] uppercase tracking-widest text-ink/50 px-4">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile Timeline */}
          <div className="md:hidden space-y-12">
            {[
              { step: "01", title: "Apply", desc: "Submit your vision." },
              { step: "02", title: "Team Formation", desc: "Find your co-builders." },
              { step: "03", title: "Idea Validation", desc: "Stress-test the hypothesis." },
              { step: "04", title: "Build (90 Days)", desc: "Hardcore MVP execution." },
              { step: "05", title: "Launch (Next 90)", desc: "Go-to-market scale." },
            ].map((item, i) => (
              <div key={i} className="flex gap-6">
                <div className="flex flex-col items-center">
                  <div className="w-3 h-3 rounded-full bg-forest shrink-0" />
                  {i !== 4 && <div className="w-px grow bg-hairline my-2" />}
                </div>
                <div>
                  <span className="font-serif text-terracotta text-xs italic block mb-1">{item.step}</span>
                  <h4 className="font-serif text-xl text-forest mb-1">{item.title}</h4>
                  <p className="font-sans text-xs text-ink/60">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 180 Day Visual - Progress */}
      <section className="py-24 border-t border-hairline">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="text-4xl md:text-5xl font-serif text-forest mb-12 tracking-tighter">
              Progress Animation <span className="text-terracotta italic text-3xl block mt-2">(Feels Real)</span>
            </h2>
            <div className="space-y-12">
              <div>
                <div className="flex justify-between mb-2 font-sans text-[10px] uppercase tracking-widest text-ink/60">
                  <span>Phase 1: MVP</span>
                  <span>90 Days</span>
                </div>
                <div className="h-1.5 bg-forest/5 w-full relative overflow-hidden rounded-full">
                  <div className="absolute top-0 left-0 h-full bg-terracotta w-1/2 rounded-full shadow-[0_0_8px_rgba(91,9,0,0.2)]" />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-2 font-sans text-[10px] uppercase tracking-widest text-ink/60">
                  <span>Phase 2: Market Launch</span>
                  <span>180 Days</span>
                </div>
                <div className="h-1.5 bg-forest/5 w-full relative overflow-hidden rounded-full">
                  <div className="absolute top-0 left-0 h-full bg-terracotta w-full rounded-full shadow-[0_0_8px_rgba(91,9,0,0.2)]" />
                </div>
              </div>
            </div>
          </div>
          <div className="p-12 border border-hairline bg-white shadow-[20px_20px_60px_-15px_rgba(0,0,0,0.05)] relative group overflow-hidden">
            <div className="text-[10rem] font-serif text-forest/10 absolute -right-8 -bottom-8 italic font-bold pointer-events-none select-none">180</div>
            <div className="relative z-10 space-y-8">
              <div className="flex gap-6 items-start">
                <div className="w-10 h-10 shrink-0 border border-terracotta flex items-center justify-center font-serif text-terracotta italic">0-90</div>
                <div>
                  <h4 className="font-serif text-2xl text-forest mb-2">MVP Development</h4>
                  <p className="font-sans text-ink/70 leading-relaxed text-sm">Rapid prototyping, user testing, and core feature hardening.</p>
                </div>
              </div>
              <div className="flex gap-6 items-start">
                <div className="w-10 h-10 shrink-0 border border-terracotta flex items-center justify-center font-serif text-terracotta italic">90-180</div>
                <div>
                  <h4 className="font-serif text-2xl text-forest mb-2">Market Launch</h4>
                  <p className="font-sans text-ink/70 leading-relaxed text-sm">Distribution strategy, acquisition, and scaling stability.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="w-full border-t border-hairline" />

      {/* Partnership Model */}
      <section className="py-32 bg-forest -mx-8 px-8 text-parchment">
        <div className="max-w-screen-2xl mx-auto text-center">
          <h2 className="text-5xl md:text-7xl font-serif tracking-tighter mb-16 leading-tight">
            We Build <span className="italic text-alabaster">With You.</span><br /> Not For You.
          </h2>

          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-12 text-left">
            <div className="space-y-6">
              <div className="text-6xl font-serif text-alabaster italic font-bold">51%</div>
              <h3 className="font-sans text-[10px] uppercase tracking-[0.3em] opacity-80">Stakeholding</h3>
              <p className="font-sans text-parchment/60 leading-relaxed text-sm">We take 51% stake for 3 years. We win only if you win.</p>
            </div>
            <div className="space-y-6">
              <div className="h-[2px] bg-alabaster/30 w-12" />
              <h3 className="font-sans text-[10px] uppercase tracking-[0.3em] opacity-80">Execution Control</h3>
              <p className="font-sans text-parchment/60 leading-relaxed text-sm">You retain execution control. We provide the support vector.</p>
            </div>
            <div className="space-y-6">
              <div className="h-[2px] bg-alabaster/30 w-12" />
              <h3 className="font-sans text-[10px] uppercase tracking-[0.3em] opacity-80">Buyback Option</h3>
              <p className="font-sans text-parchment/60 leading-relaxed text-sm">Buyback option available after achieving operational stability.</p>
            </div>
          </div>
          <div className="mt-20">
            <p className="font-serif text-3xl italic text-alabaster/60">&quot;We win only if you win.&quot;</p>
          </div>
        </div>
      </section>

      {/* Who This Is For & Eligibility */}
      <section className="py-24 border-b border-hairline">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
          <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="p-10 border border-hairline bg-alabaster group">
              <h3 className="font-serif text-3xl text-forest mb-8 flex items-center gap-4">
                <CheckCircle2 className="w-6 h-6 text-terracotta" /> For
              </h3>
              <ul className="space-y-6 font-sans text-ink/80 text-sm">
                <li className="flex items-center gap-3"><span className="w-1 h-1 bg-terracotta rounded-full" /> Builders</li>
                <li className="flex items-center gap-3"><span className="w-1 h-1 bg-terracotta rounded-full" /> Committed individuals</li>
                <li className="flex items-center gap-3"><span className="w-1 h-1 bg-terracotta rounded-full" /> Long-term thinkers</li>
              </ul>
            </div>
            <div className="p-10 border border-hairline bg-alabaster/40 opacity-70">
              <h3 className="font-serif text-3xl text-ink/40 mb-8 flex items-center gap-4">
                <XCircle className="w-6 h-6 text-ink/20" /> Not For
              </h3>
              <ul className="space-y-6 font-sans text-ink/40 text-sm">
                <li className="flex items-center gap-3"><span className="w-1 h-1 bg-ink/20 rounded-full" /> Casual explorers</li>
                <li className="flex items-center gap-3"><span className="w-1 h-1 bg-ink/20 rounded-full" /> Side hustlers</li>
                <li className="flex items-center gap-3"><span className="w-1 h-1 bg-ink/20 rounded-full" /> Idea collectors</li>
              </ul>
            </div>
          </div>
          <div className="lg:col-span-4 border-l border-hairline pl-8">
            <h3 className="font-serif text-3xl text-forest mb-8 italic">Eligibility</h3>
            <ul className="space-y-6 font-sans text-ink/70 text-sm uppercase tracking-widest">
              <li className="flex items-baseline gap-4"><span className="text-terracotta font-serif italic text-lg opacity-40">01</span> No degree required</li>
              <li className="flex items-baseline gap-4"><span className="text-terracotta font-serif italic text-lg opacity-40">02</span> No age limit</li>
              <li className="flex items-baseline gap-4"><span className="text-terracotta font-serif italic text-lg opacity-40">03</span> Must be Indian</li>
              <li className="flex items-baseline gap-4"><span className="text-terracotta font-serif italic text-lg opacity-40">04</span> Must commit full-time</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Philosophy Section */}
      <section className="py-40 text-center">
        <div className="max-w-3xl mx-auto px-6">
          <h3 className="text-4xl md:text-5xl font-serif italic mb-12 text-forest tracking-tighter">
            &quot;Yatra Naryasthu Pujyanthe,<br />Ramante Tatra Devatha&quot;
          </h3>
          <div className="w-32 h-[2px] bg-terracotta mx-auto mb-12 opacity-30" />
          <p className="text-2xl md:text-3xl font-sans text-ink/80 leading-relaxed mb-6">
            We believe in empowering <span className="editorial-underline italic text-forest">women leaders.</span>
          </p>
          <p className="font-serif text-xl italic text-ink/60">
            We build with respect, equality, and strength.
          </p>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="border-t border-hairline relative overflow-hidden bg-forest -mx-8 px-8">
        <div className="py-40 flex flex-col items-center text-center">
          <h2 className="font-serif text-6xl md:text-8xl text-parchment mb-16 max-w-5xl tracking-tighter leading-[0.9]">
            Ready to Build Your <span className="text-alabaster italic underline decoration-parchment/20">Startup?</span>
          </h2>
          <button
            onClick={onApply}
            className="group relative inline-flex items-center justify-center px-16 py-8 bg-parchment text-forest font-sans text-sm uppercase tracking-[0.2em] font-bold hover:bg-parchment/90 transition-all duration-300 shadow-[8px_8px_0px_0px_rgba(91,9,2,0.3)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
          >
            Apply Now
            <ArrowRight className="ml-6 w-5 h-5 group-hover:translate-x-2 transition-transform" />
          </button>
        </div>
      </section>

      {/* Sticky Apply Button (Mobile) */}
      <div className="fixed bottom-8 right-8 z-40 md:hidden">
        <button
          onClick={onApply}
          className="bg-forest text-parchment w-16 h-16 flex items-center justify-center shadow-2xl"
        >
          <Edit3 className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}
