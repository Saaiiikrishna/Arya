'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';
import styles from '../AdminSidebar.module.css';

const navItems = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/admin/questions', label: 'Questions', icon: '❓' },
  { href: '/admin/eligibility', label: 'Eligibility', icon: '✅' },
  { href: '/admin/batches', label: 'Batches', icon: '📦' },
  { href: '/admin/users', label: 'Users', icon: '👥' },
  { href: '/admin/consent', label: 'Consent', icon: '📝' },
  { href: '/admin/whatsapp', label: 'WhatsApp', icon: '💬' },
  { href: '/admin/notifications', label: 'Notifications', icon: '🔔' },
  { href: '/admin/investors', label: 'Investors', icon: '💼' },
  { href: '/admin/donations', label: 'Donations', icon: '❤️' },
  { href: '/admin/settings', label: 'Settings', icon: '⚙️' },
  // ─── Store / commerce ───
  { href: '/admin/store/products', label: 'Products', icon: '🛍️' },
  { href: '/admin/store/inventory', label: 'Inventory', icon: '🏷️' },
  { href: '/admin/store/purchasing', label: 'Purchasing', icon: '🧾' },
  { href: '/admin/store/orders', label: 'Orders', icon: '🧺' },
  { href: '/admin/store/returns', label: 'Returns', icon: '↩️' },
  { href: '/admin/store/coupons', label: 'Coupons', icon: '🎟️' },
  { href: '/admin/store/analytics', label: 'Store Analytics', icon: '📈' },
  { href: '/admin/store/articles', label: 'Articles', icon: '✍️' },
  { href: '/admin/store/reviews', label: 'Reviews', icon: '⭐' },
  { href: '/admin/store/settings', label: 'Store Settings', icon: '🏬' },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const logoMode = settings?.logoMode || 'text';

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        {logoMode === 'text' ? (
          <div className="flex flex-col items-center">
            <span className="text-xl font-serif italic font-bold text-forest leading-none">Aryavartham</span>
            <span className="text-[8px] font-serif italic text-forest mt-0.5 leading-none">- The Founder&apos;s Club</span>
          </div>
        ) : (
          <img src="/logo-full.svg" alt="Aryavartham" className="h-8 object-contain" />
        )}
      </div>

      <nav className={styles.nav}>
        {navItems.map((item) => {
          // Exact match OR a true descendant (href + '/') so a leaf route never
          // lights up a sibling that merely shares its string prefix. e.g.
          // `/admin/store/orders` highlights on `/admin/store/orders/[id]` but
          // `/admin/store` would NOT spuriously match `/admin/store-foo`.
          const isActive =
            pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${isActive ? styles.active : ''}`}
            >
              <span className={styles.navIcon} aria-hidden>
                {item.icon}
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
  );
}
