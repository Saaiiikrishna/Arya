import type { Metadata } from 'next';
import AdminGuard from './AdminGuard';

/**
 * Admin subtree layout (SERVER component).
 *
 * Defence-in-depth `noindex, nofollow` for the entire /admin/* tree: robots.ts
 * disallows /admin at the robots.txt level, but a crawler that ignores robots.txt
 * (common for non-Google bots) could otherwise index any admin route reached via
 * the SSR HTML. Emitting `<meta name="robots" content="noindex, nofollow">` from
 * this server layout closes that gap at the per-page level. A `'use client'`
 * layout cannot export `metadata`, so the actual client-side auth guard lives in
 * the nested `<AdminGuard>` client component (unchanged behaviour).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminGuard>{children}</AdminGuard>;
}
