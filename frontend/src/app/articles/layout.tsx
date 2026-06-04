/**
 * Articles SECTION layout (server component) — static SEO metadata for /articles.
 *
 * Section-level shell for the public journal. It contributes only metadata
 * (title / description / canonical) for the /articles index; the deeper
 * /articles/[slug] reading pages are handled by their OWN layout's
 * generateMetadata, which overrides these values per article.
 *
 * Must stay a SERVER component (no 'use client') so `export const metadata` is
 * picked up by Next 16. Renders {children} verbatim and adds no DOM — the
 * visible chrome (navbar/footer) is composed inside each page via <Layout/>.
 *
 * `metadataBase` is inherited from the ROOT layout, so the relative
 * `alternates.canonical` below resolves to an absolute URL automatically.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Journal',
  description:
    'The Aryavartham journal — essays, build notes, and field reports from founders building startups in 180 days.',
  alternates: { canonical: '/articles' },
  openGraph: {
    title: 'Journal — Aryavartham',
    description:
      'Essays, build notes, and field reports from founders building startups in 180 days.',
    url: '/articles',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Journal — Aryavartham',
    description:
      'Essays, build notes, and field reports from founders building startups in 180 days.',
  },
};

export default function ArticlesSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
