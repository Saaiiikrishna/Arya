import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { StoreAuthProvider } from "@/lib/storeAuth";
import { StoreCartProvider } from "@/lib/storeCart";
import GoogleProvider from "@/components/GoogleAuthProvider";
import { SettingsProvider } from "@/lib/settings";
import TrackerInit from "@/components/TrackerInit";
import JsonLd from "@/components/store/JsonLd";
import { baseUrl } from "@/lib/siteUrl";

const SITE_NAME = "Aryavartham";
const SITE_DESCRIPTION =
  "Build a Startup in 180 Days. We don't invest in you — we build with you. A co-founder programme for the obsessive, the restless, and the relentlessly curious.";

// Server-side API base for the best-effort social-links fetch (Organization
// sameAs). Mirrors storeApi's default so it works in local dev too.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

/**
 * Root metadata. `metadataBase` (the canonical origin from NEXT_PUBLIC_SITE_URL,
 * via the shared `baseUrl()` helper) makes every RELATIVE canonical / OG url in
 * child layouts resolve to an absolute URL. The title `template` lets child
 * pages set just a short title (e.g. "Store") and have it rendered as
 * "Store — Aryavartham"; `default` is used by pages that set no title.
 */
export const metadata: Metadata = {
  metadataBase: new URL(baseUrl()),
  title: {
    default: `${SITE_NAME} — The Founder's Club`,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/logo-short.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.svg",
    apple: "/logo-short.svg",
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — The Founder's Club`,
    description: SITE_DESCRIPTION,
    url: "/",
    // RASTER share card (1200x630 PNG). OG/Twitter crawlers (Facebook, LinkedIn,
    // WhatsApp, X) do NOT render SVG share images — an SVG here yields a broken /
    // missing preview. The SVG logos remain as favicons/icons above; this PNG is
    // the unfurl image. Resolved absolute via `metadataBase`.
    images: [{ url: "/og-default.png", width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — The Founder's Club`,
    description: SITE_DESCRIPTION,
    images: ["/og-default.png"],
  },
};

/**
 * Allowlist of social-network hostnames permitted in the Organization `sameAs`
 * array. `sameAs` is an authoritative identity signal for search engines and LLMs,
 * so even an admin-controlled settings value must not be able to point it at an
 * arbitrary domain (a compromised/insider admin could otherwise launder a phishing
 * or reputation-farming site as an "official" Aryavartham profile). A candidate is
 * accepted only when its parsed hostname EQUALS one of these or is a subdomain of
 * one (e.g. `www.linkedin.com`). The same validation should also be enforced
 * server-side in the settings update endpoint as defence in depth.
 */
const SAMEAS_ALLOWED_HOSTS = [
  "twitter.com",
  "x.com",
  "linkedin.com",
  "instagram.com",
  "facebook.com",
  "youtube.com",
  "discord.com",
  "discord.gg",
  "github.com",
];

/** True when `url` is an https? URL whose host is on the social allowlist. */
function isAllowedSameAs(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return SAMEAS_ALLOWED_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/**
 * Best-effort server fetch of the public social links for the Organization
 * `sameAs` array. Never throws — any failure yields an empty list so the JSON-LD
 * is still emitted (just without sameAs). Keys mirror the admin Settings page
 * (`social_twitter`, `social_linkedin`, `social_instagram`, `discordUrl` /
 * `social_discord`). Each candidate is validated against the social-hostname
 * allowlist so an arbitrary admin-supplied URL can't be injected as an identity.
 */
async function fetchSameAs(): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/settings/public`, {
      // Settings change rarely; cache for a day so this isn't fetched per render.
      next: { revalidate: 86400 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, unknown>;
    const candidates = [
      data.social_twitter,
      data.social_linkedin,
      data.social_instagram,
      data.discordUrl,
      data.social_discord,
    ];
    return candidates.filter(
      (v): v is string =>
        typeof v === "string" && isAllowedSameAs(v.trim()),
    );
  } catch {
    return [];
  }
}

/**
 * Sitewide JSON-LD graph: an Organization (logo + sameAs social profiles) and a
 * WebSite carrying a SearchAction so search engines can surface a sitelinks
 * search box targeting /search?q={search_term_string}. Both objects are OUR OWN
 * typed data → safe to JSON.stringify and inject (see JsonLd component header).
 */
function buildSiteJsonLd(base: string, sameAs: string[]): Record<string, unknown> {
  const organization: Record<string, unknown> = {
    "@type": "Organization",
    "@id": `${base}/#organization`,
    name: SITE_NAME,
    url: `${base}/`,
    logo: `${base}/logo-full.svg`,
  };
  if (sameAs.length) organization.sameAs = sameAs;

  const website: Record<string, unknown> = {
    "@type": "WebSite",
    "@id": `${base}/#website`,
    name: SITE_NAME,
    url: `${base}/`,
    publisher: { "@id": `${base}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${base}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  return {
    "@context": "https://schema.org",
    "@graph": [organization, website],
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const base = baseUrl();
  const sameAs = await fetchSameAs();
  const siteJsonLd = buildSiteJsonLd(base, sameAs);

  return (
    <html lang="en">
      <head>
        {/* Sitewide structured data (Organization + WebSite SearchAction). Our
            own typed objects, JSON-stringified — safe (see JsonLd header). */}
        <JsonLd data={siteJsonLd} />
      </head>
      <body>
        <GoogleProvider>
          <AuthProvider>
            {/*
              StoreAuthProvider currently lives at the ROOT so the store customer
              identity is available on every store/article surface without per-route
              wiring. It is independent of the platform AuthProvider (it touches only
              storeApi / the store session hint), so the nesting order is purely so any
              future store code may also read useAuth(). Trade-off: it fires one silent
              customer refresh on cold load even on pure platform pages (/admin/*, /) —
              a no-op when the arya_store_has_session hint is absent. At larger scale this should be
              hoisted into a store-scoped layout (e.g. app/store/layout.tsx,
              app/articles/layout.tsx) so it never hydrates on non-store pages.
            */}
            <StoreAuthProvider>
              {/*
                StoreCartProvider is hoisted to the root so the global navbar
                (Layout.tsx) can render the cart badge + slide-over drawer on
                every public surface without per-route wiring. It is thin and
                hydration-safe: on cold load it fetches the cart ONLY when a guest
                cart token or customer session already exists, so it is a no-op on
                pure platform pages (/admin/*, /). Store pages that wrap their own
                <StoreCartProvider> (e.g. /cart) still work — the nested provider
                simply shadows this root one for its subtree.
              */}
              <StoreCartProvider>
                <SettingsProvider>
                  <TrackerInit />
                  {children}
                </SettingsProvider>
              </StoreCartProvider>
            </StoreAuthProvider>
          </AuthProvider>
        </GoogleProvider>
      </body>
    </html>
  );
}
