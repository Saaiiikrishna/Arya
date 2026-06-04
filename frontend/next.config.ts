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
  const seen = new Set(patterns.map((p) => `${p.protocol}//${p.hostname}`));
  for (const raw of [process.env.NEXT_PUBLIC_MEDIA_BASE, process.env.NEXT_PUBLIC_API_URL]) {
    if (!raw || !raw.trim()) continue;
    try {
      const u = new URL(raw.trim());
      const protocol = u.protocol.replace(":", "");
      if (protocol !== "http" && protocol !== "https") continue;
      const key = `${protocol}//${u.hostname}`;
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
 * 7 days; override with NEXT_PUBLIC_IMAGE_CACHE_TTL where a different policy is
 * needed (bad/zero values fall back to the 7-day default).
 */
function imageCacheTtl(): number {
  const raw = Number(process.env.NEXT_PUBLIC_IMAGE_CACHE_TTL);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 604800; // 7 days
}

/**
 * Security headers applied to EVERY route by Next.js (the frontend serves the HTML
 * + static assets; the backend Helmet config only covers API responses). These are
 * defence-in-depth: a second layer behind the app's own escaping/sanitisation.
 *
 * COOP is deliberately NOT set in this baseline: the default
 * (`same-origin-allow-popups`) is the safer choice site-wide. The previous config
 * applied `Cross-Origin-Opener-Policy: unsafe-none` to EVERY route; it is now
 * scoped to ONLY the routes that mount Google One-Tap — `/login` and `/apply`
 * (both render <GlobalOneTap/>, which uses the legacy non-FedCM prompt that needs
 * `window.opener` access) — rather than weakening isolation across the whole site.
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
      // Baseline security headers on all routes.
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      // COOP relaxation scoped to the One-Tap routes only (window.opener access
      // for the legacy non-FedCM Google prompt rendered by <GlobalOneTap/>).
      // Everywhere else the Next.js default (same-origin-allow-popups) applies.
      {
        source: "/login",
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "unsafe-none" }],
      },
      {
        source: "/apply",
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "unsafe-none" }],
      },
    ];
  },
};

export default nextConfig;
