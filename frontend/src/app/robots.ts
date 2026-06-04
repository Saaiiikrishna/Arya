/**
 * robots.txt generator (Next 16 metadata route convention — `app/robots.ts`
 * exporting a default function returning `MetadataRoute.Robots`).
 *
 * Policy:
 *   - Allow crawling of all public surfaces.
 *   - Disallow the authenticated / private areas: /admin (platform admin),
 *     /hub (cohort/founder workspace) and /account (store customer account).
 *   - Point crawlers at the dynamic sitemap (app/sitemap.ts) via an absolute URL.
 *
 * Base URL mirrors sitemap.ts: both import the shared `baseUrl()` from
 * `@/lib/siteUrl` (NEXT_PUBLIC_SITE_URL when set, else the production domain).
 * The Sitemap directive in robots.txt MUST be an absolute URL.
 */

import type { MetadataRoute } from 'next';
import { baseUrl } from '@/lib/siteUrl';

export default function robots(): MetadataRoute.Robots {
  const base = baseUrl();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/hub', '/account'],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
