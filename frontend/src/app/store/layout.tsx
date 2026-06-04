/**
 * Store SECTION layout (server component) — static SEO metadata for /store.
 *
 * This is the section-level shell for the public catalog. It contributes only
 * metadata (title / description / canonical) for the /store index; the deeper
 * /store/[slug] product pages are handled by their OWN layout's
 * generateMetadata, which overrides these values per product.
 *
 * It must stay a SERVER component (no 'use client') so `export const metadata`
 * is picked up by Next 16's metadata system. It renders {children} verbatim and
 * adds no DOM — the visible chrome (navbar/footer) is composed inside each page
 * via <Layout/>, so wrapping it here would double-render the shell.
 *
 * `metadataBase` is inherited from the ROOT layout, so the relative
 * `alternates.canonical` below resolves to an absolute URL automatically.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Store',
  description:
    'Shop the Aryavartham store — products built by our founders, with build-it-yourself guides, transparent pricing, and verified-purchase reviews.',
  alternates: { canonical: '/store' },
  openGraph: {
    title: 'Store — Aryavartham',
    description:
      'Shop the Aryavartham store — products built by our founders, with build-it-yourself guides and transparent pricing.',
    url: '/store',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Store — Aryavartham',
    description:
      'Shop the Aryavartham store — products built by our founders, with build-it-yourself guides and transparent pricing.',
  },
};

export default function StoreSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
