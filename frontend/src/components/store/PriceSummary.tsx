'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import Money from './Money';

/**
 * Order / cart price breakdown. All values are integer paise. Mirrors the cart
 * totals contract: subtotal, coupon discount, (optional shipping), tax, grand
 * total. Presentational + prop-driven; the parent supplies server-computed paise.
 *
 * Tax is shown as a single GST line by default (the store computes a single tax
 * figure server-side); pass `taxLabel` to relabel (e.g. "GST (18%)").
 */
export interface PriceSummaryProps {
  /** Σ line subtotals, integer paise. */
  subtotal: number;
  /** Coupon discount, integer paise (positive number; shown as −). */
  discount?: number;
  /** Coupon code, shown next to the discount line. */
  couponCode?: string | null;
  /** Shipping charge, integer paise. Omit to hide; 0 → "Free". */
  shipping?: number | null;
  /** Tax amount, integer paise. */
  tax?: number;
  taxLabel?: string;
  /** Grand total, integer paise. */
  total: number;
  /** Slot below the total (e.g. a checkout button). */
  children?: ReactNode;
  /** Rounded marketing styling. Default: false (strict/matte). */
  mkt?: boolean;
  className?: string;
}

function Row({
  label,
  children,
  emphasis,
  accent,
}: {
  label: ReactNode;
  children: ReactNode;
  emphasis?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span
        className={cn(
          'font-sans',
          emphasis
            ? 'text-sm font-bold uppercase tracking-[0.05em] text-forest'
            : 'text-[13px] text-ink/60',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'font-sans tabular-nums',
          emphasis ? 'text-base font-bold text-forest' : 'text-sm text-ink',
          accent && 'text-success',
        )}
      >
        {children}
      </span>
    </div>
  );
}

export default function PriceSummary({
  subtotal,
  discount = 0,
  couponCode,
  shipping,
  tax = 0,
  taxLabel = 'GST',
  total,
  children,
  mkt = false,
  className,
}: PriceSummaryProps) {
  return (
    <div
      className={cn(
        mkt
          ? 'mkt-card p-6'
          : 'border border-hairline bg-alabaster p-6',
        className,
      )}
    >
      <Row label="Subtotal">
        <Money paise={subtotal} />
      </Row>

      {/*
        Show the coupon row whenever a discount applies OR a coupon code is set —
        so a code that maps to a non-monetary benefit (e.g. free shipping, where
        `discount === 0`) is still visibly acknowledged to the customer.
      */}
      {(discount > 0 || couponCode) && (
        <Row
          label={couponCode ? `Discount (${couponCode})` : 'Discount'}
          accent
        >
          {discount > 0 ? (
            <>
              −<Money paise={discount} />
            </>
          ) : (
            <span className="text-success">Applied</span>
          )}
        </Row>
      )}

      {shipping !== undefined && shipping !== null && (
        <Row label="Shipping">
          {shipping === 0 ? (
            <span className="text-success">Free</span>
          ) : (
            <Money paise={shipping} />
          )}
        </Row>
      )}

      {tax > 0 && (
        <Row label={taxLabel}>
          <Money paise={tax} />
        </Row>
      )}

      <div
        className={cn(
          'mt-2 border-t pt-3',
          mkt ? 'border-hairline/60' : 'border-hairline',
        )}
      >
        <Row label="Total" emphasis>
          <Money paise={total} />
        </Row>
      </div>

      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
