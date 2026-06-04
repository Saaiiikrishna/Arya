'use client';

import Link from 'next/link';
import { Newspaper } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Public articles card — rounded glass `mkt-card` (DESIGN.md §7). Shows a cover
 * image, title, excerpt, optional author + publish date. Presentational + prop-
 * driven; the parent maps an article list item onto these props.
 */
export interface ArticleCardProps {
  title: string;
  /** Link target, e.g. `/articles/${slug}`. */
  href: string;
  excerpt?: string | null;
  /** Resolved cover image URL (CDN or presigned). */
  coverUrl?: string | null;
  /** ISO date string or Date — rendered as a readable date. */
  date?: string | Date | null;
  author?: string | null;
  tags?: string[];
  className?: string;
}

/** Returns both the human label and a machine-readable ISO string for <time>. */
function formatDate(
  date: string | Date | null | undefined,
): { label: string; iso: string } | null {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  return {
    label: d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
    iso: d.toISOString(),
  };
}

export default function ArticleCard({
  title,
  href,
  excerpt,
  coverUrl,
  date,
  author,
  tags,
  className,
}: ArticleCardProps) {
  const dateInfo = formatDate(date);

  return (
    <Link
      href={href}
      className={cn('mkt-card group flex flex-col overflow-hidden', className)}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-parchment-dark">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink/25">
            <Newspaper className="h-8 w-8" aria-hidden />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-5">
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-saffron-glow/30 px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.06em] text-saffron-deep"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <h3 className="font-serif text-lg leading-snug text-forest line-clamp-2">
          {title}
        </h3>

        {excerpt && (
          <p className="font-sans text-sm leading-relaxed text-ink/60 line-clamp-3">
            {excerpt}
          </p>
        )}

        {(author || dateInfo) && (
          <div className="mt-auto flex items-center gap-2 pt-3 font-sans text-[11px] uppercase tracking-[0.06em] text-ink/45">
            {author && <span>{author}</span>}
            {author && dateInfo && <span aria-hidden>·</span>}
            {dateInfo && <time dateTime={dateInfo.iso}>{dateInfo.label}</time>}
          </div>
        )}
      </div>
    </Link>
  );
}
