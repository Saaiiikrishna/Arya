'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'];

/**
 * Client-side guard for the entire /admin/* tree (defense-in-depth — the
 * backend already rejects unauthorized API calls, but this stops the admin UI
 * from rendering for applicants/anonymous users). The /admin/login page is
 * exempt so unauthenticated admins can sign in.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, role, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isLoginPage = pathname === '/admin/login';
  const allowed = isAuthenticated && ADMIN_ROLES.includes(role || '');

  useEffect(() => {
    if (loading || isLoginPage) return;
    if (!allowed) router.replace('/admin/login');
  }, [loading, isLoginPage, allowed, router]);

  if (isLoginPage) return <>{children}</>;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-parchment">
        <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!allowed) return null; // redirecting to /admin/login

  return <>{children}</>;
}
