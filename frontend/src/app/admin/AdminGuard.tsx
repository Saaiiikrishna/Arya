'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'];

/**
 * Client-side guard for the entire /admin/* tree (defense-in-depth — the backend
 * already rejects unauthorized API calls, and `middleware.ts` server-redirects
 * non-admin requests before render, but this stops the admin UI from rendering
 * for applicants/anonymous users on the client too). The /admin/login page is
 * exempt so unauthenticated admins can sign in.
 *
 * Extracted out of `admin/layout.tsx` so that layout can be a SERVER component
 * exporting `metadata` (noindex/nofollow); a `'use client'` layout cannot export
 * a `metadata` object. The auth hook + redirect logic is unchanged.
 */
export default function AdminGuard({ children }: { children: React.ReactNode }) {
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
