'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';
import styles from './AdminSidebar.module.css';

const navItems = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/admin/questions', label: 'Questions', icon: '❓' },
  { href: '/admin/eligibility', label: 'Eligibility', icon: '✅' },
  { href: '/admin/batches', label: 'Batches', icon: '📦' },
  { href: '/admin/users', label: 'Users', icon: '👥' },
  { href: '/admin/consent', label: 'Consent', icon: '📝' },
  { href: '/admin/settings', label: 'Settings', icon: '⚙️' },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const { admin, logout } = useAuth();
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
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.navItem} ${
              pathname?.startsWith(item.href) ? styles.active : ''
            }`}
          >
            <span className={styles.navIcon}>{item.icon}</span>
            <span className={styles.navLabel}>{item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-hairline flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className={styles.avatar}>
            {admin?.firstName?.charAt(0) || 'A'}{admin?.lastName?.charAt(0) || 'D'}
          </div>
          <div className={styles.adminDetails}>
            <span className={styles.adminName}>
              {admin?.firstName || 'Admin'} {admin?.lastName || 'User'}
            </span>
            <span className={styles.adminRole}>{admin?.role || 'Administrator'}</span>
          </div>
        </div>
        <button 
          className="w-full flex items-center justify-center gap-3 py-2 border border-terracotta/20 text-terracotta hover:bg-terracotta/10 transition-colors cursor-pointer group rounded"
          onClick={logout}
          title="Sign Out"
        >
          <span className="font-sans text-[10px] uppercase tracking-widest font-bold group-hover:tracking-[0.25em] transition-all">End Session</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
        </button>
      </div>
    </aside>
  );
}
