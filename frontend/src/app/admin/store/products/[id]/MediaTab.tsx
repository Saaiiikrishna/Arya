'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { MediaUploader, type MediaType, type PresignResult } from '@/components/store';
import { SectionCard } from './_ui';
import type { TabProps, ProductMediaItem } from './types';
import { storeApi } from '@/lib/storeApi';
import { Trash2, ImageIcon, Film, AlertCircle, CheckCircle2, Clock } from 'lucide-react';

/**
 * Product media tab. MediaUploader is decoupled from any client — we pass admin
 * presign/confirm adapters. Caps: 10 images + 1 video (server-enforced; mirrored
 * client-side here). The S3 PUT goes through storeApi.uploadToPresignedUrl (a bare
 * PUT to AWS — never the API wrapper).
 *
 * Media is sourced directly from the `product.media` prop — the parent detail page
 * refetches the full product tree on `onChanged()`, so a separate media-list fetch
 * here would double-fetch on every mutation. We invalidate by calling `onChanged()`.
 */
export default function MediaTab({ product, onChanged }: TabProps) {
  const media: ProductMediaItem[] = product.media ?? [];
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const confirmedImages = media.filter((m) => m.type === 'IMAGE' && m.status === 'CONFIRMED').length;
  const confirmedVideos = media.filter((m) => m.type === 'VIDEO' && m.status === 'CONFIRMED').length;

  const presign = async (type: MediaType, file: File): Promise<PresignResult> => {
    const res = await api.adminPresignProductMedia(product.id, {
      type,
      fileName: file.name,
      mimeType: file.type,
    });
    return { uploadUrl: res.uploadUrl, mediaId: res.mediaId };
  };

  const confirmUpload = async (mediaId: string, _type: MediaType, file: File) => {
    return api.adminConfirmProductMedia(product.id, { mediaId, fileSize: file.size });
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this media asset? This also removes the underlying file.')) return;
    setDeletingId(id);
    setError(null);
    try {
      await api.adminDeleteProductMedia(product.id, id);
      await onChanged();
    } catch (e) {
      setError((e as Error)?.message || 'Failed to delete media');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 border border-terracotta/40 bg-terracotta/5 px-3 py-2 text-xs text-terracotta">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <SectionCard title="Upload Media">
        <p className="text-xs text-ink/50 mb-4">
          Up to <strong>10 images</strong> and <strong>1 video</strong>. Images ≤ 15 MB, video ≤ 200 MB.
        </p>
        <MediaUploader
          presign={presign}
          confirm={confirmUpload}
          caps={{
            maxImages: 10,
            maxVideos: 1,
            maxImageBytes: 15 * 1024 * 1024,
            maxVideoBytes: 200 * 1024 * 1024,
          }}
          existing={{ images: confirmedImages, videos: confirmedVideos }}
          uploadFn={(uploadUrl, file) => storeApi.uploadToPresignedUrl(uploadUrl, file)}
          onUploaded={() => {
            void onChanged();
          }}
        />
      </SectionCard>

      <SectionCard title={`Current Media (${media.length})`}>
        {media.length === 0 ? (
          <p className="text-ink/40 text-sm font-serif italic py-6 text-center">No media uploaded yet.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {media.map((m) => (
              <div key={m.id} className="group relative border border-hairline bg-parchment aspect-square overflow-hidden">
                {m.url ? (
                  m.type === 'VIDEO' ? (
                    <video src={m.url} className="w-full h-full object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt={m.altText ?? ''} className="w-full h-full object-cover" />
                  )
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-ink/30">
                    {m.type === 'VIDEO' ? <Film className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}
                    <span className="text-[9px] uppercase tracking-widest">No preview</span>
                  </div>
                )}

                {/* Status chip */}
                <span
                  className={`absolute left-1.5 top-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] uppercase tracking-widest font-bold border ${
                    m.status === 'CONFIRMED'
                      ? 'bg-success/15 text-success border-success/30'
                      : 'bg-marigold/20 text-warning border-marigold/40'
                  }`}
                >
                  {m.status === 'CONFIRMED' ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                  {m.status === 'CONFIRMED' ? 'Live' : 'Pending'}
                </span>

                <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-none bg-ink/55 px-1.5 py-0.5 text-parchment">
                  {m.type === 'VIDEO' ? <Film className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                </span>

                <button
                  onClick={() => remove(m.id)}
                  disabled={deletingId === m.id}
                  className="absolute bottom-1.5 right-1.5 bg-ink/55 p-1.5 text-parchment hover:bg-terracotta disabled:opacity-50 transition-colors"
                  aria-label="Delete media"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                {m.caption && (
                  <div className="absolute bottom-0 left-0 right-0 bg-ink/60 text-parchment text-[9px] px-1.5 py-1 truncate">
                    {m.caption}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
