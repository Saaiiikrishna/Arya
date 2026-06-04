'use client';

import Link from 'next/link';
import { Minus, Plus, Trash2, ImageOff, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import Money from './Money';

/**
 * A single cart line row. Presentational + prop-driven: the parent owns the cart
 * state and supplies quantity-change / remove handlers. All money is integer
 * paise, rendered via <Money/>.
 *
 * Quantity controls call `onQtyChange(newQty)`; the parent debounces / persists
 * via storeApi.updateCartItem. Set `pending` while a mutation is in flight to lock
 * the controls. `purchasable === false` (or `inStock === false`) surfaces an
 * out-of-stock warning so the customer knows to remove it before checkout.
 */
export interface CartLineItemProps {
  name: string | null;
  /** SKU code shown as a small mono caption. */
  skuCode?: string | null;
  /** Optional product image URL. */
  imageUrl?: string | null;
  /** Optional product link (e.g. `/store/${slug}`). */
  href?: string;
  quantity: number;
  /** Snapshot unit price, integer paise. */
  unitPrice: number;
  /** Line subtotal (unitPrice × qty), integer paise. */
  lineSubtotal: number;
  /** Whether the line is buyable; false → out-of-stock warning. Default: true. */
  purchasable?: boolean;
  inStock?: boolean;
  /** Available qty — used to cap the + button. */
  available?: number;
  /** Lock controls while a mutation is in flight. */
  pending?: boolean;
  onQtyChange: (qty: number) => void;
  onRemove: () => void;
  /** Rounded marketing styling. Default: false (strict/matte). */
  mkt?: boolean;
  className?: string;
}

export default function CartLineItem({
  name,
  skuCode,
  imageUrl,
  href,
  quantity,
  unitPrice,
  lineSubtotal,
  purchasable = true,
  inStock = true,
  available,
  pending = false,
  onQtyChange,
  onRemove,
  mkt = false,
  className,
}: CartLineItemProps) {
  const unavailable = !purchasable || !inStock;
  const atMax = available !== undefined && quantity >= available && available >= 0;
  const dec = () => quantity > 1 && onQtyChange(quantity - 1);
  const inc = () => !atMax && onQtyChange(quantity + 1);

  const stepBtn = cn(
    'flex h-8 w-8 items-center justify-center text-forest transition-colors disabled:cursor-not-allowed disabled:opacity-30',
    mkt ? 'rounded-full hover:bg-saffron-glow/25' : 'hover:bg-forest/5',
  );

  const displayName = name || 'Item';
  const nameClassName = cn(
    'truncate font-serif text-base text-forest',
    href && 'hover:text-saffron-deep',
  );

  return (
    <div
      className={cn(
        'flex gap-4 py-4',
        mkt ? 'border-b border-hairline/60 last:border-0' : 'border-b border-hairline last:border-0',
        pending && 'opacity-60',
        className,
      )}
    >
      <div
        className={cn(
          'relative h-20 w-20 shrink-0 overflow-hidden bg-parchment-dark',
          mkt ? 'rounded-xl' : 'border border-hairline',
        )}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={name || 'Item'} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink/25">
            <ImageOff className="h-6 w-6" aria-hidden />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {href ? (
          // Internal store link → Next.js <Link> for prefetch + soft navigation
          // (consistent with ProductCard / ArticleCard); a bare <a> would force a
          // full page reload.
          <Link href={href} className={nameClassName}>
            {displayName}
          </Link>
        ) : (
          <div className={nameClassName}>{displayName}</div>
        )}
        {skuCode && (
          <span className="font-mono text-[11px] text-ink/45">{skuCode}</span>
        )}

        {unavailable && (
          <span className="mt-0.5 inline-flex items-center gap-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.05em] text-terracotta">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            Out of stock
          </span>
        )}

        <div className="mt-2 flex items-center justify-between gap-3">
          {/* Quantity stepper */}
          <div
            className={cn(
              'inline-flex items-center',
              mkt ? 'rounded-full border border-hairline' : 'border border-hairline',
            )}
          >
            <button
              type="button"
              className={stepBtn}
              onClick={dec}
              disabled={pending || quantity <= 1}
              aria-label="Decrease quantity"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-9 text-center font-sans text-sm tabular-nums text-ink">
              {quantity}
            </span>
            <button
              type="button"
              className={stepBtn}
              onClick={inc}
              disabled={pending || atMax}
              aria-label="Increase quantity"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={onRemove}
            disabled={pending}
            aria-label={`Remove ${displayName}`}
            className="inline-flex items-center gap-1 font-sans text-[11px] uppercase tracking-[0.05em] text-ink/50 transition-colors hover:text-terracotta disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Remove
          </button>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-between text-right">
        <Money paise={lineSubtotal} className="font-sans text-sm font-bold text-forest" />
        {quantity > 1 && (
          <span className="font-sans text-[11px] text-ink/45">
            <Money paise={unitPrice} showDecimals={false} /> each
          </span>
        )}
      </div>
    </div>
  );
}
