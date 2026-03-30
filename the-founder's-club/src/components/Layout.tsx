import { ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, LogOut } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
  activeTab?: 'manifesto' | 'apply' | 'archives' | 'hub';
  onTabChange?: (tab: any) => void;
  showNav?: boolean;
}

export default function Layout({ children, activeTab = 'manifesto', onTabChange, showNav = true }: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col selection:bg-forest selection:text-parchment">
      {showNav && (
        <header className="bg-parchment border-b border-hairline sticky top-0 z-50">
          <nav className="flex justify-between items-center w-full px-8 py-6 max-w-screen-2xl mx-auto">
            <div 
              className="text-2xl font-serif italic text-forest cursor-pointer"
              onClick={() => onTabChange?.('manifesto')}
            >
              The Founder's Club
            </div>
            <div className="hidden md:flex items-center space-x-8">
              {[
                { id: 'manifesto', label: 'Manifesto' },
                { id: 'apply', label: 'Apply' },
                { id: 'archives', label: 'Archives' },
                { id: 'hub', label: 'Hub' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => onTabChange?.(tab.id)}
                  className={`pb-1 font-sans text-[10px] uppercase tracking-widest transition-colors duration-300 ${
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
              <User className="w-6 h-6 text-forest cursor-pointer" />
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

      <footer className="bg-parchment border-t border-hairline">
        <div className="flex flex-col md:flex-row justify-between items-center w-full px-8 py-12 max-w-screen-2xl mx-auto">
          <div className="text-lg font-serif italic text-forest mb-8 md:mb-0">
            The Founder's Club
          </div>
          <div className="flex flex-wrap justify-center gap-8 mb-8 md:mb-0">
            {['Privacy', 'Terms', 'Contact'].map((link) => (
              <a
                key={link}
                href="#"
                className="text-ink/40 font-sans text-[10px] uppercase tracking-widest hover:text-terracotta transition-all"
              >
                {link}
              </a>
            ))}
          </div>
          <div className="text-ink/40 font-sans text-[10px] uppercase tracking-widest">
            © 2024 The Founder's Club. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
