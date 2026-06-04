'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import Money from './Money';
import StockBadge from './StockBadge';
import Stars from './Stars';

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
  /** Average rating (0..5, may be fractional). Stars render only when ratingCount>0. */
  ratingAverage?: number | null;
  /** Number of approved ratings. The star row is hidden when this is 0/absent. */
  ratingCount?: number | null;
  /**
   * Eager-load the thumbnail (sets next/image `priority`, disabling lazy-load).
   * Set this on the first above-the-fold card in a catalog grid — it is frequently
   * the Largest Contentful Paint element, so prioritising it improves LCP. Leave
   * `false` (the default) for all other cards so they lazy-load as usual.
   */
  priority?: boolean;
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
  ratingAverage,
  ratingCount,
  priority = false,
  className,
}: ProductCardProps) {
  const isRange =
    priceFrom != null && priceTo != null && priceTo > priceFrom;
  const onSale =
    compareAtPaise != null && priceFrom != null && compareAtPaise > priceFrom;

  // next/image optimizes the remote thumbnail (a known CDN/S3 URL). If the host
  // is not in next.config remotePatterns, or the fetch errors, we fall back to
  // the same placeholder used when no image exists — so a bad/un-listed URL
  // degrades gracefully instead of breaking the card.
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!imageUrl && !imgFailed;

  return (
    <Link
      href={href}
      className={cn('mkt-card group block overflow-hidden', className)}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-parchment-dark">
        {showImage ? (
          <Image
            src={imageUrl as string}
            alt={imageAlt || name}
            fill
            // 5-up on desktop, 2-up tablet, 1-up mobile (matches the catalog grid).
            sizes="(min-width: 1024px) 20vw, (min-width: 640px) 50vw, 100vw"
            priority={priority}
            onError={() => setImgFailed(true)}
            className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
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

        {ratingCount != null && ratingCount > 0 && (
          <Stars
            value={ratingAverage ?? 0}
            count={ratingCount}
            size="h-3.5 w-3.5"
            className="mt-1"
          />
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
