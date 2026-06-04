/**
 * `GET /llms.txt` — the emerging "llms.txt" standard (https://llmstxt.org).
 *
 * A clean, Markdown-flavoured content map served as `text/plain` so LLM crawlers
 * (and answer engines that look for this file) get a curated, link-rich overview
 * of Aryavartham's PUBLIC content instead of having to infer structure from HTML.
 * It complements robots.txt (which grants AI crawlers access) and sitemap.xml
 * (the exhaustive URL list) by giving a human-and-machine-readable summary.
 *
 * Implemented as a Next 16 Route Handler (`app/llms.txt/route.ts` exporting GET)
 * rather than a static file so every link is built from `baseUrl()`
 * (NEXT_PUBLIC_SITE_URL → production fallback) and stays correct across
 * environments. Content is static text (no request-time data), so the response
 * is cacheable; we let Next cache it and add an explicit Cache-Control.
 */

import { baseUrl } from '@/lib/siteUrl';

// Static content — safe to cache aggressively at the edge and in the browser.
export const dynamic = 'force-static';

export function GET(): Response {
  const base = baseUrl();

  const body = `# Aryavartham

> Aryavartham is India's startup incubation platform — a structured 180-day programme that takes individuals with raw ideas to a fundable, operating company. It also runs a public storefront (Store) and an editorial journal (Articles).

## Key sections

- [Home](${base}/): Overview of Aryavartham, the incubation programme, and the platform.
- [Start Up programme](${base}/startup): The 180-day incubation journey — application, team formation, the MVP sprint, the investor pitch, and go-to-market support.
- [Store](${base}/store): The Aryavartham storefront — products built and sold through the platform. Browse the catalogue, view product details, and check availability.
- [Journal / Articles](${base}/articles): Long-form articles and editorial content on building startups, products, and the Aryavartham ecosystem.

## Discovery

- [Sitemap](${base}/sitemap.xml): Full machine-readable list of all public URLs (static pages, every active product, every published article), with last-modified dates and cover images.
- [RSS feed](${base}/feed.xml): RSS 2.0 feed of the latest published Journal articles.

## Notes

- Only public content is listed here. Authenticated areas (admin, the founder hub, customer accounts, the application flow, and the investor portal) are intentionally excluded and disallowed for crawlers.
- All prices in the Store are shown in Indian Rupees (INR).
`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
