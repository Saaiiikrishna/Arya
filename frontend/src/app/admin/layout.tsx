'use client';

import { useAuth } from '@/lib/auth';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import AdminSidebar from '@/components/AdminSidebar';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isLoginPage = pathname?.startsWith('/admin/login');

  useEffect(() => {
    if (!loading && !isAuthenticated && !isLoginPage) {
      router.push('/admin/login');
    }
  }, [loading, isAuthenticated, router, isLoginPage]);

  if (loading) {
    return (
      <div className="loading-page">
        <div className="spinner" /> Loading...
      </div>
    );
  }

  // If it's the login page, bypass layout rendering and auth checks
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Prevent unauthenticated users from seeing the protected layout
  if (!isAuthenticated) return null;

  return (
    <div style={{ display: 'flex' }}>
      <AdminSidebar />
      <main
        style={{
          marginLeft: 'var(--sidebar-width)',
          flex: 1,
          padding: 'var(--space-xl) var(--space-2xl)',
          minHeight: '100vh',
          maxWidth: 'calc(100vw - var(--sidebar-width))',
        }}
      >
        {children}
      </main>
    </div>
  );
}
