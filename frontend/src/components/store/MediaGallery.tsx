'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ImageOff, Play } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface GalleryMedia {
  /** Resolved URL (CDN or presigned). */
  url: string;
  type?: 'IMAGE' | 'VIDEO';
  caption?: string | null;
  altText?: string | null;
  /** Optional poster image for a video. */
  poster?: string | null;
}

export interface MediaGalleryProps {
  media: GalleryMedia[];
  /** Rounded marketing styling. Default: false (strict/matte). */
  mkt?: boolean;
  /** Aspect ratio class for the main stage. Default: 'aspect-square'. */
  aspect?: string;
  className?: string;
}

/**
 * Image / video gallery with a main stage + thumbnail strip. Controlled by an
 * internal active-index. Presentational only — pass already-resolved URLs.
 */
export default function MediaGallery({
  media,
  mkt = false,
  aspect = 'aspect-square',
  className,
}: MediaGalleryProps) {
  const [active, setActive] = useState(0);

  if (!media || media.length === 0) {
    return (
      <div
        className={cn(
          'flex w-full items-center justify-center bg-parchment-dark text-ink/25',
          aspect,
          mkt ? 'rounded-2xl' : 'border border-hairline',
          className,
        )}
      >
        <ImageOff className="h-10 w-10" aria-hidden />
      </div>
    );
  }

  const current = media[Math.min(active, media.length - 1)];
  const isVideo = current.type === 'VIDEO';

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        className={cn(
          'relative w-full overflow-hidden bg-parchment-dark',
          aspect,
          mkt ? 'rounded-2xl' : 'border border-hairline',
        )}
      >
        {isVideo ? (
          <video
            key={current.url}
            src={current.url}
            poster={current.poster ?? undefined}
            controls
            className="h-full w-full object-contain"
          />
        ) : (
          <StageImage
            key={current.url}
            url={current.url}
            alt={current.altText || current.caption || 'Product media'}
          />
        )}
      </div>

      {current.caption && (
        <p className="font-sans text-xs text-ink/55">{current.caption}</p>
      )}

      {media.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {media.map((m, i) => (
            <button
              key={`${m.url}-${i}`}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`View media ${i + 1}`}
              aria-current={i === active}
              className={cn(
                'relative h-16 w-16 shrink-0 overflow-hidden bg-parchment-dark transition-all',
                // Border (not ring): `ring-*` compiles to a box-shadow, which
                // DESIGN.md forbids even within the mkt layer (the only documented
                // shadow exception is mkt-card hover). Use a 2px border outline.
                mkt ? 'rounded-lg border-2' : 'border',
                i === active
                  ? mkt
                    ? 'border-saffron'
                    : 'border-forest'
                  : mkt
                    ? 'border-transparent opacity-70 hover:opacity-100'
                    : 'border-hairline hover:border-forest/50',
              )}
            >
              {m.type === 'VIDEO' ? (
                <>
                  {m.poster ? (
                    <ThumbImage url={m.poster} alt="" />
                  ) : (
                    <div className="h-full w-full bg-forest/10" />
                  )}
                  <span className="absolute inset-0 flex items-center justify-center text-forest">
                    <Play className="h-4 w-4 fill-current" aria-hidden />
                  </span>
                </>
              ) : (
                <ThumbImage url={m.url} alt={m.altText || ''} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Main-stage image via next/image (`fill`). On an un-listed host or load error it
 * falls back to the placeholder icon so a bad URL never breaks the stage. `sizes`
 * reflects that the stage is roughly half the viewport on the PDP two-column
 * layout and full-width on mobile.
 */
function StageImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center text-ink/25">
        <ImageOff className="h-10 w-10" aria-hidden />
      </div>
    );
  }
  return (
    <Image
      src={url}
      alt={alt}
      fill
      sizes="(min-width: 1024px) 50vw, 100vw"
      onError={() => setFailed(true)}
      className="object-cover"
    />
  );
}

/**
 * Fixed 64x64 thumbnail via next/image (`fill` inside the 16x16 rem-ish button).
 * Falls back to a neutral tile on error.
 */
function ThumbImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="h-full w-full bg-forest/10" />;
  return (
    <Image
      src={url}
      alt={alt}
      fill
      sizes="64px"
      onError={() => setFailed(true)}
      className="object-cover"
    />
  );
}
