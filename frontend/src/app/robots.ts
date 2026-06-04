/**
 * robots.txt generator (Next 16 metadata route convention — `app/robots.ts`
 * exporting a default function returning `MetadataRoute.Robots`).
 *
 * Policy:
 *   - EXPLICITLY ALLOW the major AI / LLM crawlers (GPTBot, ChatGPT-User,
 *     OAI-SearchBot, ClaudeBot, anthropic-ai, Claude-Web, PerplexityBot,
 *     Google-Extended, Applebot-Extended, CCBot) plus the catch-all `*` for
 *     normal search crawlers — all to the public surfaces. Calling them out by
 *     name (rather than relying on `*`) is the standard, unambiguous way to
 *     opt IN to AI training / answer-engine indexing: several of these agents
 *     check for a directive that names them specifically.
 *   - DISALLOW the authenticated / private areas for EVERY agent: /admin
 *     (platform admin), /hub (cohort/founder workspace), /account (store
 *     customer account), /apply (application flow), /investor + /investors
 *     (investor portal — both the singular and the canonical plural `/investors/*`
 *     route, e.g. /investors/register, listed explicitly rather than relying on
 *     prefix matching), /auth (auth callbacks / token exchange). The same
 *     disallow set is applied to each named agent and to `*` so a named AI
 *     crawler can't bypass it.
 *   - Point crawlers at the dynamic sitemap (app/sitemap.ts) via an absolute URL.
 *   - Declare `host` (the canonical HOSTNAME, no scheme) so crawlers that honour
 *     it (Yandex) pick the preferred host. The Yandex spec expects a bare
 *     hostname (`aryavartham.com`), not a full origin, so we strip the protocol.
 *
 * Base URL mirrors sitemap.ts: both import the shared `baseUrl()` from
 * `@/lib/siteUrl` (NEXT_PUBLIC_SITE_URL when set, else the production domain).
 * The Sitemap directive in robots.txt MUST be an absolute URL.
 */

import type { MetadataRoute } from 'next';
import { baseUrl } from '@/lib/siteUrl';

// Private / transient surfaces kept out of every crawler's index. Applied
// identically to the catch-all and to each explicitly-named AI agent so none can
// bypass it. Both `/investor` (legacy singular) and `/investors` (the actual
// route) are listed; `/waiting` (Stage-0 decision-pending) and `/login` (the
// auth entry form) carry no indexable value and are excluded to cut crawler
// noise. NOTE: public, indexable pages (`/pledge`, `/privacy`, `/terms`) are
// deliberately NOT here — they appear in the sitemap and should be crawled.
const DISALLOW = [
  '/admin',
  '/hub',
  '/account',
  '/apply',
  '/investor',
  '/investors',
  '/auth',
  '/login',
  '/waiting',
];

// AI / answer-engine crawlers we explicitly opt IN to the public content.
const AI_AGENTS = [
  'GPTBot', // OpenAI training crawler
  'ChatGPT-User', // OpenAI on-demand fetch (user-triggered browsing)
  'OAI-SearchBot', // OpenAI search index
  'ClaudeBot', // Anthropic crawler
  'anthropic-ai', // Anthropic (legacy token)
  'Claude-Web', // Anthropic on-demand fetch
  'PerplexityBot', // Perplexity answer engine
  'Google-Extended', // Gemini / Vertex AI training opt-in
  'Applebot-Extended', // Apple Intelligence training opt-in
  'CCBot', // Common Crawl (feeds many LLM corpora)
];

export default function robots(): MetadataRoute.Robots {
  const base = baseUrl();
  return {
    rules: [
      // Catch-all for ordinary search crawlers.
      { userAgent: '*', allow: '/', disallow: DISALLOW },
      // Each AI agent named explicitly — same allow/disallow policy.
      ...AI_AGENTS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: DISALLOW,
      })),
    ],
    sitemap: `${base}/sitemap.xml`,
    // Yandex's `Host:` directive expects a bare hostname (no scheme); strip it.
    host: base.replace(/^https?:\/\//, ''),
  };
}
