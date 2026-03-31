"use client";

import React, { ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';
import { useScroll, useTransform } from 'motion/react';

interface LayoutProps {
  children: React.ReactNode;
  activeTab?: 'manifesto' | 'apply' | 'archives' | 'hub' | 'pledge' | 'investors' | 'support';
  onTabChange?: (tabId: string) => void;
  showNav?: boolean;
}

export default function Layout({ children, activeTab = 'manifesto', onTabChange, showNav = true }: LayoutProps) {
  const router = useRouter();
  const { admin: user, isAuthenticated } = useAuth();

  const handleNavigation = (id: string) => {
    // If the Layout component allows callback overrides, call it. Otherwise route natively.
    if (onTabChange) {
      onTabChange(id);
    } else {
      router.push(id === 'manifesto' ? '/' : `/${id}`);
    }
  };

  const { settings } = useSettings();
  const logoMode = settings?.logoMode || 'text';

  // Scroll animations
  const { scrollY } = useScroll();
  // When scrolled past 50px, switch states
  const isScrolled = useTransform(scrollY, [0, 50], [0, 1]);

  // Full logo slides left and fades out
  const fullLogoX = useTransform(scrollY, [0, 80], [0, -50]);
  const fullLogoOpacity = useTransform(scrollY, [0, 60], [1, 0]);

  // Short logo slides in from right and fades in
  const shortLogoX = useTransform(scrollY, [0, 80], [50, 0]);
  const shortLogoOpacity = useTransform(scrollY, [20, 80], [0, 1]);

  // Pointer events derived from opacity — must be at top level (Rules of Hooks)
  const fullLogoPointerEvents = useTransform(fullLogoOpacity, v => v > 0.5 ? 'auto' : 'none');
  const shortLogoPointerEvents = useTransform(shortLogoOpacity, v => v > 0.5 ? 'auto' : 'none');

  return (
    <div className="min-h-screen flex flex-col selection:bg-forest selection:text-parchment">
      {showNav && (
        <header className="bg-parchment border-b border-hairline sticky top-0 z-50">
          <nav className="flex justify-between items-center w-full px-8 py-6 max-w-screen-2xl mx-auto">
            <div
              className={`flex cursor-pointer relative ${logoMode === 'svg' ? 'h-16 items-center w-48 md:w-64' : 'flex-col items-end'}`}
              onClick={() => handleNavigation('manifesto')}
            >
              {logoMode === 'text' ? (
                <div className="flex flex-col items-end">
                  <span className="text-2xl md:text-3xl font-serif italic font-bold text-forest leading-none">Aryavartham</span>
                  <span className="text-[9px] md:text-[10px] font-serif italic text-forest mt-1 leading-none text-right w-full pr-0.5 md:pr-1">- The Founder&apos;s Club</span>
                </div>
              ) : (
                <div className="relative w-full h-full flex items-center">
                  <motion.img
                    src="/logo-full.svg"
                    alt="Aryavartham"
                    className="absolute left-0 h-10 md:h-16 object-contain origin-left"
                    style={{
                      x: fullLogoX,
                      opacity: fullLogoOpacity,
                      pointerEvents: fullLogoPointerEvents as any,
                    }}
                  />
                  <motion.img
                    src="/logo-short.svg"
                    alt="Arya"
                    className="absolute left-0 h-10 md:h-16 object-contain origin-left"
                    style={{
                      x: shortLogoX,
                      opacity: shortLogoOpacity,
                      pointerEvents: shortLogoPointerEvents as any,
                    }}
                  />
                </div>
              )}
            </div>
            <div className="hidden md:flex items-center space-x-8">
              {[
                { id: 'manifesto', label: 'Manifesto' },
                { id: 'apply', label: 'Apply' },
                { id: 'archives', label: 'Archives' },
                { id: 'investors', label: 'Investors' },
                { id: 'support', label: 'Support' },
                { id: 'hub', label: 'Hub' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleNavigation(tab.id)}
                  className={`pb-1 font-sans text-[10px] uppercase tracking-widest cursor-pointer transition-colors duration-300 ${
                    activeTab === tab.id
                      ? 'text-forest border-b border-forest'
                      : 'text-ink/60 hover:text-terracotta'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex items-center">
              {isAuthenticated && user?.avatarUrl ? (
                <img 
                  src={user.avatarUrl} 
                  alt="Profile" 
                  className="w-8 h-8 rounded-full border border-hairline cursor-pointer hover:ring-2 hover:ring-forest/20 transition-all"
                  onClick={() => router.push('/profile')}
                />
              ) : (
                <User 
                  className="w-6 h-6 text-forest cursor-pointer hover:text-terracotta transition-colors" 
                  onClick={() => router.push(isAuthenticated ? '/profile' : '/login')} 
                />
              )}
            </div>
          </nav>
        </header>
      )}

      <main className="flex-grow">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="bg-parchment border-t border-hairline relative z-10 pt-16 pb-12 px-8">
        <div className="max-w-screen-2xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
            <div className="flex flex-col border-l border-forest/20 pl-6">
              <div className="mb-6">
                {logoMode === 'text' ? (
                  <>
                    <span className="text-2xl font-serif italic font-bold text-forest leading-none block">Aryavartham</span>
                    <span className="text-[10px] font-serif italic text-forest mt-1 leading-none text-right block w-full pr-1">- The Founder&apos;s Club</span>
                  </>
                ) : (
                  <img src="/logo-full.svg" alt="Aryavartham" className="h-12 object-contain" />
                )}
              </div>
              <p className="font-sans text-[10px] text-ink/60 uppercase tracking-widest leading-loose max-w-[200px]">
                A three-year co-founder commitment that transcends traditional incubation.
              </p>
            </div>
            
            <div className="flex flex-col gap-4 border-l border-forest/10 pl-6">
               <h4 className="font-serif italic text-forest mb-2">Navigation</h4>
              {['Manifesto', 'Apply', 'Archives'].map((link) => (
                <button
                  key={link}
                  onClick={() => handleNavigation(link.toLowerCase())}
                  className="text-left font-sans text-xs uppercase tracking-widest text-ink/70 hover:text-terracotta transition-colors"
                >
                  {link}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-4 border-l border-forest/10 pl-6">
               <h4 className="font-serif italic text-forest mb-2">Join us</h4>
              {['Investors', 'Support', 'Hub'].map((link) => (
                <button
                  key={link}
                  onClick={() => handleNavigation(link.toLowerCase())}
                  className="text-left font-sans text-xs uppercase tracking-widest text-ink/70 hover:text-terracotta transition-colors"
                >
                  {link}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-4 border-l border-forest/10 pl-6">
               <h4 className="font-serif italic text-forest mb-2">Network</h4>
               {settings?.social_twitter && (
                 <a href={settings.social_twitter} target="_blank" rel="noopener noreferrer" className="font-sans text-xs uppercase tracking-widest text-ink/70 hover:text-terracotta transition-colors">
                   Twitter (X)
                 </a>
               )}
               {settings?.social_linkedin && (
                 <a href={settings.social_linkedin} target="_blank" rel="noopener noreferrer" className="font-sans text-xs uppercase tracking-widest text-ink/70 hover:text-terracotta transition-colors">
                   LinkedIn
                 </a>
               )}
               {settings?.social_instagram && (
                 <a href={settings.social_instagram} target="_blank" rel="noopener noreferrer" className="font-sans text-xs uppercase tracking-widest text-ink/70 hover:text-terracotta transition-colors">
                   Instagram
                 </a>
               )}
               {(!settings?.social_twitter && !settings?.social_linkedin && !settings?.social_instagram) && (
                 <span className="font-sans text-xs text-ink/30 italic">No public networks currently indexed.</span>
               )}
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between items-center pt-8 border-t border-hairline gap-6">
            <div className="flex gap-8">
               <a href="/privacy" className="text-ink/40 font-sans text-[10px] uppercase tracking-widest hover:text-forest transition-colors">Privacy Policy</a>
               <a href="/terms" className="text-ink/40 font-sans text-[10px] uppercase tracking-widest hover:text-forest transition-colors">Terms of Service</a>
            </div>
            <div className="text-ink/40 font-sans text-[10px] uppercase tracking-widest text-center md:text-right">
              © {new Date().getFullYear()} Aryavartham. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
