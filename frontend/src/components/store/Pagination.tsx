'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface PaginationProps {
  /** 1-based current page. */
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Rounded marketing styling. Default: false (strict/matte). */
  mkt?: boolean;
  /** Max number of numbered buttons to render (excluding ends). Default: 5. */
  siblingCount?: number;
  className?: string;
}

/**
 * Build the page list with ellipses, e.g. [1, '…', 4, 5, 6, '…', 20].
 * Always shows the first and last page; `window` numbered pages around current.
 */
function buildPages(page: number, total: number, windowSize: number): (number | '…')[] {
  if (total <= windowSize + 2) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const half = Math.floor(windowSize / 2);
  let start = Math.max(2, page - half);
  let end = Math.min(total - 1, page + half);

  // Keep the window a constant size near the edges.
  if (page - half < 2) end = Math.min(total - 1, 1 + windowSize);
  if (page + half > total - 1) start = Math.max(2, total - windowSize);

  const pages: (number | '…')[] = [1];
  if (start > 2) pages.push('…');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('…');
  pages.push(total);
  return pages;
}

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  mkt = false,
  siblingCount = 5,
  className,
}: PaginationProps) {
  if (!totalPages || totalPages <= 1) return null;

  const pages = buildPages(page, totalPages, siblingCount);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const navBtn = (active: boolean, disabled: boolean) =>
    cn(
      'inline-flex h-9 min-w-9 items-center justify-center px-3 font-sans text-xs font-semibold transition-colors',
      mkt ? 'rounded-full' : 'border',
      disabled && 'cursor-not-allowed opacity-35',
      active
        ? mkt
          ? 'bg-forest text-parchment'
          : 'border-forest bg-forest text-parchment'
        : mkt
          ? 'bg-white/60 text-ink/70 backdrop-blur hover:text-saffron-deep'
          : 'border-hairline text-ink/70 hover:border-forest hover:text-forest',
    );

  return (
    <nav
      className={cn('flex items-center justify-center gap-1.5', className)}
      aria-label="Pagination"
    >
      <button
        type="button"
        className={navBtn(false, !canPrev)}
        disabled={!canPrev}
        onClick={() => canPrev && onPageChange(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {pages.map((p, i) =>
        p === '…' ? (
          <span
            key={`ellipsis-${i}`}
            className="px-1 font-sans text-xs text-ink/40 select-none"
            aria-hidden
          >
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={navBtn(p === page, false)}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        className={navBtn(false, !canNext)}
        disabled={!canNext}
        onClick={() => canNext && onPageChange(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}
