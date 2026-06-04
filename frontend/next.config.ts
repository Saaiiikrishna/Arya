import type { NextConfig } from "next";

/**
 * Allow-list of remote hosts that next/image may optimize, for the public
 * storefront/journal (product + article media).
 *
 * Sources, in order of how media URLs are actually produced:
 *   1. The S3 bucket that backs all uploads — `arya-documents` in `ap-south-1`
 *      (root CLAUDE.md "Infra Constraints"). `resolveMediaUrl()` (src/lib/mediaUrl.ts)
 *      prefixes bare S3 keys with this virtual-hosted origin when no CDN is set,
 *      so presigned/public S3 object URLs come from here.
 *   2. An optional CDN/CloudFront origin set via NEXT_PUBLIC_MEDIA_BASE — when
 *      present, resolveMediaUrl() emits URLs on THAT host instead, so it must be
 *      allow-listed too. Parsed defensively (bad value → skipped).
 *   3. The API host from NEXT_PUBLIC_API_URL — some media may be proxied through
 *      the backend rather than served straight from S3. Included so those load.
 *   4. localhost (http/https, any port) for local dev, where the API and any
 *      presign emulation run on 127.0.0.1.
 *
 * Unmatched hosts are NOT a hard failure: the swapped components fall back to a
 * plain <img>/placeholder, so an un-listed host degrades gracefully rather than
 * breaking the page. Keep this list in sync with src/lib/mediaUrl.ts.
 */
function buildRemotePatterns(): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> {
  type Pattern = NonNullable<
    NonNullable<NextConfig["images"]>["remotePatterns"]
  >[number];
  const patterns: Pattern[] = [
    // 1. Project S3 bucket (virtual-hosted style) — the resolveMediaUrl fallback origin.
    {
      protocol: "https",
      hostname: "arya-documents.s3.ap-south-1.amazonaws.com",
      pathname: "/**",
    },
    // …and the path-style / regional S3 endpoint, in case a presigned URL uses it.
    {
      protocol: "https",
      hostname: "s3.ap-south-1.amazonaws.com",
      pathname: "/arya-documents/**",
    },
    // 4. Local dev (any port) — both loopback hosts over http AND https, so a
    //    self-signed TLS proxy (e.g. mkcert on 443) is also optimized.
    { protocol: "http", hostname: "localhost", pathname: "/**" },
    { protocol: "https", hostname: "localhost", pathname: "/**" },
    { protocol: "http", hostname: "127.0.0.1", pathname: "/**" },
    { protocol: "https", hostname: "127.0.0.1", pathname: "/**" },
  ];

  // 2 + 3. Derive hostnames from the configured CDN + API URLs (build-time only).
  // Dedup key is `scheme://host[:port]` (a real origin) — note the colon after the
  // scheme. The static patterns above carry no port, so seed their key the same way
  // a URL.origin would serialise (`protocol:` + `//` + hostname).
  const seen = new Set(patterns.map((p) => `${p.protocol}://${p.hostname}`));
  for (const raw of [process.env.NEXT_PUBLIC_MEDIA_BASE, process.env.NEXT_PUBLIC_API_URL]) {
    if (!raw || !raw.trim()) continue;
    try {
      const u = new URL(raw.trim());
      const protocol = u.protocol.replace(":", "");
      if (protocol !== "http" && protocol !== "https") continue;
      // Use the parsed origin (scheme://host[:port]) as the dedup key so it is a
      // well-formed origin string rather than the misleading `https//host` form.
      const key = u.origin;
      if (seen.has(key)) continue;
      seen.add(key);
      patterns.push({
        protocol: protocol as "http" | "https",
        hostname: u.hostname,
        pathname: "/**",
      });
    } catch {
      // Malformed URL in env → skip; the static patterns above still apply.
    }
  }

  return patterns;
}

/**
 * How long (seconds) the image optimizer caches an optimized variant before it
 * re-fetches + re-optimizes the source. The Next.js default of 60s is far too low
 * for a storefront whose product/article images change infrequently — at 60s the
 * optimizer runs on nearly every request, inflating compute + latency. Default to
 * 7 days; override with IMAGE_CACHE_TTL where a different policy is needed
 * (bad/zero values fall back to the 7-day default).
 *
 * This is read ONLY here, by the Node.js build/server process — it is never needed
 * in the browser bundle, so it deliberately has NO `NEXT_PUBLIC_` prefix (which
 * would inline the value into client-side JS and expose a build-time tuning knob).
 */
function imageCacheTtl(): number {
  const raw = Number(process.env.IMAGE_CACHE_TTL);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 604800; // 7 days
}

/**
 * Security headers applied to EVERY route by Next.js (the frontend serves the HTML
 * + static assets; the backend Helmet config only covers API responses). These are
 * defence-in-depth: a second layer behind the app's own escaping/sanitisation.
 *
 * Cross-Origin-Opener-Policy is set EXPLICITLY to `same-origin` site-wide rather
 * than left to the platform default. Relying on the default left COOP effectively
 * `unsafe-none` on most routes (the absence of the header means no opener
 * isolation), so a cross-origin opener could keep a `window` reference into our
 * pages. `same-origin` severs any cross-origin opener/openee relationship,
 * isolating the browsing-context group. We can use the strict `same-origin` (not
 * `same-origin-allow-popups`) because no OAuth flow here relies on a popup:
 * Discord auth uses a full-page redirect. The ONLY exception is the legacy Google
 * One-Tap prompt (`/login`, `/apply`), which still needs `window.opener` access —
 * those two routes override this baseline to `unsafe-none` below.
 *
 * A Content-Security-Policy is intentionally omitted for now: the inline JSON-LD
 * (<script type="application/ld+json">) needs a nonce strategy before a strict CSP
 * can be enforced without breaking structured data. Tracked as a follow-up.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

// The two routes that mount the legacy Google One-Tap prompt (<GlobalOneTap/>),
// which needs `window.opener` access and therefore MUST relax COOP to `unsafe-none`.
const ONE_TAP_ROUTES = ["/login", "/apply"] as const;

const nextConfig: NextConfig = {
  output: "standalone",
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    minimumCacheTTL: imageCacheTtl(),
    remotePatterns: buildRemotePatterns(),
  },
  async headers() {
    return [
      // Baseline security headers on all routes (COOP handled separately below so
      // the One-Tap routes can override it without emitting a duplicate header).
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      // Site-wide opener isolation. Applied to EVERY route EXCEPT the One-Tap
      // routes via a negative-lookahead matcher, so those routes receive only the
      // `unsafe-none` value below (Next.js does NOT dedupe across matching source
      // blocks — emitting `same-origin` here AND `unsafe-none` there would send two
      // conflicting Cross-Origin-Opener-Policy headers, which browsers reject). The
      // lookahead is anchored to a full path segment (`(?:/|$)`) so only the exact
      // `/login` / `/apply` routes are excluded — sibling paths like `/applications`
      // still receive the strict baseline.
      {
        source: `/((?!(?:${ONE_TAP_ROUTES.map((r) => r.slice(1)).join("|")})(?:/|$)).*)`,
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin" }],
      },
      // COOP relaxation scoped to the One-Tap routes only (window.opener access
      // for the legacy non-FedCM Google prompt rendered by <GlobalOneTap/>).
      ...ONE_TAP_ROUTES.map((source) => ({
        source,
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "unsafe-none" }],
      })),
    ];
  },
};

export default nextConfig;
