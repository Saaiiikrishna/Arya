/**
 * Product DETAIL layout (server component) — per-product SEO metadata.
 *
 * Next 16 calls `generateMetadata` on the SERVER for /store/[slug] and emits the
 * resulting tags into the initial HTML <head> — so crawlers and link unfurlers
 * (Slack, WhatsApp, X, etc.) see real per-product title/description/OG/Twitter
 * tags WITHOUT us touching the client page body (page.tsx stays a client
 * component that fetches its own data for the interactive UI).
 *
 * Data: a direct server-side `fetch` to the public catalog endpoint
 * (`GET {NEXT_PUBLIC_API_URL}/store/products/:slug`, the same shape storeApi
 * returns). We do NOT import the storeApi client here — it is a stateful browser
 * client (token slots, sessionStorage). A bare server fetch is the correct tool.
 *
 * Resilience: any failure (API down at build time, 404, bad shape, timeout)
 * falls back to a SANE generic product title rather than throwing — a metadata
 * error must never break the page render. `revalidate` lets the metadata refresh
 * periodically without a redeploy.
 *
 * `metadataBase` (root layout) makes the relative canonical/og url absolute.
 */

import type { Metadata } from 'next';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { str, fetchPublicJson } from '@/lib/serverMetaUtil';

// Catalog metadata is cacheable and changes infrequently — revalidate hourly so
// edited titles/descriptions propagate without a redeploy, while keeping the
// server fetch off the hot path on every crawl.
export const revalidate = 3600;

/** Best-effort server fetch of a single product by slug; null on any failure. */
async function fetchProduct(
  slug: string,
): Promise<Record<string, unknown> | null> {
  // Shared bare server fetch (ties to this route's ISR window); never throws.
  return fetchPublicJson(
    `/store/products/${encodeURIComponent(slug)}`,
    revalidate,
  );
}

/**
 * Resolve a usable OG image URL from a product payload:
 *   1. an explicit primary image url, else
 *   2. the first media row carrying a url / s3Key.
 * Returns an absolute (CDN/S3-resolved) URL or null.
 */
function coverImageOf(product: Record<string, unknown>): string | null {
  const primary = resolveMediaUrl(
    (str(product.primaryImageUrl) ?? undefined) as string | undefined,
  );
  if (primary) return primary;

  const thumb = product.thumbnail;
  if (thumb && typeof thumb === 'object') {
    const t = resolveMediaUrl(
      str((thumb as Record<string, unknown>).url) ?? undefined,
    );
    if (t) return t;
  }

  const media = Array.isArray(product.media) ? product.media : [];
  for (const row of media) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const url = resolveMediaUrl(
      (str(r.url) ?? str(r.s3Key)) ?? undefined,
    );
    if (url) return url;
  }
  return null;
}

export async function generateMetadata({
  params,
}: {
  // Next 16: route params are async and MUST be awaited.
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);

  const canonicalPath = `/store/${encodeURI(slug)}`;

  // Graceful fallback when the product can't be fetched (build-time, 404, etc.).
  if (!product) {
    return {
      title: 'Product',
      description: 'Explore products on the Aryavartham store.',
      alternates: { canonical: canonicalPath },
    };
  }

  const name = str(product.name) ?? 'Product';
  const description =
    str(product.shortDescription) ??
    str(product.subtitle) ??
    str(product.description) ??
    `Buy ${name} on the Aryavartham store.`;
  const cover = coverImageOf(product);
  const images = cover ? [{ url: cover, alt: name }] : undefined;

  return {
    title: name,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: name,
      description,
      url: canonicalPath,
      // `website` is the SAFE og:type, and it is the only value the Next.js
      // `Metadata.openGraph.type` union accepts here (the OG `product` type is NOT
      // in that union). `product` is also not a first-class type rendered natively
      // by the major unfurlers (Facebook, Slack, X, WhatsApp) and would need extra
      // og:product:* properties to be useful. Rich PRODUCT semantics for crawlers
      // (price, availability, AggregateRating) are emitted separately as Product
      // JSON-LD on the page body, so nothing is forfeited by using `website` here.
      type: 'website',
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: name,
      description,
      images: cover ? [cover] : undefined,
    },
  };
}

export default function ProductDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
