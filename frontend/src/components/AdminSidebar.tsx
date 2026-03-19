'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import styles from './AdminSidebar.module.css';

const navItems = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/admin/questions', label: 'Questions', icon: '❓' },
  { href: '/admin/eligibility', label: 'Eligibility', icon: '✅' },
  { href: '/admin/batches', label: 'Batches', icon: '📦' },
  { href: '/admin/users', label: 'Users', icon: '👥' },
  { href: '/admin/consent', label: 'Consent', icon: '📝' },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const { admin, logout } = useAuth();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}>⬡</span>
        <span className={styles.logoText}>ARYA</span>
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

      <div className={styles.footer}>
        <div className={styles.adminInfo}>
          <div className={styles.avatar}>
            {admin?.firstName?.charAt(0)}{admin?.lastName?.charAt(0)}
          </div>
          <div className={styles.adminDetails}>
            <span className={styles.adminName}>
              {admin?.firstName} {admin?.lastName}
            </span>
            <span className={styles.adminRole}>{admin?.role}</span>
          </div>
        </div>
        <button className={styles.logoutBtn} onClick={logout}>
          ↪
        </button>
      </div>
    </aside>
  );
}
