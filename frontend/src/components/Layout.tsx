"use client";

import React, { ReactNode, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, LogOut, ShoppingBag, Menu, X } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';
import { useScroll, useTransform } from 'motion/react';
import { useStoreCart } from '@/lib/storeCart';
import CartDrawer from '@/components/store/CartDrawer';

interface LayoutProps {
  children: React.ReactNode;
  activeTab?:
    | 'home'
    | 'manifesto'
    | 'startup'
    | 'store'
    | 'articles'
    | 'apply'
    | 'archives'
    | 'hub'
    | 'pledge'
    | 'investors'
    | 'support';
  onTabChange?: (tabId: string) => void;
  showNav?: boolean;
}

// Single source of truth for the primary nav items — shared by the desktop
// inline bar and the mobile slide-down menu so they never drift apart.
const NAV_ITEMS = [
  { id: 'startup', label: 'Start Up' },
  { id: 'store', label: 'Store' },
  { id: 'articles', label: 'Articles' },
  { id: 'archives', label: 'Archives' },
  { id: 'investors', label: 'Investors' },
  { id: 'support', label: 'Support' },
  { id: 'hub', label: 'Hub' },
] as const;

export default function Layout({ children, activeTab = 'manifesto', onTabChange, showNav = true }: LayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated } = useAuth();
  const { count: cartCount, isOpen: cartOpen, openCart, closeCart } = useStoreCart();

  // Mobile menu open state — controls the slide-down panel below the md breakpoint.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavigation = (id: string) => {
    // Closing here covers the override path too: when onTabChange swaps tabs in
    // place the pathname never changes, so the render-time reset below won't fire.
    setMobileMenuOpen(false);
    // If the Layout component allows callback overrides, call it. Otherwise route natively.
    if (onTabChange) {
      onTabChange(id);
    } else {
      router.push(id === 'manifesto' ? '/' : `/${id}`);
    }
  };

  // Close the mobile menu whenever the route changes (back/forward, link clicks
  // that resolve to a new path, etc.). Uses the React-recommended "adjust state
  // during render" pattern (track the prev pathname in state, reset synchronously)
  // rather than a useEffect — the latter trips `react-hooks/set-state-in-effect`
  // and would leave the menu open for a frame after navigating.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileMenuOpen(false);
  }

  // Close the mobile menu on ESC for keyboard users.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  const { settings } = useSettings();
  const logoMode = settings?.logoMode || 'text';

  // Defense-in-depth: only render an avatar from an http(s) URL. Rejects
  // javascript:/data: schemes before they reach the DOM (modern browsers block
  // javascript: in <img src>, but guard at the source rather than rely on that).
  const safeAvatarUrl =
    user?.avatarUrl &&
    (user.avatarUrl.startsWith('https://') || user.avatarUrl.startsWith('http://'))
      ? user.avatarUrl
      : undefined;

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

  // Pointer events derived from opacity — must be at top level (Rules of Hooks).
  // Typed as CSSProperties['pointerEvents'] so the inline style accepts the
  // MotionValue without an `as any` escape hatch.
  const fullLogoPointerEvents = useTransform(
    fullLogoOpacity,
    (v): React.CSSProperties['pointerEvents'] => (v > 0.5 ? 'auto' : 'none'),
  );
  const shortLogoPointerEvents = useTransform(
    shortLogoOpacity,
    (v): React.CSSProperties['pointerEvents'] => (v > 0.5 ? 'auto' : 'none'),
  );

  return (
    <div className="min-h-screen flex flex-col selection:bg-forest selection:text-parchment">
      {showNav && (
        <header className="bg-parchment border-b border-hairline sticky top-0 z-50">
          <nav className="flex justify-between items-center w-full gap-4 px-4 sm:px-6 lg:px-8 py-4 md:py-6 max-w-screen-2xl 3xl:max-w-[1800px] mx-auto">
            <div
              className={`flex cursor-pointer relative shrink-0 ${logoMode === 'svg' ? 'h-12 md:h-16 items-center w-40 sm:w-48 md:w-64' : 'flex-col items-end'}`}
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
                      pointerEvents: fullLogoPointerEvents,
                    }}
                  />
                  <motion.img
                    src="/logo-short.svg"
                    alt="Arya"
                    className="absolute left-0 h-10 md:h-16 object-contain origin-left"
                    style={{
                      x: shortLogoX,
                      opacity: shortLogoOpacity,
                      pointerEvents: shortLogoPointerEvents,
                    }}
                  />
                </div>
              )}
            </div>
            <div className="hidden md:flex items-center md:gap-4 lg:gap-6">
              {NAV_ITEMS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleNavigation(tab.id)}
                  className={`pb-1 font-sans text-[10px] uppercase tracking-widest cursor-pointer transition-colors duration-300 ${
                    activeTab === tab.id
                      ? 'text-forest border-b border-forest'
                      : 'text-ink/60 hover:text-terracotta-warm'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-4 sm:gap-5 shrink-0">
              {/* Cart — opens the slide-over drawer; badge shows total item count. */}
              <button
                type="button"
                onClick={openCart}
                aria-label={cartCount > 0 ? `Open cart, ${cartCount} items` : 'Open cart'}
                className="relative cursor-pointer text-forest transition-colors hover:text-terracotta-warm"
              >
                <ShoppingBag className="w-6 h-6" />
                {cartCount > 0 && (
                  <span className="absolute -top-2 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-terracotta px-1 font-sans text-[10px] font-bold leading-none text-parchment tabular-nums">
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                )}
              </button>

              {isAuthenticated && safeAvatarUrl ? (
                <img
                  src={safeAvatarUrl}
                  alt="Profile"
                  className="w-8 h-8 rounded-full border border-hairline cursor-pointer hover:ring-2 hover:ring-forest/20 transition-all"
                  onClick={() => router.push('/profile')}
                />
              ) : (
                <User
                  className="w-6 h-6 text-forest cursor-pointer hover:text-terracotta-warm transition-colors"
                  onClick={() => router.push(isAuthenticated ? '/profile' : '/login')}
                />
              )}

              {/* Hamburger — only below md; toggles the slide-down mobile menu. */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen((open) => !open)}
                aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-nav-panel"
                className="md:hidden -mr-1 flex items-center justify-center text-forest cursor-pointer transition-colors hover:text-terracotta-warm"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </nav>

          {/* Mobile menu — full-width slide-down panel under the header, md and below. */}
          <AnimatePresence>
            {mobileMenuOpen && (
              <motion.div
                id="mobile-nav-panel"
                key="mobile-nav-panel"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="md:hidden overflow-hidden border-t border-hairline bg-parchment"
              >
                <div className="flex flex-col px-4 sm:px-6 py-2">
                  {NAV_ITEMS.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => handleNavigation(tab.id)}
                      className={`text-left py-3 border-b border-hairline last:border-b-0 font-sans text-xs uppercase tracking-widest cursor-pointer transition-colors ${
                        activeTab === tab.id
                          ? 'text-forest'
                          : 'text-ink/60 hover:text-terracotta-warm'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
        <div className="max-w-screen-2xl 3xl:max-w-[1800px] mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
            <div className="flex flex-col border-l border-forest/20 pl-6">
              <div className="mb-6">
                {logoMode === 'text' ? (
                  <div className="flex flex-col items-end max-w-max">
                    <span className="text-2xl font-serif italic font-bold text-forest leading-none">Aryavartham</span>
                    <span className="text-[9px] font-serif italic text-forest mt-1 leading-none text-right w-full pr-0.5">- The Founder&apos;s Club</span>
                  </div>
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
              {[
                { id: 'startup', label: 'Start Up' },
                { id: 'store', label: 'Store' },
                { id: 'articles', label: 'Articles' },
                { id: 'archives', label: 'Archives' },
              ].map((link) => (
                <button
                  key={link.id}
                  onClick={() => handleNavigation(link.id)}
                  className="text-left font-sans text-xs uppercase tracking-widest text-ink/70 hover:text-terracotta-warm transition-colors"
                >
                  {link.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-4 border-l border-forest/10 pl-6">
               <h4 className="font-serif italic text-forest mb-2">Join us</h4>
              {['Investors', 'Support', 'Hub'].map((link) => (
                <button
                  key={link}
                  onClick={() => handleNavigation(link.toLowerCase())}
                  className="text-left font-sans text-xs uppercase tracking-widest text-ink/70 hover:text-terracotta-warm transition-colors"
                >
                  {link}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-4 border-l border-forest/10 pl-6">
               <h4 className="font-serif italic text-forest mb-2">Network</h4>
               {settings?.social_twitter && (
                 <a href={settings.social_twitter} target="_blank" rel="noopener noreferrer" className="font-sans text-xs uppercase tracking-widest text-ink/70 hover:text-terracotta-warm transition-colors">
                   Twitter (X)
                 </a>
               )}
               {settings?.social_linkedin && (
                 <a href={settings.social_linkedin} target="_blank" rel="noopener noreferrer" className="font-sans text-xs uppercase tracking-widest text-ink/70 hover:text-terracotta-warm transition-colors">
                   LinkedIn
                 </a>
               )}
               {settings?.social_instagram && (
                 <a href={settings.social_instagram} target="_blank" rel="noopener noreferrer" className="font-sans text-xs uppercase tracking-widest text-ink/70 hover:text-terracotta-warm transition-colors">
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
            <div className="flex flex-col items-center md:items-end gap-1 text-center md:text-right">
              <span className="text-ink/40 font-sans text-[10px] uppercase tracking-widest">
                © {new Date().getFullYear()} Aryavartham. All rights reserved.
              </span>
              <span className="text-ink/25 font-sans text-[9px] uppercase tracking-widest">
                Aryavartham is a brand by SKSC MYSILLYDREAMS PRIVATE LIMITED
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* Slide-over cart drawer (portal). State lives in the store-cart context so
          the header badge and the drawer stay in sync app-wide. */}
      <CartDrawer open={cartOpen} onClose={closeCart} />
    </div>
  );
}
