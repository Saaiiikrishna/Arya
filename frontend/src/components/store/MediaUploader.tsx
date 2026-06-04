'use client';

import { useEffect, useRef, useState } from 'react';
import { UploadCloud, X, Loader2, AlertCircle, ImageIcon, Film } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { MediaType } from '@/lib/storeApi';

/**
 * Presigned-S3 media uploader, reusable for BOTH product media (admin client) and
 * article media (store client). It is fully decoupled from any API client: the
 * caller passes a `presign` fn and a `confirm` fn, so the same component drives
 * `api.ts` (admin product media) and `storeApi.ts` (article media).
 *
 * Flow per file:
 *   1. presign(type, file)        → { uploadUrl, mediaId }
 *   2. PUT the bytes to uploadUrl  (default XHR PUT with progress; overridable)
 *   3. confirm(mediaId, type, file) → server flips PENDING→CONFIRMED
 *
 * Caps (maxImages / maxVideos) are enforced CLIENT-SIDE against `existing` counts
 * + the in-flight selection so a user gets immediate feedback; the server is the
 * authority and re-enforces them.
 */

export interface PresignResult {
  uploadUrl: string;
  mediaId: string;
}

export interface MediaCaps {
  maxImages: number;
  maxVideos: number;
  /** Max bytes per image. Default: 50 MB. */
  maxImageBytes?: number;
  /** Max bytes per video. Default: 500 MB. */
  maxVideoBytes?: number;
}

/** Default per-file byte caps (defense-in-depth; the server re-enforces). */
const DEFAULT_MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50 MB
const DEFAULT_MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB

function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export interface MediaUploaderProps {
  /** Reserve a slot + get a presigned PUT URL for this file. */
  presign: (type: MediaType, file: File) => Promise<PresignResult>;
  /** Confirm the upload after the bytes land in S3. */
  confirm: (mediaId: string, type: MediaType, file: File) => Promise<unknown>;
  caps: MediaCaps;
  /** Count of already-uploaded media (CONFIRMED), to enforce caps. */
  existing?: { images: number; videos: number };
  /**
   * Optional override for the byte-upload step. Default does an XHR PUT to the
   * presigned URL with the file's Content-Type and reports progress.
   */
  uploadFn?: (uploadUrl: string, file: File, onProgress: (pct: number) => void) => Promise<void>;
  /**
   * Called once each file is confirmed, with the server confirm result.
   * NOTE: `result` is `unknown` because the two callers return different shapes
   * (admin `adminConfirmProductMedia` vs store `confirmArticleMedia`) and there is
   * no shared media-record type. Callers that need the confirmed record must
   * narrow/cast it to their own response type.
   */
  onUploaded?: (result: unknown, file: File) => void;
  /** Strict admin (0px) vs rounded mkt look. Default: false (admin). */
  mkt?: boolean;
  /** Disable interaction. */
  disabled?: boolean;
  className?: string;
}

type ItemStatus = 'queued' | 'uploading' | 'confirming' | 'done' | 'error';

interface UploadItem {
  id: string; // local id
  file: File;
  type: MediaType;
  preview: string; // object URL
  status: ItemStatus;
  progress: number;
  error?: string;
}

const IMAGE_MIME = /^image\//;
const VIDEO_MIME = /^video\//;

function classifyFile(file: File): MediaType | null {
  if (IMAGE_MIME.test(file.type)) return 'IMAGE';
  if (VIDEO_MIME.test(file.type)) return 'VIDEO';
  return null;
}

/** Default byte-upload: XHR PUT with progress events. */
function defaultUpload(
  uploadUrl: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

/**
 * Component-local id generator. Prefers crypto.randomUUID (collision-free across
 * concurrently mounted uploaders); falls back to a per-instance counter for
 * environments without it. Replaces the previous module-level `localIdSeq`, whose
 * shared mutable state could collide between two mounted instances.
 */
function makeIdFactory(): () => string {
  let seq = 0;
  return () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `local-${crypto.randomUUID()}`;
    }
    return `local-${Date.now()}-${++seq}`;
  };
}

export default function MediaUploader({
  presign,
  confirm,
  caps,
  existing = { images: 0, videos: 0 },
  uploadFn = defaultUpload,
  onUploaded,
  mkt = false,
  disabled = false,
  className,
}: MediaUploaderProps) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [capError, setCapError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Per-instance id generator — never shared between mounted uploaders.
  const nextId = useRef(makeIdFactory()).current;

  // Mirror items in a ref so the unmount cleanup can revoke every object URL
  // without re-subscribing the effect on each items change.
  const itemsRef = useRef<UploadItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Revoke any outstanding object URLs when the component unmounts. removeItem()
  // revokes on explicit removal, but 'done'/'error' items linger in state for the
  // component's lifetime — without this they would leak until a full page nav.
  useEffect(() => {
    return () => {
      for (const it of itemsRef.current) URL.revokeObjectURL(it.preview);
    };
  }, []);

  const maxImageBytes = caps.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const maxVideoBytes = caps.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES;

  // Count images/videos already accepted into the queue (any non-error state).
  const counts = items.reduce(
    (acc, it) => {
      if (it.status === 'error') return acc;
      if (it.type === 'IMAGE') acc.images += 1;
      else acc.videos += 1;
      return acc;
    },
    { images: existing.images, videos: existing.videos },
  );

  // Plain functions (not useCallback): they are only invoked from event handlers
  // and from one another — never used as an effect dependency or passed to a
  // memoized child — so manual memoization buys nothing and would only fight the
  // React Compiler's automatic memoization (preserve-manual-memoization).
  const runUpload = async (item: UploadItem) => {
    const setItem = (patch: Partial<UploadItem>) =>
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, ...patch } : x)));
    try {
      setItem({ status: 'uploading', progress: 0, error: undefined });
      const { uploadUrl, mediaId } = await presign(item.type, item.file);
      await uploadFn(uploadUrl, item.file, (pct) => setItem({ progress: pct }));
      setItem({ status: 'confirming', progress: 100 });
      const result = await confirm(mediaId, item.type, item.file);
      setItem({ status: 'done' });
      onUploaded?.(result, item.file);
    } catch (e) {
      setItem({ status: 'error', error: (e as Error)?.message || 'Upload failed' });
    }
  };

  const acceptFiles = (fileList: FileList | File[]) => {
    setCapError(null);
    const files = Array.from(fileList);
    const accepted: UploadItem[] = [];
    let pendingImages = counts.images;
    let pendingVideos = counts.videos;

    for (const file of files) {
      const type = classifyFile(file);
      if (!type) {
        setCapError(`Unsupported file type: ${file.name}`);
        continue;
      }
      // Client-side size guard (defense-in-depth — avoids a wasted presign call
      // + a full S3 PUT for an oversized file; the server is the authority).
      const maxBytes = type === 'IMAGE' ? maxImageBytes : maxVideoBytes;
      if (file.size > maxBytes) {
        setCapError(
          `${file.name} is too large (max ${humanBytes(maxBytes)} for ${type === 'IMAGE' ? 'images' : 'videos'}).`,
        );
        continue;
      }
      if (type === 'IMAGE' && pendingImages >= caps.maxImages) {
        setCapError(`Image limit reached (max ${caps.maxImages}).`);
        continue;
      }
      if (type === 'VIDEO' && pendingVideos >= caps.maxVideos) {
        setCapError(`Video limit reached (max ${caps.maxVideos}).`);
        continue;
      }
      if (type === 'IMAGE') pendingImages += 1;
      else pendingVideos += 1;

      accepted.push({
        id: nextId(),
        file,
        type,
        preview: URL.createObjectURL(file),
        status: 'queued',
        progress: 0,
      });
    }

    if (accepted.length) {
      setItems((prev) => [...prev, ...accepted]);
      accepted.forEach((it) => void runUpload(it));
    }
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((x) => x.id !== id);
    });
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) acceptFiles(e.target.files);
    e.target.value = ''; // allow re-selecting the same file
  };

  const capsReached =
    counts.images >= caps.maxImages && counts.videos >= caps.maxVideos;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <button
        type="button"
        disabled={disabled || capsReached}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !capsReached) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled && !capsReached && e.dataTransfer.files) acceptFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-2 border border-dashed px-6 py-10 text-center transition-colors',
          mkt ? 'rounded-2xl' : 'rounded-none',
          disabled || capsReached
            ? 'cursor-not-allowed border-hairline/60 opacity-50'
            : dragOver
              ? 'border-saffron bg-saffron-glow/15'
              : 'border-hairline bg-alabaster hover:border-forest',
        )}
      >
        <UploadCloud className="h-7 w-7 text-forest/60" aria-hidden />
        <span className="font-sans text-sm font-medium text-forest">
          {capsReached ? 'Upload limit reached' : 'Drop files or click to upload'}
        </span>
        <span className="font-sans text-[11px] uppercase tracking-[0.06em] text-ink/45">
          {counts.images}/{caps.maxImages} images · {counts.videos}/{caps.maxVideos} videos
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={onInputChange}
      />

      {capError && (
        <div className="flex items-center gap-2 border border-terracotta/40 bg-terracotta/5 px-3 py-2 font-sans text-xs text-terracotta">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {capError}
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {items.map((it) => (
            <div
              key={it.id}
              className={cn(
                'group relative aspect-square overflow-hidden border border-hairline bg-parchment-dark',
                mkt && 'rounded-xl',
              )}
            >
              {it.type === 'IMAGE' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.preview} alt={it.file.name} className="h-full w-full object-cover" />
              ) : (
                <video src={it.preview} className="h-full w-full object-cover" muted />
              )}

              {/* Status overlay */}
              {(it.status === 'uploading' || it.status === 'confirming') && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-ink/55 text-parchment">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  <span className="font-sans text-[10px] uppercase tracking-[0.06em]">
                    {it.status === 'confirming' ? 'Finalising' : `${it.progress}%`}
                  </span>
                </div>
              )}
              {it.status === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-terracotta/70 p-1 text-center text-parchment">
                  <AlertCircle className="h-5 w-5" aria-hidden />
                  <span className="font-sans text-[9px] leading-tight">{it.error}</span>
                </div>
              )}

              {/* Type chip */}
              <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-ink/55 px-1.5 py-0.5 text-parchment">
                {it.type === 'IMAGE' ? (
                  <ImageIcon className="h-3 w-3" aria-hidden />
                ) : (
                  <Film className="h-3 w-3" aria-hidden />
                )}
              </div>

              {/* Remove (only when not mid-flight) */}
              {(it.status === 'done' || it.status === 'error' || it.status === 'queued') && (
                <button
                  type="button"
                  onClick={() => removeItem(it.id)}
                  aria-label={`Remove ${it.file.name}`}
                  className="absolute right-1.5 top-1.5 rounded-full bg-ink/55 p-1 text-parchment transition-colors hover:bg-terracotta"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
