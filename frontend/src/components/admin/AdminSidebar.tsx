'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LogOut, Menu, X,
  LayoutDashboard, FileQuestion, ShieldCheck, Package, Users, FileSignature,
  MessageCircle, Bell, Briefcase, Heart, Settings,
  ShoppingBag, Tags, Receipt, ShoppingCart, Undo2, Ticket, LineChart,
  PenSquare, Star, Store,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';
import styles from '../AdminSidebar.module.css';

interface NavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
}

const navItems: NavItem[] = [
  { href: '/admin/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/admin/questions', label: 'Questions', Icon: FileQuestion },
  { href: '/admin/eligibility', label: 'Eligibility', Icon: ShieldCheck },
  { href: '/admin/batches', label: 'Batches', Icon: Package },
  { href: '/admin/users', label: 'Users', Icon: Users },
  { href: '/admin/consent', label: 'Consent', Icon: FileSignature },
  { href: '/admin/whatsapp', label: 'WhatsApp', Icon: MessageCircle },
  { href: '/admin/notifications', label: 'Notifications', Icon: Bell },
  { href: '/admin/investors', label: 'Investors', Icon: Briefcase },
  { href: '/admin/donations', label: 'Donations', Icon: Heart },
  { href: '/admin/settings', label: 'Settings', Icon: Settings },
  // ─── Store / commerce ───
  { href: '/admin/store/products', label: 'Products', Icon: ShoppingBag },
  { href: '/admin/store/inventory', label: 'Inventory', Icon: Tags },
  { href: '/admin/store/purchasing', label: 'Purchasing', Icon: Receipt },
  { href: '/admin/store/orders', label: 'Orders', Icon: ShoppingCart },
  { href: '/admin/store/returns', label: 'Returns', Icon: Undo2 },
  { href: '/admin/store/coupons', label: 'Coupons', Icon: Ticket },
  { href: '/admin/store/analytics', label: 'Store Analytics', Icon: LineChart },
  { href: '/admin/store/articles', label: 'Articles', Icon: PenSquare },
  { href: '/admin/store/reviews', label: 'Reviews', Icon: Star },
  { href: '/admin/store/settings', label: 'Store Settings', Icon: Store },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const logoMode = settings?.logoMode || 'text';

  // Mobile off-canvas drawer state. On lg+ the CSS keeps the sidebar in place
  // regardless of this value, so it is purely the mobile menu toggle.
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the drawer whenever the route changes (navigation closes the menu).
  // Done during render via a tracked previous pathname rather than an effect, so
  // there is no extra commit/paint with the menu still open after navigating.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (mobileOpen) setMobileOpen(false);
  }

  const logoEl = logoMode === 'text' ? (
    <div className="flex flex-col items-center">
      <span className="text-xl font-serif italic font-bold text-forest leading-none">Aryavartham</span>
      <span className="text-[8px] font-serif italic text-forest mt-0.5 leading-none">- The Founder&apos;s Club</span>
    </div>
  ) : (
    <img src="/logo-full.svg" alt="Aryavartham" className="h-8 object-contain" />
  );

  return (
    <>
      {/* Mobile top bar with hamburger — hidden at lg+ via CSS */}
      <div className={styles.mobileBar}>
        <button
          type="button"
          className={styles.hamburger}
          aria-label="Open admin menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="w-5 h-5" aria-hidden />
        </button>
        {logoEl}
      </div>

      {/* Backdrop — only rendered (and only visible at <lg) while open */}
      {mobileOpen && (
        <div
          className={styles.backdrop}
          aria-hidden
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.logo}>
          {logoEl}
          <button
            type="button"
            className={`${styles.hamburger} lg:hidden ml-auto`}
            aria-label="Close admin menu"
            onClick={() => setMobileOpen(false)}
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        <nav className={styles.nav}>
          {navItems.map((item) => {
            // Exact match OR a true descendant (href + '/') so a leaf route never
            // lights up a sibling that merely shares its string prefix. e.g.
            // `/admin/store/orders` highlights on `/admin/store/orders/[id]` but
            // `/admin/store` would NOT spuriously match `/admin/store-foo`.
            const isActive =
              pathname === item.href || pathname?.startsWith(`${item.href}/`);
            const { Icon } = item;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`${styles.navItem} ${isActive ? styles.active : ''}`}
              >
                <span className={styles.navIcon} aria-hidden>
                  <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                </span>
                <span className={styles.navLabel}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-hairline flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className={styles.avatar}>
              {user?.firstName?.charAt(0) || 'A'}{user?.lastName?.charAt(0) || 'D'}
            </div>
            <div className={styles.adminDetails}>
              <span className={styles.adminName}>
                {user?.firstName || 'Admin'} {user?.lastName || 'User'}
              </span>
              <span className={styles.adminRole}>{user?.role || 'Administrator'}</span>
            </div>
          </div>
          <button
            className="w-full flex items-center justify-center gap-3 py-2 border border-terracotta/20 text-terracotta hover:bg-terracotta/10 transition-colors cursor-pointer group"
            onClick={() => {
              logout();
              router.push('/admin/login');
            }}
            title="Logout"
          >
            <span className="font-sans text-[10px] uppercase tracking-widest font-bold group-hover:tracking-[0.25em] transition-all">Logout</span>
            <LogOut className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>
      </aside>
    </>
  );
}
