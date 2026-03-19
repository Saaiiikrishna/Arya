'use client';

import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import AdminSidebar from '@/components/AdminSidebar';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/admin/login');
    }
  }, [loading, isAuthenticated, router]);

  if (loading) {
    return (
      <div className="loading-page">
        <div className="spinner" /> Loading...
      </div>
    );
  }

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
