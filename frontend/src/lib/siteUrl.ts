/**
 * Single source of truth for the public site origin used by SEO metadata routes
 * (app/sitemap.ts, app/robots.ts) and anywhere else that must emit ABSOLUTE URLs.
 *
 * Resolution: NEXT_PUBLIC_SITE_URL when set (non-empty after trim) AND it passes
 * origin validation, else the production domain. A trailing slash is stripped so
 * callers can safely append a path beginning with `/` without producing a double
 * slash.
 *
 * This was extracted from a verbatim copy-paste that previously lived in both
 * sitemap.ts and robots.ts — change the production domain or the fallback logic
 * here, in ONE place, and both consumers stay in sync.
 *
 * Security (SSRF / cache-poisoning hardening): the returned origin is injected
 * verbatim into crawler-facing surfaces — the robots.txt `Sitemap:`/`Host:`
 * directives, every sitemap `<loc>`, the llms.txt links, and the RSS channel
 * links. A misconfigured or attacker-controlled NEXT_PUBLIC_SITE_URL pointing at
 * a foreign origin would let those surfaces redirect crawlers to that origin
 * (search-engine cache poisoning / phishing). We therefore ACCEPT the env value
 * only when it is a syntactically valid `https://` URL, or an `http://localhost`
 * / `http://127.0.0.1` URL (local dev). Anything else (other schemes, non-local
 * plain http, garbage) falls back to the trusted production domain.
 */

/** The production fallback origin, used when NEXT_PUBLIC_SITE_URL is unset/invalid. */
export const PRODUCTION_SITE_URL = 'https://aryavartham.com';

/**
 * Validate a candidate origin string. Accepts only:
 *   - any `https://` origin, or
 *   - `http://localhost` / `http://127.0.0.1` (local development).
 * Returns the parsed origin (no trailing slash) on success, else null.
 */
function validatedOrigin(candidate: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    // Not a syntactically valid URL at all → reject.
    return null;
  }
  // Must carry an actual host. `new URL('https:///x')` parses with an empty
  // hostname; such a value is not a usable absolute origin, so reject it.
  if (!parsed.hostname) return null;
  const isHttps = parsed.protocol === 'https:';
  const isLocalHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  // Only http(s) is acceptable; any other scheme (ftp:, javascript:, data:, …) is
  // rejected, and plain http is allowed ONLY for the local-dev loopback hosts.
  if (!isHttps && !isLocalHttp) return null;
  // `URL.origin` is `null`/`'null'` for opaque origins (e.g. non-special schemes);
  // we have already constrained to http(s) above, so origin is a real serialised
  // value here. Guard anyway so a stringy 'null' never leaks downstream.
  if (!parsed.origin || parsed.origin === 'null') return null;
  // Re-serialise from the parsed URL so only scheme://host[:port] survives and a
  // trailing slash never leaks through (URL.origin has no trailing slash).
  return parsed.origin;
}

/**
 * The absolute public origin (no trailing slash), e.g. `https://aryavartham.com`.
 * Prefer this over reading the env var directly so the fallback + normalisation
 * (and the SSRF/cache-poisoning validation above) stay consistent across every
 * SEO surface.
 */
export function baseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw && raw.length > 0) {
    const validated = validatedOrigin(raw);
    if (validated) return validated;
  }
  return PRODUCTION_SITE_URL;
}
