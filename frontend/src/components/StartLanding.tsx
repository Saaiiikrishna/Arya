"use client";

import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  ArrowRight,
  CircuitBoard,
  Rocket,
  Users,
  Flame,
  Cpu,
  Terminal,
  BookOpen,
  ShoppingBag,
  MessageCircle,
  Wrench,
} from 'lucide-react';
import { useSettings } from '@/lib/settings';

/**
 * Public home landing (route "/"). Lives in the DESIGN.md §7 "Public Marketing"
 * layer — everything here is wrapped in `.mkt` so the glossy/rounded utilities
 * apply ONLY here and never leak into the app/admin. The message (builders,
 * making real things, sharpening craft, finding your people, building together
 * in person) is conveyed through composition + copy, never stated as labels.
 */
export default function StartLanding() {
  const router = useRouter();
  const { settings } = useSettings();

  const discordUrl = settings?.discordUrl || settings?.social_discord || '#';
  const storeUrl = settings?.storeUrl || '/store';
  const articlesUrl = settings?.articlesUrl || '/articles';

  const goStore = () => router.push(storeUrl);
  const goArticles = () => router.push(articlesUrl);

  const reveal = {
    initial: { opacity: 0, y: 36 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.2 },
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  };

  const ethos = [
    {
      icon: CircuitBoard,
      title: 'Make real things',
      body: 'Boards, sensors, firmware that blinks back. Projects you can hold in your hand — not just repos you star and forget.',
    },
    {
      icon: Rocket,
      title: 'Curious to capable',
      body: 'You learn it by building it. Every project you finish leaves you sharper than it found you.',
    },
    {
      icon: Users,
      title: 'Find your kind',
      body: 'The ones who reply at 2am with a wiring diagram. You will recognise them the moment you meet them.',
    },
    {
      icon: Flame,
      title: 'In the same room',
      body: 'Long build nights, shoulder to shoulder, racing the same clock. The energy you cannot get alone.',
    },
  ];

  return (
    <div className="mkt relative overflow-hidden bg-parchment">
      {/* ============================ HERO ============================ */}
      <section className="relative min-h-[calc(100vh-80px)] flex items-center">
        {/* Ambient gradient orbs */}
        <div
          aria-hidden
          className="mkt-float mkt-glow-pulse pointer-events-none absolute -top-24 -left-24 w-[34rem] h-[34rem] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(244,163,0,0.30), transparent 62%)' }}
        />
        <div
          aria-hidden
          className="mkt-float pointer-events-none absolute top-1/3 -right-32 w-[40rem] h-[40rem] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(232,93,4,0.20), transparent 64%)', animationDelay: '1.5s' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.5]"
          style={{ background: 'radial-gradient(120% 80% at 50% -10%, rgba(19,48,34,0.06), transparent 60%)' }}
        />

        <div className="relative z-10 max-w-screen-2xl mx-auto px-8 w-full py-24">
          <div className="max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              className="mkt-pill mb-8"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-saffron opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-saffron" />
              </span>
              <span className="font-sans text-[10px] uppercase tracking-[0.22em] font-bold text-forest/80">
                Built by people who can&rsquo;t sit still
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.05 }}
              className="font-serif-display font-bold text-forest leading-[0.92] tracking-[-0.03em] text-6xl md:text-7xl lg:text-[6.5rem]"
            >
              Build the thing you<br className="hidden md:block" />{' '}
              can&rsquo;t stop <span className="text-saffron italic">thinking</span> about.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.15 }}
              className="mt-8 font-sans text-lg md:text-2xl leading-relaxed text-ink/75 max-w-2xl"
            >
              A place to make real hardware, sharpen your craft, and find the people
              who stay up late building too.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.25 }}
              className="mt-12 flex flex-col sm:flex-row flex-wrap gap-4"
            >
              <a href={discordUrl} target={discordUrl.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="mkt-btn">
                <MessageCircle className="w-4 h-4" />
                <span>Join the Community</span>
              </a>
              <button type="button" onClick={goStore} className="mkt-btn-ghost">
                <ShoppingBag className="w-4 h-4" />
                <span>Visit the Store</span>
              </button>
              <button type="button" onClick={goArticles} className="mkt-btn-ghost">
                <BookOpen className="w-4 h-4" />
                <span>Read the Journal</span>
              </button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.5 }}
              className="mt-14 flex items-center gap-6 text-ink/45 font-sans text-[10px] uppercase tracking-[0.18em]"
            >
              <span className="flex items-center gap-2"><Cpu className="w-3.5 h-3.5" /> Microcontrollers</span>
              <span className="hidden sm:flex items-center gap-2"><Terminal className="w-3.5 h-3.5" /> Firmware</span>
              <span className="hidden md:flex items-center gap-2"><Wrench className="w-3.5 h-3.5" /> Hands-on builds</span>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ============================ ETHOS ============================ */}
      <section className="relative py-28 px-8">
        <div className="max-w-screen-2xl mx-auto">
          <motion.div {...reveal} className="max-w-2xl mb-16">
            <p className="font-sans text-[11px] uppercase tracking-[0.24em] text-saffron-deep font-bold mb-4">
              Why you&rsquo;ll stay
            </p>
            <h2 className="font-serif text-4xl md:text-5xl text-forest tracking-tight leading-tight">
              It starts as a side project.<br />
              <span className="italic text-terracotta-warm">It becomes who you are.</span>
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {ethos.map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.6, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                className="mkt-card p-7 flex flex-col"
              >
                <div className="w-12 h-12 rounded-2xl bg-saffron/12 flex items-center justify-center mb-6">
                  <item.icon className="w-6 h-6 text-saffron-deep" strokeWidth={1.6} />
                </div>
                <h3 className="font-serif text-2xl text-forest mb-3 leading-snug">{item.title}</h3>
                <p className="font-sans text-sm text-ink/65 leading-relaxed">{item.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ====================== STORE / MAKER BAND ====================== */}
      <section className="relative py-32 px-8 overflow-hidden bg-forest text-parchment">
        <div
          aria-hidden
          className="mkt-glow-pulse pointer-events-none absolute -bottom-40 -left-20 w-[36rem] h-[36rem] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(244,163,0,0.18), transparent 64%)' }}
        />
        <div className="relative z-10 max-w-screen-2xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <motion.div {...reveal}>
            <p className="font-sans text-[11px] uppercase tracking-[0.24em] text-saffron-glow font-bold mb-5">
              From idea to in-your-hands
            </p>
            <h2 className="font-serif-display font-bold text-5xl md:text-6xl leading-[0.95] tracking-[-0.025em] mb-8">
              Buy it ready.<br /><span className="italic text-alabaster">Or build it yourself.</span>
            </h2>
            <p className="font-sans text-parchment/70 text-lg leading-relaxed max-w-xl mb-10">
              Every kit can be yours assembled and tested — or you take the parts list, the wiring,
              the code, and the step-by-step, and you make it with your own two hands. Your call.
            </p>
            <button type="button" onClick={goStore} className="mkt-btn">
              <ShoppingBag className="w-4 h-4" />
              <span>Visit the Store</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.7 }}
            className="grid grid-cols-2 gap-5"
          >
            {[
              { k: 'Kits', v: 'Solder-free starts', icon: CircuitBoard },
              { k: 'Parts', v: 'Down to the resistor', icon: Cpu },
              { k: 'Code', v: 'Copy, flash, tweak', icon: Terminal },
              { k: 'Guides', v: 'Step by patient step', icon: Wrench },
            ].map((c) => (
              <div key={c.k} className="mkt-glass p-7">
                <c.icon className="w-7 h-7 text-saffron-glow mb-5" strokeWidth={1.5} />
                <div className="font-serif text-2xl text-parchment mb-1">{c.k}</div>
                <div className="font-sans text-[11px] uppercase tracking-[0.16em] text-parchment/55">{c.v}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ====================== JOURNAL TEASER ====================== */}
      <section className="relative py-28 px-8">
        <div className="max-w-screen-2xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <motion.div {...reveal} className="lg:col-span-7">
            <p className="font-sans text-[11px] uppercase tracking-[0.24em] text-saffron-deep font-bold mb-4">
              Read how it&rsquo;s done
            </p>
            <h2 className="font-serif text-4xl md:text-5xl text-forest tracking-tight leading-tight mb-6">
              Teardowns, write-ups, and the<br className="hidden md:block" /> mistakes nobody warns you about.
            </h2>
            <p className="font-sans text-ink/65 text-lg leading-relaxed max-w-2xl mb-9">
              Field notes from real builds. Got something worth sharing? Write it up — get it
              in front of everyone here.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <button type="button" onClick={goArticles} className="mkt-btn">
                <BookOpen className="w-4 h-4" />
                <span>Read the Journal</span>
              </button>
              <button type="button" onClick={() => router.push('/articles/submit')} className="mkt-btn-ghost">
                <span>Submit your write-up</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.7 }}
            className="lg:col-span-5"
          >
            <div className="mkt-card p-8">
              <BookOpen className="w-8 h-8 text-saffron-deep mb-6" strokeWidth={1.5} />
              <div className="space-y-5">
                {['The 3am bug that was always the ground wire', 'Cheap sensors, honest numbers', 'Your first PCB, without the tears'].map((t) => (
                  <div key={t} className="pb-5 border-b border-hairline/60 last:border-0 last:pb-0">
                    <span className="font-sans text-[10px] uppercase tracking-[0.16em] text-ink/40">Field note</span>
                    <p className="font-serif text-xl text-forest leading-snug mt-1">{t}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ====================== COMMUNITY / DISCORD ====================== */}
      <section className="relative py-32 px-8 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(80% 120% at 50% 0%, rgba(232,93,4,0.08), transparent 60%)' }}
        />
        <motion.div {...reveal} className="relative z-10 max-w-3xl mx-auto text-center">
          <div className="mkt-pill mx-auto mb-8">
            <MessageCircle className="w-3.5 h-3.5 text-saffron-deep" />
            <span className="font-sans text-[10px] uppercase tracking-[0.22em] font-bold text-forest/80">Pull up a chair</span>
          </div>
          <h2 className="font-serif-display font-bold text-5xl md:text-7xl text-forest leading-[0.95] tracking-[-0.025em] mb-8">
            The hardest part is<br /><span className="italic text-saffron">starting alone.</span>
          </h2>
          <p className="font-sans text-ink/70 text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mb-12">
            So don&rsquo;t. Drop in, show what you&rsquo;re working on, ask the dumb question, answer
            someone else&rsquo;s. This is where it all happens between the builds.
          </p>
          <a href={discordUrl} target={discordUrl.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="mkt-btn text-sm px-12 py-5">
            <MessageCircle className="w-5 h-5" />
            <span>Join the Community on Discord</span>
            <ArrowRight className="w-5 h-5" />
          </a>
        </motion.div>
      </section>
    </div>
  );
}
