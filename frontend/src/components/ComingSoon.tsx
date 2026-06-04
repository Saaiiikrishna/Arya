"use client";

import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { ArrowLeft, MessageCircle, Hammer } from 'lucide-react';
import { useSettings } from '@/lib/settings';

/**
 * Temporary on-brand placeholder for public marketing routes whose full build
 * lands in a later milestone (storefront, articles). Lives in the DESIGN.md §7
 * marketing layer (`.mkt`). Replace with the real page when its milestone ships.
 */
export default function ComingSoon({ title, subtitle }: { title: string; subtitle: string }) {
  const router = useRouter();
  const { settings } = useSettings();
  const discordUrl = settings?.discordUrl || settings?.social_discord || '#';
  const discordReady = Boolean(discordUrl) && discordUrl !== '#';

  return (
    <div className="mkt relative overflow-hidden bg-parchment min-h-[calc(100dvh-80px)] flex items-center">
      <div
        aria-hidden
        className="mkt-float mkt-glow-pulse pointer-events-none absolute -top-24 -right-24 w-[34rem] h-[34rem] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(244,163,0,0.22), transparent 62%)' }}
      />
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center"
      >
        <div className="mkt-pill mx-auto mb-8">
          <Hammer className="w-3.5 h-3.5 text-saffron-deep" />
          <span className="font-sans text-[10px] uppercase tracking-[0.22em] font-bold text-forest/80">In the workshop</span>
        </div>
        <h1 className="font-serif-display font-bold text-4xl sm:text-5xl md:text-6xl 3xl:text-7xl text-forest leading-[0.95] tracking-[-0.025em] mb-6">
          {title}
        </h1>
        <p className="font-sans text-ink/70 text-base sm:text-lg leading-relaxed mb-10 sm:mb-12">{subtitle}</p>
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
          {discordReady ? (
            <a href={discordUrl} target={discordUrl.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="mkt-btn max-w-full">
              <MessageCircle className="w-4 h-4 shrink-0" />
              <span className="text-center">Join the Community on Discord</span>
            </a>
          ) : (
            <button type="button" disabled aria-disabled="true" title="Coming soon" className="mkt-btn max-w-full opacity-50 cursor-not-allowed">
              <MessageCircle className="w-4 h-4 shrink-0" />
              <span className="text-center">Join the Community on Discord</span>
            </button>
          )}
          <button type="button" onClick={() => router.push('/')} className="mkt-btn-ghost">
            <ArrowLeft className="w-4 h-4" />
            <span>Back home</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
