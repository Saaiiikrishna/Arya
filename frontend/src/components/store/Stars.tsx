'use client';

import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Small reusable star-rating DISPLAY (read-only).
 *
 * Renders 5 stars with a fractional fill clamped to the [0, max] range, using a
 * width-clipped overlay so a value like 4.3 shows partial fill on the 5th star.
 * Public marketing surfaces (PDP, ProductCard) use the saffron accent; pass a
 * different `className` for other contexts. For an INTERACTIVE 1..5 picker use
 * <StarInput/> below.
 */
export interface StarsProps {
  /** Rating value (may be fractional, e.g. 4.3). */
  value: number;
  /** Number of stars in the scale. Default 5. */
  max?: number;
  /** Tailwind size classes for each star icon. Default 'h-4 w-4'. */
  size?: string;
  /** Optional count to render after the stars, e.g. "(128)". */
  count?: number | null;
  /** Optional accessible label override; defaults to "X out of MAX stars". */
  label?: string;
  className?: string;
}

export default function Stars({
  value,
  max = 5,
  size = 'h-4 w-4',
  count,
  label,
  className,
}: StarsProps) {
  const clamped = Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
  const pct = (clamped / max) * 100;
  const a11y =
    label ?? `${clamped.toFixed(1)} out of ${max} stars`;

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} role="img" aria-label={a11y}>
      <span className="relative inline-flex" aria-hidden>
        {/* Empty (outline) track */}
        <span className="inline-flex">
          {Array.from({ length: max }).map((_, i) => (
            <Star key={`bg-${i}`} className={cn(size, 'text-saffron/30')} />
          ))}
        </span>
        {/* Filled overlay clipped to the rating percentage */}
        <span
          className="absolute inset-0 inline-flex overflow-hidden"
          style={{ width: `${pct}%` }}
        >
          {Array.from({ length: max }).map((_, i) => (
            <Star key={`fg-${i}`} className={cn(size, 'shrink-0 fill-saffron text-saffron')} />
          ))}
        </span>
      </span>
      {count != null && (
        <span className="font-sans text-xs text-ink/55 tabular-nums">({count})</span>
      )}
    </span>
  );
}

/**
 * Interactive 1..max star INPUT (hover + click). Controlled via `value` /
 * `onChange`. Used by the "Write a review" form on the PDP.
 */
export interface StarInputProps {
  value: number;
  onChange: (rating: number) => void;
  max?: number;
  /** Tailwind size classes for each star button icon. Default 'h-7 w-7'. */
  size?: string;
  disabled?: boolean;
  className?: string;
}

export function StarInput({
  value,
  onChange,
  max = 5,
  size = 'h-7 w-7',
  disabled = false,
  className,
}: StarInputProps) {
  return (
    <div className={cn('inline-flex items-center gap-1', className)} role="radiogroup" aria-label="Your rating">
      {Array.from({ length: max }).map((_, i) => {
        const n = i + 1;
        const active = n <= value;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            className={cn(
              'transition-transform',
              !disabled && 'hover:scale-110 cursor-pointer',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <Star
              className={cn(
                size,
                active ? 'fill-saffron text-saffron' : 'text-saffron/35',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
