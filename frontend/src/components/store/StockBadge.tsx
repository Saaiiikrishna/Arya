'use client';

import { cn } from '@/lib/cn';

/**
 * Inline stock indicator derived from an available quantity.
 *
 *   qty <= 0            → "Out of stock"  (terracotta)
 *   0 < qty <= lowAt    → "Low stock"     (marigold/warning)
 *   qty > lowAt         → "In stock"      (success)
 *
 * `qty` is the available-to-sell count (on-hand minus reserved) the catalog /
 * availability endpoints return. Presentational only — no fetching.
 *
 * NOTE: available qty can briefly go negative during a stock race (reserved >
 * on-hand). Any `qty <= 0` is intentionally treated as 'Out of stock' and the
 * numeric count is hidden, so a negative number is never surfaced to the customer.
 */
export interface StockBadgeProps {
  /** Available quantity. null/undefined is treated as unknown → no badge. */
  qty: number | null | undefined;
  /** At-or-below this count renders "Low stock". Default: 5. */
  lowAt?: number;
  /** Show the numeric count alongside the label. Default: false. */
  showCount?: boolean;
  /** Use the rounded marketing pill look (for public surfaces). Default: false. */
  mkt?: boolean;
  className?: string;
}

type Status = 'in' | 'low' | 'out';

function statusOf(qty: number, lowAt: number): Status {
  if (qty <= 0) return 'out';
  if (qty <= lowAt) return 'low';
  return 'in';
}

const LABEL: Record<Status, string> = {
  in: 'In stock',
  low: 'Low stock',
  out: 'Out of stock',
};

// Matte (admin / strict) colour map.
const MATTE: Record<Status, string> = {
  in: 'text-success border-success/40 bg-success/5',
  low: 'text-warning border-warning/40 bg-warning/5',
  out: 'text-terracotta border-terracotta/40 bg-terracotta/5',
};

// Dot colour for the rounded marketing variant.
const DOT: Record<Status, string> = {
  in: 'bg-success',
  low: 'bg-marigold',
  out: 'bg-terracotta',
};

export default function StockBadge({
  qty,
  lowAt = 5,
  showCount = false,
  mkt = false,
  className,
}: StockBadgeProps) {
  if (qty === null || qty === undefined) return null;
  const status = statusOf(qty, lowAt);
  const label = LABEL[status];

  if (mkt) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-sans font-semibold uppercase tracking-[0.08em] text-ink/70 backdrop-blur',
          className,
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', DOT[status])} aria-hidden />
        {label}
        {showCount && status !== 'out' ? ` · ${qty}` : ''}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border px-2 py-0.5 text-[10px] font-sans font-semibold uppercase tracking-[0.05em]',
        MATTE[status],
        className,
      )}
    >
      {label}
      {showCount && status !== 'out' ? ` · ${qty}` : ''}
    </span>
  );
}
