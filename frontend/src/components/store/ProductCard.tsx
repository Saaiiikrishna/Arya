'use client';

import Link from 'next/link';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import Money from './Money';
import StockBadge from './StockBadge';

/**
 * Public storefront product card — rounded glass `mkt-card` (DESIGN.md §7 premium
 * marketing layer). Presentational + prop-driven; the parent fetches and maps a
 * product list item onto these props.
 *
 * Prices are integer paise and rendered via <Money/>. If `priceTo` differs from
 * `priceFrom` a "From ₹X" range hint is shown (SKUs vary in price).
 */
export interface ProductCardProps {
  name: string;
  /** Link target, e.g. `/store/${slug}`. */
  href: string;
  /** Resolved image URL (CDN or presigned). */
  imageUrl?: string | null;
  imageAlt?: string;
  /** Lowest active SKU price, in integer paise. */
  priceFrom?: number | null;
  /** Highest active SKU price, in integer paise (for "from" detection). */
  priceTo?: number | null;
  /** Original price in paise when on sale (struck through). */
  compareAtPaise?: number | null;
  /** Available quantity for the stock badge. Omit to hide. */
  stockQty?: number | null;
  /** Small eyebrow above the name (e.g. brand or category). */
  eyebrow?: string | null;
  /** One-line subtitle under the name. */
  subtitle?: string | null;
  className?: string;
}

export default function ProductCard({
  name,
  href,
  imageUrl,
  imageAlt,
  priceFrom,
  priceTo,
  compareAtPaise,
  stockQty,
  eyebrow,
  subtitle,
  className,
}: ProductCardProps) {
  const isRange =
    priceFrom != null && priceTo != null && priceTo > priceFrom;
  const onSale =
    compareAtPaise != null && priceFrom != null && compareAtPaise > priceFrom;

  return (
    <Link
      href={href}
      className={cn('mkt-card group block overflow-hidden', className)}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-parchment-dark">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={imageAlt || name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink/25">
            <ImageOff className="h-8 w-8" aria-hidden />
          </div>
        )}

        {stockQty !== undefined && stockQty !== null && (
          <div className="absolute left-3 top-3">
            <StockBadge qty={stockQty} mkt />
          </div>
        )}
        {onSale && (
          <div className="absolute right-3 top-3 rounded-full bg-saffron px-2.5 py-1 text-[10px] font-sans font-bold uppercase tracking-[0.08em] text-parchment">
            Sale
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 p-4">
        {eyebrow && (
          <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-saffron-deep">
            {eyebrow}
          </span>
        )}
        <h3 className="font-serif text-base leading-snug text-forest line-clamp-2">
          {name}
        </h3>
        {subtitle && (
          <p className="font-sans text-xs text-ink/55 line-clamp-1">{subtitle}</p>
        )}

        <div className="mt-2 flex items-baseline gap-2">
          {priceFrom != null ? (
            <>
              {isRange && (
                <span className="font-sans text-[10px] uppercase tracking-[0.08em] text-ink/45">
                  From
                </span>
              )}
              <Money
                paise={priceFrom}
                className="font-sans text-sm font-bold text-forest"
              />
              {onSale && (
                <Money
                  paise={compareAtPaise}
                  className="font-sans text-xs text-ink/40 line-through"
                />
              )}
            </>
          ) : (
            <span className="font-sans text-xs text-ink/40">Unavailable</span>
          )}
        </div>
      </div>
    </Link>
  );
}
