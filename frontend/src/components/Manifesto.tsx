"use client";

import { useState, useMemo } from 'react';
import { ArrowRight, Edit3, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DEFAULT_SECTIONS, type Section } from '@/lib/homepage-sections';

interface ManifestoProps {
  onApply: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  batchInfo?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings?: any;
}

// ─── Batch status badge logic (dynamic, not CMS) ─────────────────────────────
// Matte eyebrow pill (.mkt-pill): solid alabaster surface + 1px hairline, NO
// backdrop-blur, NO glow (DESIGN.md §1/§7 — blur/glow are NOT part of this
// design). Healthy "open" state pops in saffron; the urgency ramp climbs
// marigold → terracotta-warm; closed states fall back to muted ink. Only the
// dot colour, label colour, and the semantic border tint vary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getBatchBadge(batchInfo: any) {
  const filled = batchInfo?.currentCount || 0;
  const total = batchInfo?.capacity || 1;
  const fillPercent = Math.round((filled / total) * 100);
  const batchNum = batchInfo?.batchNumber || 1;

  if (batchInfo === null) {
    return {
      bannerText: 'Registrations Currently Closed',
      badgeBorder: 'border-ink/10',
      dotColor: 'bg-ink/30',
      textColor: 'text-ink/60',
      isClosed: true,
    };
  }
  if (fillPercent >= 100) {
    return {
      bannerText: `Batch #${batchNum} Registrations Closed`,
      badgeBorder: 'border-ink/10',
      dotColor: 'bg-ink/30',
      textColor: 'text-ink/60',
      isClosed: true,
    };
  }
  if (fillPercent >= 90) {
    return {
      bannerText: `Almost Full — Batch #${batchNum}`,
      badgeBorder: 'border-terracotta-warm/40',
      dotColor: 'bg-terracotta-warm',
      textColor: 'text-terracotta',
      isClosed: false,
    };
  }
  if (fillPercent >= 75) {
    return {
      bannerText: `Filling Fast — Batch #${batchNum}`,
      badgeBorder: 'border-marigold/50',
      dotColor: 'bg-marigold',
      textColor: 'text-warning',
      isClosed: false,
    };
  }
  if (fillPercent >= 50) {
    return {
      bannerText: `Applications Open for Batch #${batchNum}`,
      badgeBorder: 'border-saffron/30',
      dotColor: 'bg-saffron',
      textColor: 'text-saffron-deep',
      isClosed: false,
    };
  }
  return {
    bannerText: `Application Open for Batch #${batchNum}`,
    badgeBorder: 'border-saffron/30',
    dotColor: 'bg-saffron',
    textColor: 'text-saffron-deep',
    isClosed: false,
  };
}

// ─── Section Renderers ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function HeroSection({ data, onApply, batchInfo }: { data: any; onApply: () => void; batchInfo: any }) {
  const badge = getBatchBadge(batchInfo);

  // Support explicit prefix/accent fields; fall back to splitting the legacy headline string
  const headlinePrefix = data.headline_prefix ?? (data.headline?.split('180 Days')?.[0]?.trimEnd() ?? 'Build a Startup in');
  const headlineAccent = data.headline_accent ?? '180 Days.';

  return (
    <motion.section
      className="relative min-h-[calc(100dvh-80px)] flex flex-col justify-center pt-32 pb-20"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
    >
      {/* Batch status badge — matte .mkt-pill (alabaster surface + 1px hairline,
          0 blur, 0 glow); the semantic state only re-tints the border + dot + label. */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 z-30 flex justify-center mt-4 w-full px-4">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className={`mkt-pill cursor-default transition-colors duration-500 ${badge.badgeBorder}`}
        >
          <span className="relative flex items-center justify-center h-2 w-2 shrink-0">
            {!badge.isClosed && <span className={`animate-ping absolute inline-flex h-3 w-3 rounded-full opacity-60 ${badge.dotColor}`} />}
            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${badge.dotColor}`} />
          </span>
          <motion.span
            className={`font-sans text-[10px] md:text-[11px] uppercase tracking-[0.2em] font-bold whitespace-nowrap ${badge.textColor}`}
            animate={!badge.isClosed ? { opacity: [0.8, 1, 0.8] } : { opacity: 1 }}
            transition={!badge.isClosed ? { duration: 2.5, repeat: Infinity, ease: 'easeInOut' } : {}}
          >
            {badge.bannerText}
          </motion.span>
        </motion.div>
      </div>

      <div className="flex flex-col items-center text-center max-w-4xl 3xl:max-w-5xl mx-auto mt-16 md:mt-8 px-0 sm:px-4 relative z-10">
        {/* Eyebrow */}
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="font-sans text-[10px] sm:text-[11px] uppercase tracking-[0.3em] text-terracotta-warm block mb-8 font-bold"
        >
          The Founder&apos;s Club
        </motion.span>

        {/* Headline — display serif, saffron accent */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.55 }}
          className="text-[3rem] sm:text-6xl md:text-7xl lg:text-[7.5rem] 3xl:text-[8rem] font-serif font-bold leading-[0.9] text-forest tracking-[-0.025em] mb-8 md:mb-10"
        >
          {headlinePrefix}
          <br className="hidden sm:block" />
          {' '}<span className="text-saffron italic">{headlineAccent}</span>
        </motion.h1>

        {/* Hairline divider */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.5, delay: 1.0 }}
          className="w-12 h-px bg-forest/20 mb-8 origin-center"
        />

        {/* Tagline — italic serif, platform's core filter */}
        {data.tagline && (
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1.1 }}
            className="font-serif italic text-lg md:text-xl text-forest/65 mb-6 max-w-2xl mx-auto leading-snug"
          >
            {data.tagline}
          </motion.p>
        )}

        {/* Body */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: data.tagline ? 1.2 : 1.1 }}
          className="text-base md:text-lg font-sans leading-relaxed text-ink/70 mb-10 max-w-2xl mx-auto"
        >
          {data.body}
        </motion.p>

        {/* CTAs — matte mkt buttons (saffron primary, ghost secondary) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: data.tagline ? 1.3 : 1.2 }}
          className="flex flex-col sm:flex-row gap-4 justify-center w-full sm:w-auto"
        >
          <button
            type="button"
            onClick={onApply}
            className="mkt-btn w-full sm:w-auto"
          >
            {data.cta_primary_label || 'Apply Now'}
          </button>
          <button
            type="button"
            onClick={() =>
              document.getElementById(data.cta_secondary_anchor || 'how-it-works')?.scrollIntoView({ behavior: 'smooth' })
            }
            className="mkt-btn-ghost w-full sm:w-auto"
          >
            {data.cta_secondary_label || 'How It Works'}
          </button>
        </motion.div>
      </div>
    </motion.section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function HowItWorksSection({ data }: { data: any }) {
  const STAGES = data.steps || [];
  const [activeStep, setActiveStep] = useState(0);

  const STAGE_SWIPE_CONFIDENCE_THRESHOLD = 8000;
  const swipePower = (offset: number, velocity: number) => Math.abs(offset) * velocity;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDragEnd = (e: any, { offset, velocity }: any) => {
    const swipe = swipePower(offset.x, velocity.x);
    if (swipe < -STAGE_SWIPE_CONFIDENCE_THRESHOLD && activeStep < STAGES.length - 1) setActiveStep(activeStep + 1);
    else if (swipe > STAGE_SWIPE_CONFIDENCE_THRESHOLD && activeStep > 0) setActiveStep(activeStep - 1);
  };

  return (
    <motion.section
      id="how-it-works"
      className="py-24 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 border-b border-hairline overflow-hidden relative"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.8 }}
    >
      <div className="max-w-[1600px] mx-auto">
        <h2 className="text-4xl md:text-5xl font-serif text-forest mb-20 text-center tracking-tighter">
          {data.title?.split(' ').slice(0, -1).join(' ')}{' '}
          <span className="text-terracotta-warm italic">{data.title?.split(' ').slice(-1)}</span>
        </h2>

        {/* Desktop Timeline */}
        <div className="hidden md:block relative pt-12 pb-16">
          <div className="absolute top-[60px] left-0 w-full h-[2px] bg-forest/10" />
          <motion.div
            className="absolute top-[59px] left-0 h-[4px] bg-saffron origin-left"
            initial={{ width: '10%' }}
            animate={{ width: `${(activeStep * (100 / Math.max(STAGES.length, 1))) + (100 / Math.max(STAGES.length * 2, 1))}%` }}
            transition={{ duration: 0.6, type: 'spring', bounce: 0.2 }}
          />
          <div className="grid gap-4 relative z-10" style={{ gridTemplateColumns: `repeat(${Math.max(1, STAGES.length)}, 1fr)` }}>
            {STAGES.map((item: any, i: number) => {
              const isActive = activeStep === i;
              const isPassed = i <= activeStep;
              return (
                <div key={item.id || i} className="relative pt-12 text-center group cursor-pointer select-none" onClick={() => setActiveStep(i)}>
                  <div className="absolute top-[-6px] left-1/2 -translate-x-1/2 z-10 flex flex-col items-center justify-center">
                    <motion.div
                      className={`rounded-full flex items-center justify-center transition-colors duration-300 ${isActive ? 'w-8 h-8 bg-saffron border-4 border-alabaster' : isPassed ? 'w-5 h-5 bg-saffron border-2 border-alabaster mt-1.5' : 'w-4 h-4 bg-forest/20 mt-2 border-2 border-alabaster'}`}
                      whileHover={{ scale: 1.15 }}
                    >
                      {isActive && <div className="w-2 h-2 bg-alabaster rounded-full" />}
                      {isPassed && !isActive && <CheckCircle2 className="w-3 h-3 text-alabaster" strokeWidth={3} />}
                    </motion.div>
                  </div>
                  <motion.span className="font-serif text-sm italic block mb-2 transition-colors duration-300" animate={{ color: isActive ? '#E85D04' : '#8B8B8B' }}>
                    {item.step}
                  </motion.span>
                  <motion.h4 className="font-serif text-xl mb-2 transition-colors duration-300 truncate px-2" animate={{ color: isActive ? '#1F3C2C' : '#8B8B8B' }}>
                    {item.title}
                  </motion.h4>
                  <p className="font-sans text-[10px] uppercase tracking-widest text-ink/50 px-4 line-clamp-2 md:line-clamp-none">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Mobile Timeline */}
        <div className="md:hidden space-y-8 mb-16 relative">
          <div className="absolute left-[5.5px] top-[10px] bottom-[10px] w-[2px] bg-forest/10" />
          {STAGES.map((item: any, i: number) => {
            const isActive = activeStep === i;
            const isPassed = i <= activeStep;
            return (
              <div key={item.id || i} className="flex gap-6 relative z-10 cursor-pointer" onClick={() => setActiveStep(i)}>
                <div className="flex flex-col items-center mt-1">
                  <motion.div
                    className={`rounded-full border-2 border-alabaster flex items-center justify-center transition-colors duration-300 ${isActive ? 'w-6 h-6 bg-saffron' : isPassed ? 'w-5 h-5 bg-saffron' : 'w-4 h-4 bg-forest/20'} shrink-0`}
                  >
                    {isActive && <div className="w-1.5 h-1.5 bg-alabaster rounded-full" />}
                    {isPassed && !isActive && <CheckCircle2 className="w-3 h-3 text-alabaster" strokeWidth={3} />}
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

        {/* Swipable Stack Cards — matte alabaster frames, 1px hairline, NO shadow */}
        <div className="relative w-full h-[550px] flex items-center justify-center overflow-hidden">
          <AnimatePresence initial={false}>
            {STAGES.map((stage: any, i: number) => {
              const offset = i - activeStep;
              if (Math.abs(offset) > 2) return null;
              const isCenter = offset === 0;
              return (
                <motion.div
                  key={stage.id || i}
                  drag={isCenter ? 'x' : false}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={1}
                  onDragEnd={isCenter ? handleDragEnd : undefined}
                  className="absolute w-full max-w-lg lg:max-w-2xl bg-alabaster border border-hairline/40 overflow-hidden flex flex-col cursor-grab active:cursor-grabbing will-change-[transform,opacity,filter]"
                  animate={{
                    x: `${offset * 70}%`,
                    y: `${Math.abs(offset) * 4}%`,
                    scale: 1 - Math.abs(offset) * 0.15,
                    zIndex: STAGES.length - Math.abs(offset),
                    opacity: 1 - Math.abs(offset) * 0.3,
                    filter: `blur(${Math.abs(offset) * 3}px)`,
                  }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  onClick={() => setActiveStep(i)}
                >
                  {/* Card media */}
                  <div className="w-full h-[240px] bg-forest/5 border-b border-hairline/20 relative flex items-center justify-center overflow-hidden">
                    {stage.mediaUrl ? (
                      stage.mediaType === 'video' ? (
                        <video src={stage.mediaUrl} className="w-full h-full object-cover" muted loop autoPlay playsInline />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={stage.mediaUrl} alt={stage.title} className="w-full h-full object-cover" />
                      )
                    ) : (
                      <>
                        {/* Abstract placeholder visual — flat forest tint (no gradient) */}
                        <div className="absolute inset-0 bg-forest/[0.06]" />
                        <div className="relative w-24 h-24 rounded-full border border-saffron/30 flex items-center justify-center opacity-70">
                          <span className="font-serif text-saffron italic text-3xl">{stage.step}</span>
                        </div>
                      </>
                    )}
                  </div>
                  {/* Card content */}
                  <div className="p-8 md:p-10 flex flex-col flex-1 bg-alabaster">
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-sans text-[10px] uppercase tracking-widest text-ink/40">Phase {stage.step}</span>
                      <span className="w-8 h-px bg-saffron/30" />
                    </div>
                    <h3 className="font-serif text-3xl md:text-4xl text-forest mb-4 leading-tight">{stage.title}</h3>
                    <p className="font-sans text-ink/70 leading-relaxed text-sm md:text-base">{stage.longDesc}</p>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Navigation dots */}
        <div className="flex justify-center gap-3 mt-8">
          {STAGES.map((_: any, i: number) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveStep(i)}
              className={`transition-all duration-300 ${i === activeStep ? 'w-8 h-2 bg-saffron' : 'w-2 h-2 bg-forest/20 hover:bg-forest/40'}`}
            />
          ))}
        </div>
      </div>
    </motion.section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PromiseSection({ data }: { data: any }) {
  const items = data.items || [];
  return (
    <motion.section
      className="py-24"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.8 }}
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
        <div className="md:col-span-3 border-r border-hairline pr-8">
          <h2 className="font-serif text-3xl italic text-forest mb-6">{data.heading}</h2>
          <p className="font-sans text-[10px] uppercase tracking-widest leading-loose text-ink/60">{data.subheading}</p>
        </div>
        <div className="md:col-span-9 grid grid-cols-1 md:grid-cols-3 gap-12">
          {items.map((item: any) => (
            <div key={item.id} className="space-y-6">
              <h3 className="font-serif text-2xl text-forest">{item.title}</h3>
              <p className="font-sans text-ink/70 leading-relaxed">{item.text}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function QuoteSection({ data }: { data: any }) {
  return (
    <motion.section
      className="py-32"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.8 }}
    >
      <div className="max-w-5xl mx-auto">
        <blockquote className="border-l-2 border-terracotta-warm pl-8">
          <p className="font-serif text-4xl text-forest italic leading-snug">&ldquo;{data.quote}&rdquo;</p>
          {data.attribution && (
            <footer className="mt-6 font-sans text-[10px] uppercase tracking-widest text-ink/40">{data.attribution}</footer>
          )}
        </blockquote>
      </div>
    </motion.section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StatsBarSection({ data }: { data: any }) {
  const items = data.items || [];
  return (
    <motion.section
      className="py-20 border-t border-b border-hairline"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.8 }}
    >
      <div className="grid gap-0 divide-x divide-hairline" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((item: any, i: number) => (
          <motion.div
            key={item.id || i}
            className="flex flex-col items-center text-center py-8 px-6"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
          >
            <span className="font-serif text-5xl md:text-6xl text-forest font-bold tracking-tighter leading-none mb-3">
              {item.value}
            </span>
            <span className="font-sans text-[9px] uppercase tracking-[0.2em] text-ink/50 font-semibold">
              {item.label}
            </span>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BuilderModelSection({ data }: { data: any }) {
  const items = data.items || [];
  return (
    <motion.section
      className="py-32 bg-forest -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 text-parchment"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.8 }}
    >
      <div className="max-w-[1600px] mx-auto text-center">
        <h2 className="text-5xl md:text-7xl font-serif tracking-tighter mb-16 leading-tight">
          {data.headline} <span className="italic text-alabaster">{data.subheadline}</span>
        </h2>
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-12 text-left">
          {items.map((item: any, i: number) => (
            <div key={item.id || i} className="space-y-6">
              {i === 0 ? (
                <div className="text-6xl font-serif text-alabaster italic font-bold">{item.stat}</div>
              ) : (
                <div className="h-[2px] bg-saffron w-12" />
              )}
              <h3 className="font-sans text-[10px] uppercase tracking-[0.3em] opacity-80">{item.label}</h3>
              <p className="font-sans text-parchment/60 leading-relaxed text-sm">{item.description}</p>
            </div>
          ))}
        </div>
        {data.closing_quote && (
          <div className="mt-20">
            <p className="font-serif text-3xl italic text-alabaster/60">&ldquo;{data.closing_quote}&rdquo;</p>
          </div>
        )}
      </div>
    </motion.section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PhilosophySection({ data }: { data: any }) {
  return (
    <motion.section
      className="py-40 text-center relative"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.8 }}
    >
      <div className="max-w-3xl mx-auto px-6">
        <h3 className="text-4xl md:text-5xl font-serif italic mb-12 text-forest tracking-tighter whitespace-pre-line">
          {data.verse}
        </h3>
        {data.imageUrl && (
          <motion.div
            className="w-full max-w-lg mx-auto mb-12 relative overflow-hidden border border-hairline/20"
            initial={{ scale: 0.95, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, delay: 0.2 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.imageUrl}
              alt={data.heading}
              className="w-full h-auto object-cover transform hover:scale-105 transition-transform duration-700"
            />
          </motion.div>
        )}
        <div className="w-32 h-[2px] bg-terracotta-warm mx-auto mb-12 opacity-30" />
        <p className="text-2xl md:text-3xl font-sans text-ink/80 leading-relaxed mb-6">
          {data.heading?.includes('women') ? (
            <>
              {data.heading.split('women')[0]}
              <span className="editorial-underline italic text-forest"> women leaders.</span>
            </>
          ) : (
            data.heading
          )}
        </p>
        {data.body && <p className="font-sans text-lg text-ink/60 leading-relaxed mb-4">{data.body}</p>}
        {data.closing && <p className="font-serif text-xl italic text-ink/60">{data.closing}</p>}
      </div>
    </motion.section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CtaSection({ data, onApply }: { data: any; onApply: () => void }) {
  return (
    <motion.section
      className="border-t border-hairline relative overflow-hidden bg-forest -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.8 }}
    >
      <div className="py-40 flex flex-col items-center text-center">
        <h2 className="font-serif font-bold text-6xl md:text-8xl text-parchment mb-16 max-w-5xl tracking-[-0.025em] leading-[0.9]">
          {data.headline}
        </h2>
        <button
          type="button"
          onClick={onApply}
          className="mkt-btn group max-w-full text-xs sm:text-sm px-10 py-5 sm:px-16 sm:py-7"
        >
          <span>{data.cta_label || 'Apply Now'}</span>
          <ArrowRight className="w-5 h-5 shrink-0 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </motion.section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CardCarouselSection({ data }: { data: any }) {
  const cards = data.cards || [];
  const [activeCard, setActiveCard] = useState(0);

  const SWIPE_THRESHOLD = 8000;
  const swipePower = (offset: number, velocity: number) => Math.abs(offset) * velocity;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDragEnd = (e: any, { offset, velocity }: any) => {
    const swipe = swipePower(offset.x, velocity.x);
    if (swipe < -SWIPE_THRESHOLD && activeCard < cards.length - 1) setActiveCard(activeCard + 1);
    else if (swipe > SWIPE_THRESHOLD && activeCard > 0) setActiveCard(activeCard - 1);
  };

  return (
    <motion.section
      className="py-24 border-b border-hairline"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.8 }}
    >
      <h2 className="text-4xl md:text-5xl font-serif text-forest mb-20 text-center tracking-tighter">
        {data.title}
      </h2>
      <div className="relative w-full h-[500px] flex items-center justify-center overflow-hidden">
        <AnimatePresence initial={false}>
          {cards.map((card: any, i: number) => {
            const offset = i - activeCard;
            if (Math.abs(offset) > 2) return null;
            const isCenter = offset === 0;
            return (
              <motion.div
                key={card.id || i}
                drag={isCenter ? 'x' : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={1}
                onDragEnd={isCenter ? handleDragEnd : undefined}
                className="absolute w-full max-w-lg lg:max-w-2xl bg-alabaster border border-hairline/40 overflow-hidden flex flex-col cursor-grab active:cursor-grabbing"
                animate={{
                  x: `${offset * 70}%`,
                  y: `${Math.abs(offset) * 4}%`,
                  scale: 1 - Math.abs(offset) * 0.15,
                  zIndex: cards.length - Math.abs(offset),
                  opacity: 1 - Math.abs(offset) * 0.3,
                  filter: `blur(${Math.abs(offset) * 3}px)`,
                }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                onClick={() => setActiveCard(i)}
              >
                <div className="w-full h-[200px] bg-forest/5 border-b border-hairline/20 relative flex items-center justify-center overflow-hidden">
                  {card.mediaUrl ? (
                    card.mediaType === 'video' ? (
                      <video src={card.mediaUrl} className="w-full h-full object-cover" muted loop autoPlay playsInline />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.mediaUrl} alt={card.title} className="w-full h-full object-cover" />
                    )
                  ) : (
                    <div className="text-forest/20 font-serif text-6xl font-bold">{i + 1}</div>
                  )}
                  {card.tag && (
                    <span className="absolute top-4 right-4 bg-saffron text-parchment font-sans text-[9px] uppercase tracking-widest px-3 py-1">
                      {card.tag}
                    </span>
                  )}
                </div>
                <div className="p-8 md:p-10 bg-alabaster flex-1">
                  <h3 className="font-serif text-3xl text-forest mb-4">{card.title}</h3>
                  <p className="font-sans text-ink/70 leading-relaxed text-sm">{card.description}</p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <div className="flex justify-center gap-3 mt-8">
        {cards.map((_: any, i: number) => (
          <button
            key={i}
            type="button"
            onClick={() => setActiveCard(i)}
            className={`transition-all duration-300 ${i === activeCard ? 'w-8 h-2 bg-saffron' : 'w-2 h-2 bg-forest/20 hover:bg-forest/40'}`}
          />
        ))}
      </div>
    </motion.section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function RichTextSection({ data }: { data: any }) {
  const bgMap: Record<string, string> = {
    parchment: 'bg-parchment',
    forest: 'bg-forest text-parchment',
    alabaster: 'bg-alabaster',
  };
  const alignMap: Record<string, string> = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };
  return (
    <motion.section
      className={`py-24 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 ${bgMap[data.background] || 'bg-parchment'}`}
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.8 }}
    >
      <div className={`max-w-3xl mx-auto font-sans leading-relaxed text-lg ${alignMap[data.alignment] || 'text-center'} ${data.background === 'forest' ? 'text-parchment/80' : 'text-ink/80'}`}>
        {data.content}
      </div>
    </motion.section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StepsSection({ data }: { data: any }) {
  const steps = data.steps || [];
  return (
    <motion.section
      className="py-24"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.8 }}
    >
      <h2 className="text-4xl md:text-5xl font-serif text-forest mb-16 tracking-tighter">{data.title}</h2>
      <div className="space-y-12">
        {steps.map((step: any, i: number) => (
          <motion.div
            key={step.id || i}
            className="grid grid-cols-12 gap-8 items-start border-b border-hairline pb-12 last:border-0"
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
          >
            <div className="col-span-2 md:col-span-1">
              <span className="font-serif text-5xl text-saffron italic font-bold leading-none">{step.number}</span>
            </div>
            <div className="col-span-10 md:col-span-11">
              <h3 className="font-serif text-2xl text-forest mb-3">{step.title}</h3>
              <p className="font-sans text-ink/70 leading-relaxed">{step.description}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}

// ─── Section router ───────────────────────────────────────────────────────────

function renderSection(section: Section, onApply: () => void, batchInfo: any) {
  switch (section.type) {
    case 'hero':
      return <HeroSection key={section.id} data={section.data} onApply={onApply} batchInfo={batchInfo} />;
    case 'how_it_works':
      return (
        <div key={section.id}>
          <HowItWorksSection data={section.data} />
        </div>
      );
    case 'promise':
      return (
        <div key={section.id}>
          <PromiseSection data={section.data} />
          <div className="w-full border-t border-hairline" />
        </div>
      );
    case 'quote':
      return <QuoteSection key={section.id} data={section.data} />;
    case 'stats_bar':
      return <StatsBarSection key={section.id} data={section.data} />;
    case 'builder_model':
      return <BuilderModelSection key={section.id} data={section.data} />;
    case 'philosophy':
      return <PhilosophySection key={section.id} data={section.data} />;
    case 'cta':
      return <CtaSection key={section.id} data={section.data} onApply={onApply} />;
    case 'card_carousel':
      return <CardCarouselSection key={section.id} data={section.data} />;
    case 'rich_text':
      return <RichTextSection key={section.id} data={section.data} />;
    case 'steps':
      return <StepsSection key={section.id} data={section.data} />;
    default:
      return null;
  }
}

// ─── Main Manifesto component ─────────────────────────────────────────────────

export default function Manifesto({ onApply, batchInfo, settings }: ManifestoProps) {
  const sections: Section[] = useMemo(() => {
    if (settings?.homepageSections) {
      try {
        const parsed = JSON.parse(settings.homepageSections) as Section[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {
        // fall through to default
      }
    }
    return DEFAULT_SECTIONS;
  }, [settings?.homepageSections]);

  const visibleSections = [...sections]
    .filter((s) => s.visible)
    .sort((a, b) => a.order - b.order);

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 relative">
      {visibleSections.map((section) => renderSection(section, onApply, batchInfo))}

      {/* Sticky Apply Button (Mobile) — icon-only FAB on the matte saffron
          contract (.mkt-btn colour/hover/active), padding overridden to a
          fixed 64×64 square so the icon centres without text padding. */}
      <div className="fixed bottom-8 right-8 z-40 md:hidden">
        <button
          type="button"
          onClick={onApply}
          aria-label="Apply Now"
          className="mkt-btn !p-0 w-16 h-16"
        >
          <Edit3 className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}
