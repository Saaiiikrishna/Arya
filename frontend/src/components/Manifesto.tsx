"use client";

import { useState } from 'react';
import { ArrowRight, Edit3, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ManifestoProps {
  onApply: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  batchInfo?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings?: any;
}

export default function Manifesto({ onApply, batchInfo }: ManifestoProps) {
  const STAGES = [
    { step: "01", title: "Apply", desc: "Submit your vision.", longDesc: "Present your raw, unfiltered idea. We're looking for obsession, profound insight, and the relentless drive to solve a hard problem. We evaluate your potential to execute." },
    { step: "02", title: "Team Formation", desc: "Find your co-builders.", longDesc: "Connect with complimentary minds. A startup is a team sport; we help you find the technical or operational co-founder who matches your intensity. We facilitate these critical connections." },
    { step: "03", title: "Idea Validation", desc: "Stress-test the hypothesis.", longDesc: "Go beyond theory. We relentlessly test assumptions, speak with real prospective users, and validate if there is true market pull before writing a single line of code." },
    { step: "04", title: "Build (90 Days)", desc: "Hardcore MVP execution.", longDesc: "Immerse yourself into a 90-day pure build phase. No distractions, no networking. Just you and your co-founders writing code and building the core product architecture." },
    { step: "05", title: "Launch (Next 90)", desc: "Go-to-market scale.", longDesc: "Bring it to the world. A focused go-to-market strategy aiming for early traction and operational stability. This is where execution meets reality." },
  ];

  const [activeStep, setActiveStep] = useState(0);

  const STAGE_SWIPE_CONFIDENCE_THRESHOLD = 8000;
  const swipePower = (offset: number, velocity: number) => {
    return Math.abs(offset) * velocity;
  };

  const swipeHandlers = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onDragEnd: (e: any, { offset, velocity }: any) => {
      const swipe = swipePower(offset.x, velocity.x);
      if (swipe < -STAGE_SWIPE_CONFIDENCE_THRESHOLD && activeStep < STAGES.length - 1) {
        setActiveStep(activeStep + 1);
      } else if (swipe > STAGE_SWIPE_CONFIDENCE_THRESHOLD && activeStep > 0) {
        setActiveStep(activeStep - 1);
      }
    }
  };

  const filled = batchInfo?.currentCount || 0;
  const total = batchInfo?.capacity || 1;
  const fillPercent = Math.round((filled / total) * 100);
  const batchNum = batchInfo?.batchNumber || 1;

  // Healthy "open" state pops in saffron; urgency states keep their semantic
  // amber/red warnings; closed states fall back to muted ink.
  let bannerText = `Application Open for Batch #${batchNum}`;
  let badgeBorder = 'border-saffron/30';
  let dotColor = 'bg-saffron';
  let glowColor = 'rgba(232,93,4,0.55)';  // Saffron pop
  let bgClass = 'bg-white/90 backdrop-blur-xl';
  let textColor = 'text-saffron-deep';
  let isClosed = false;

  if (batchInfo === null) {
    bannerText = 'Registrations Currently Closed';
    badgeBorder = 'border-ink/10';
    dotColor = 'bg-ink/30';
    bgClass = 'bg-alabaster/90 backdrop-blur-xl';
    textColor = 'text-ink/60';
    glowColor = 'transparent';
    isClosed = true;
  } else if (fillPercent >= 100) {
    bannerText = `Batch #${batchNum} Registrations Closed`;
    badgeBorder = 'border-ink/10';
    dotColor = 'bg-ink/30';
    bgClass = 'bg-alabaster/90 backdrop-blur-xl';
    textColor = 'text-ink/60';
    glowColor = 'transparent';
    isClosed = true;
  } else if (fillPercent >= 90) {
    bannerText = `Almost Full — Batch #${batchNum}`;
    badgeBorder = 'border-terracotta-warm/40';
    dotColor = 'bg-terracotta-warm';
    bgClass = 'bg-white/90 backdrop-blur-xl';
    textColor = 'text-terracotta';
    glowColor = 'rgba(201,74,56,0.6)';
  } else if (fillPercent >= 75) {
    bannerText = `Filling Fast — Batch #${batchNum}`;
    badgeBorder = 'border-marigold/50';
    dotColor = 'bg-marigold';
    bgClass = 'bg-white/90 backdrop-blur-xl';
    textColor = 'text-warning';
    glowColor = 'rgba(244,163,0,0.6)';
  } else if (fillPercent >= 50) {
    bannerText = `Applications Open for Batch #${batchNum}`;
    badgeBorder = 'border-saffron/30';
    dotColor = 'bg-saffron';
    bgClass = 'bg-white/90 backdrop-blur-xl';
    textColor = 'text-saffron-deep';
    glowColor = 'rgba(232,93,4,0.55)';
  }

  return (
    <div className="max-w-screen-2xl mx-auto px-8 relative">

      {/* Hero Section */}
      <motion.section
        className="relative min-h-[calc(100vh-80px)] flex flex-col justify-center pt-24 pb-16"
        initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.8 }}
      >

        {/* Batch Status Badge - Floating Centered at Top of Hero */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-30 flex justify-center mt-4 w-full px-4">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className={`relative group p-[1px] flex items-center justify-center rounded-full ${isClosed ? '' : 'overflow-hidden'}`}
          >
            {/* Animated rotating gradient border */}
            {!isClosed && (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] z-0"
                style={{ background: `conic-gradient(from 0deg, transparent 0 270deg, ${glowColor} 360deg)` }}
              />
            )}
            {/* Inner Container */}
            <div className={`relative z-10 w-full inline-flex justify-center items-center px-4 md:px-5 py-2 border rounded-full ${badgeBorder} ${bgClass} cursor-default transition-colors duration-500`}>
              <span className="relative flex items-center justify-center h-2 w-2 mr-3 shrink-0">
                {!isClosed && <span className={`animate-ping absolute inline-flex h-3 w-3 rounded-full opacity-60 ${dotColor}`}></span>}
                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${dotColor}`}></span>
              </span>
              <motion.span
                className={`font-sans text-[10px] md:text-[11px] uppercase tracking-[0.2em] font-bold whitespace-nowrap ${textColor}`}
                animate={!isClosed ? { opacity: [0.8, 1, 0.8] } : { opacity: 1 }}
                transition={!isClosed ? { duration: 2.5, repeat: Infinity, ease: "easeInOut" } : {}}
              >
                {bannerText}
              </motion.span>
            </div>
          </motion.div>
        </div>

        <div className="flex flex-col items-center text-center max-w-4xl mx-auto mt-20 md:mt-12 px-4 relative z-10">
          <span className="font-sans text-[10px] sm:text-xs uppercase tracking-[0.2em] text-terracotta-warm block mb-6 md:mb-8 font-bold">
            Timeline & Philosophy
          </span>
          <h1 className="text-6xl md:text-7xl lg:text-[7rem] font-serif-display font-bold leading-[0.9] text-forest tracking-[-0.025em] mb-4 md:mb-6">
            Build a Startup in <span className="text-saffron italic">180 Days.</span>
          </h1>
          <h2 className="text-2xl md:text-4xl font-serif italic leading-tight text-forest/80 mb-8 max-w-3xl mx-auto">
            Passion is the only prerequisite.
          </h2>
          <p className="text-base md:text-lg lg:text-xl font-sans leading-relaxed text-ink/80 mb-10 max-w-3xl mx-auto">
            We don&rsquo;t invest in you. <span className="font-bold text-forest underline decoration-saffron/40">We build with you.</span> &quot;We are not looking for polished pitch decks or three-year financial projections. We are looking for the obsessive, the restless, and the relentlessly curious.&quot;
          </p>
          <div className="flex flex-col sm:flex-row gap-4 mb-4 justify-center w-full sm:w-auto">
            <button
              onClick={onApply}
              className="px-8 py-4 md:px-10 md:py-5 bg-saffron text-parchment font-sans text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep transition-all active:translate-x-[2px] active:translate-y-[2px] w-full sm:w-auto"
            >
              Apply Now
            </button>
            <button
              onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
              className="px-8 py-4 md:px-10 md:py-5 border border-forest text-forest font-sans text-[10px] uppercase tracking-widest font-bold hover:bg-forest/5 transition-all outline-none w-full sm:w-auto"
            >
              How It Works
            </button>
          </div>
        </div>

      </motion.section>

      {/* How This Works (Timeline UI) - Moved up */}
      <motion.section
        id="how-it-works" className="py-24 -mx-8 px-8 border-b border-hairline overflow-hidden relative"
        initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.8 }}
      >
        <div className="max-w-screen-2xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-serif text-forest mb-20 text-center tracking-tighter">How This <span className="text-terracotta-warm italic">Works</span></h2>

          {/* Desktop Timeline */}
          <div className="hidden md:block relative pt-12 pb-16">
            <div className="absolute top-[60px] left-0 w-full h-[2px] bg-forest/10" />
            <motion.div
              className="absolute top-[59px] left-0 h-[4px] bg-gradient-to-r from-saffron/70 to-saffron origin-left"
              initial={{ width: "10%" }}
              animate={{ width: `${(activeStep * 20) + 10}%` }}
              transition={{ duration: 0.6, type: "spring", bounce: 0.2 }}
            />

            <div className="grid grid-cols-5 gap-4 relative z-10">
              {STAGES.map((item, i) => {
                const isActive = activeStep === i;
                const isPassed = i <= activeStep;
                return (
                  <div key={i} className="relative pt-12 text-center group cursor-pointer select-none" onClick={() => setActiveStep(i)}>
                    <div className="absolute top-[-6px] left-1/2 -translate-x-1/2 z-10 flex flex-col items-center justify-center">
                      <motion.div
                        className={`rounded-full flex items-center justify-center transition-colors duration-300 ${isActive ? 'w-8 h-8 bg-saffron border-4 border-white' : (isPassed ? 'w-5 h-5 bg-saffron border-2 border-white mt-1.5' : 'w-4 h-4 bg-forest/20 mt-2 border-2 border-white')}`}
                        whileHover={{ scale: 1.15 }}
                      >
                        {isActive && <div className="w-2 h-2 bg-white rounded-full" />}
                        {(isPassed && !isActive) && <CheckCircle2 className="w-3 h-3 text-white" strokeWidth={3} />}
                      </motion.div>
                    </div>
                    <motion.span
                      className="font-serif text-sm italic block mb-2 transition-colors duration-300"
                      animate={{ color: isActive ? '#E85D04' : '#8B8B8B' }}
                    >{item.step}</motion.span>
                    <motion.h4
                      className="font-serif text-xl mb-2 transition-colors duration-300 truncate px-2"
                      animate={{ color: isActive ? '#1F3C2C' : '#8B8B8B' }}
                    >{item.title}</motion.h4>
                    <p className="font-sans text-[10px] uppercase tracking-widest text-ink/50 px-4 line-clamp-2 md:line-clamp-none">{item.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mobile Timeline */}
          <div className="md:hidden space-y-8 mb-16 relative">
            <div className="absolute left-[5.5px] top-[10px] bottom-[10px] w-[2px] bg-forest/10" />
            {STAGES.map((item, i) => {
              const isActive = activeStep === i;
              const isPassed = i <= activeStep;
              return (
                <div key={i} className="flex gap-6 relative z-10 cursor-pointer" onClick={() => setActiveStep(i)}>
                  <div className="flex flex-col items-center mt-1">
                    <motion.div
                      className={`rounded-full border-2 border-white flex items-center justify-center transition-colors duration-300 ${isActive ? 'w-6 h-6 bg-saffron' : (isPassed ? 'w-5 h-5 bg-saffron' : 'w-4 h-4 bg-forest/20')} shrink-0`}
                    >
                      {isActive && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                      {(isPassed && !isActive) && <CheckCircle2 className="w-3 h-3 text-white" strokeWidth={3} />}
                    </motion.div>
                  </div>
                  <div>
                    <span className={`font-serif text-xs italic block mb-1 transition-colors duration-300 ${isActive ? 'text-saffron' : 'text-ink/40'}`}>{item.step}</span>
                    <h4 className={`font-serif text-xl mb-1 transition-colors duration-300 ${isActive ? 'text-forest' : 'text-ink/60'}`}>{item.title}</h4>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Swipable Stack Cards */}
          <div className="relative w-full h-[550px] flex items-center justify-center overflow-hidden">
            <AnimatePresence initial={false}>
              {STAGES.map((stage, i) => {
                const offset = i - activeStep;
                // Render only nearby cards
                if (Math.abs(offset) > 2) return null;

                // Active Card styling
                const isCenter = offset === 0;

                return (
                  <motion.div
                    key={i}
                    drag={isCenter ? "x" : false}
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={1}
                    onDragEnd={isCenter ? swipeHandlers.onDragEnd : undefined}
                    className="absolute w-full max-w-lg lg:max-w-2xl bg-white border border-hairline/40 overflow-hidden flex flex-col cursor-grab active:cursor-grabbing will-change-[transform,opacity,filter]"
                    animate={{
                      x: `${offset * 70}%`,
                      y: `${Math.abs(offset) * 4}%`,
                      scale: 1 - Math.abs(offset) * 0.15,
                      zIndex: STAGES.length - Math.abs(offset),
                      opacity: 1 - Math.abs(offset) * 0.3,
                      filter: `blur(${Math.abs(offset) * 3}px)`,
                    }}
                    transition={{
                      type: "spring",
                      stiffness: 300,
                      damping: 30,
                    }}
                    onClick={() => setActiveStep(i)}
                  >
                    {/* Media Placeholder section (Admin controllable later) */}
                    <div className="w-full h-[240px] bg-forest/5 border-b border-hairline/20 relative flex items-center justify-center overflow-hidden">
                      {/* Abstract placeholder visual */}
                      <div className="absolute inset-0 bg-gradient-to-tr from-forest/10 to-transparent mix-blend-multiply opacity-50" />
                      <div className="w-24 h-24 rounded-full border border-saffron/30 flex items-center justify-center opacity-70">
                        <span className="font-serif text-saffron italic text-3xl">{stage.step}</span>
                      </div>
                    </div>
                    {/* Card Content */}
                    <div className="p-8 md:p-10 flex flex-col flex-1 bg-white">
                      <div className="flex items-center justify-between mb-4">
                        <span className="font-sans text-[10px] uppercase tracking-widest text-ink/40">Phase {stage.step}</span>
                        <span className="w-8 h-px bg-saffron/30" />
                      </div>
                      <h3 className="font-serif text-3xl md:text-4xl text-forest mb-4 leading-tight">{stage.title}</h3>
                      <p className="font-sans text-ink/70 leading-relaxed text-sm md:text-base">
                        {stage.longDesc}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

          </div>
        </div>
      </motion.section>

      {/* Promise Section */}
      <motion.section
        className="py-24"
        initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.8 }}
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
          <div className="md:col-span-3 border-r border-hairline pr-8">
            <h2 className="font-serif text-3xl italic text-forest mb-6">We Promise</h2>
            <p className="font-sans text-[10px] uppercase tracking-widest leading-loose text-ink/60">
              A three-year co-founder commitment that transcends traditional incubation.
            </p>
          </div>
          <div className="md:col-span-9 grid grid-cols-1 md:grid-cols-3 gap-12">
            {[
              {
                title: 'I. Breaking Imported Hipocrisy',
                text: 'We go back to our roots. Indian entrepreneurs ruled the world for centuries. They built empires and trade routes that connected the world. We replace the so called "Modern Business System" with actual Indian way of building businesses.',
              },
              {
                title: 'II. Shared Risk & Commitment',
                text: "We are not capatalists without morals. We are community builders with shared interests. We belive in Live & Let-Live. We invest capital, labor, and reputation. When you bleed, we bleed. When you win, we rebuild the world together.",
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
      </motion.section>

      <div className="w-full border-t border-hairline" />

      {/* Stats Section */}
      <motion.section
        className="py-32"
        initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.8 }}
      >
        <div className="max-w-5xl mx-auto items-center">
          <div className="space-y-8">
            <blockquote className="border-l-2 border-terracotta-warm pl-8">
              <p className="font-serif text-4xl text-forest italic leading-snug">
                &quot;The most dangerous founders aren&apos;t the ones with the best ideas, but the ones with the mindset and execution.&quot;
              </p>
            </blockquote>
          </div>
        </div>
      </motion.section>



      {/* Builder Model */}
      <motion.section
        className="py-32 bg-forest -mx-8 px-8 text-parchment"
        initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.8 }}
      >
        <div className="max-w-screen-2xl mx-auto text-center">
          <h2 className="text-5xl md:text-7xl font-serif tracking-tighter mb-16 leading-tight">
            We Build <span className="italic text-alabaster">With You.</span><br /> Not For You.
          </h2>

          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-12 text-left">
            <div className="space-y-6">
              <div className="text-6xl font-serif text-alabaster italic font-bold">180</div>
              <h3 className="font-sans text-[10px] uppercase tracking-[0.3em] opacity-80">Day Sprint</h3>
              <p className="font-sans text-parchment/60 leading-relaxed text-sm">An immersive six-month timeline to validate, build, and launch.</p>
            </div>
            <div className="space-y-6">
              <div className="h-[2px] bg-saffron w-12" />
              <h3 className="font-sans text-[10px] uppercase tracking-[0.3em] opacity-80">Co-Building</h3>
              <p className="font-sans text-parchment/60 leading-relaxed text-sm">We provide the technical and operational muscle to turn hypotheses into reality.</p>
            </div>
            <div className="space-y-6">
              <div className="h-[2px] bg-saffron w-12" />
              <h3 className="font-sans text-[10px] uppercase tracking-[0.3em] opacity-80">Zero Fluff</h3>
              <p className="font-sans text-parchment/60 leading-relaxed text-sm">No vanity metrics or networking mixers. Pure, unadulterated execution.</p>
            </div>
          </div>
          <div className="mt-20">
            <p className="font-serif text-3xl italic text-alabaster/60">&quot;Great companies are built in the trenches.&quot;</p>
          </div>
        </div>
      </motion.section>



      {/* Philosophy Section */}
      <motion.section
        className="py-40 text-center relative"
        initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.8 }}
      >
        <div className="max-w-3xl mx-auto px-6">
          <div className="w-32 h-[2px] bg-terracotta-warm mx-auto mb-12 opacity-30" />
          <p className="text-2xl md:text-3xl font-sans text-ink/80 leading-relaxed mb-6">
            We believe in empowering <span className="editorial-underline italic text-forest">women leaders.</span>
          </p>
          <p className="font-serif text-xl italic text-ink/60">
            We build with respect, equality, and strength.
          </p>
        </div>
      </motion.section>

      {/* Final CTA Section */}
      <motion.section
        className="border-t border-hairline relative overflow-hidden bg-forest -mx-8 px-8"
        initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.8 }}
      >
        <div className="py-40 flex flex-col items-center text-center">
          <h2 className="font-serif-display font-bold text-6xl md:text-8xl text-parchment mb-16 max-w-5xl tracking-[-0.025em] leading-[0.9]">
            Ready to Build Your <span className="text-alabaster italic underline decoration-parchment/20">Startup?</span>
          </h2>
          <button
            onClick={onApply}
            className="group relative inline-flex items-center justify-center px-16 py-8 bg-parchment text-forest font-sans text-sm uppercase tracking-[0.2em] font-bold hover:bg-parchment/90 transition-all duration-300 active:translate-x-[2px] active:translate-y-[2px]"
          >
            Apply Now
            <ArrowRight className="ml-6 w-5 h-5 group-hover:translate-x-2 transition-transform" />
          </button>
        </div>
      </motion.section>

      {/* Sticky Apply Button (Mobile) */}
      <div className="fixed bottom-8 right-8 z-40 md:hidden">
        <button
          onClick={onApply}
          className="bg-saffron text-parchment w-16 h-16 flex items-center justify-center border border-saffron-deep"
        >
          <Edit3 className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}
