/**
 * Edge middleware — crawler-isolation hardening for private surfaces.
 *
 * WHY THIS DOES NOT REDIRECT
 * --------------------------
 * The security review recommended a server-side middleware that reads the admin
 * JWT from an HttpOnly cookie and redirects non-admin requests to /admin/login
 * BEFORE the page renders. That is the right pattern in principle, but this app's
 * auth model stores the access token IN MEMORY and the refresh token in
 * `sessionStorage` (`arya_refresh`, sent in the request body to /api/admin/auth/
 * refresh — see `src/lib/api.ts`). There is NO role-bearing auth cookie for
 * middleware to read, so a redirect gate here would either be a no-op or lock
 * every admin out. Role-bearing page-level gating would require a dedicated
 * session cookie — a cross-cutting auth change out of scope for the SEO/metadata
 * layer. The client-side guard in `admin/AdminGuard`
 * (defense-in-depth) plus the backend `AdminGuard` on every `/api/admin/*`
 * controller (the real authorization gate) remain in force.
 *
 * WHAT THIS DOES DO (within scope, and effective without any auth state):
 * adds an `X-Robots-Tag: noindex, nofollow, noarchive` RESPONSE HEADER to every
 * private surface. This is network-level crawler isolation that complements both
 * robots.txt (which a non-Google bot may ignore) and the per-page `noindex`
 * <meta> (which only helps if the bot executes/parses the head): an HTTP response
 * header is honoured by Google, Bing, and most reputable crawlers even when they
 * do not parse the body, so admin/investor/account HTML reached via SSR is kept
 * out of every index. No request body is read and no auth decision is made.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Private / authenticated surfaces that must never be indexed. Mirrors the
// robots.ts DISALLOW intent at the response-header level.
const NOINDEX_PREFIXES = [
  '/admin',
  '/hub',
  '/account',
  '/apply',
  '/investor',
  '/investors',
  '/waiting',
];

export function middleware(req: NextRequest): NextResponse {
  const res = NextResponse.next();
  const path = req.nextUrl.pathname;
  if (NOINDEX_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  return res;
}

/**
 * Scope the middleware to the private prefixes only (skip Next internals + the
 * SEO routes). The matcher is a build-time constant; the runtime check above
 * still re-validates the exact prefix so deeper nested paths are covered.
 */
export const config = {
  matcher: [
    '/admin/:path*',
    '/hub/:path*',
    '/account/:path*',
    '/apply/:path*',
    '/investor/:path*',
    '/investors/:path*',
    '/waiting/:path*',
  ],
};
