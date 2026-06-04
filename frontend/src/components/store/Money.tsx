'use client';

import { cn } from '@/lib/cn';

/**
 * Render an integer-paise amount as Indian rupees.
 *
 * Money everywhere in this platform travels as INTEGER PAISE (₹1 = 100 paise) to
 * avoid floating-point drift. This component is the single place that converts to
 * a human rupee string, so formatting (₹ symbol, Indian grouping, decimals) stays
 * consistent across the store. Use it instead of dividing by 100 inline.
 */
export interface MoneyProps {
  /** Amount in integer paise. */
  paise: number | null | undefined;
  /** Show paise decimals even when the amount is a whole rupee. Default: true. */
  showDecimals?: boolean;
  /** Render the ₹ symbol. Default: true. */
  showSymbol?: boolean;
  className?: string;
}

const formatter = (decimals: boolean) =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: 2,
  });

export function formatPaise(
  paise: number | null | undefined,
  opts: { showDecimals?: boolean; showSymbol?: boolean } = {},
): string {
  const { showDecimals = true, showSymbol = true } = opts;
  const value = (paise ?? 0) / 100;
  const body = formatter(showDecimals).format(value);
  return showSymbol ? `₹${body}` : body;
}

export default function Money({
  paise,
  showDecimals = true,
  showSymbol = true,
  className,
}: MoneyProps) {
  return (
    <span className={cn('tabular-nums', className)}>
      {formatPaise(paise, { showDecimals, showSymbol })}
    </span>
  );
}
