'use client';

/**
 * Admin Reviews Moderation queue (store vertical).
 *
 * Strict admin DESIGN.md: 0px radius, no shadows, parchment/forest/hairline,
 * matte buttons. Status filter (PENDING / APPROVED / REJECTED) + pagination.
 * Approve / reject act in place; on APPROVE the backend adds the rating to
 * Product.ratingSum/ratingCount under an advisory lock + CAS (idempotent), and on
 * un-approve subtracts. The moderating admin is pinned server-side from the JWT —
 * never sent in any request body here.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Star,
  MessageSquare,
  CheckCircle,
  XCircle,
  AlertTriangle,
  BadgeCheck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Pagination } from '@/components/store';

// ── Types (loose — backend returns Prisma rows; read defensively) ─────────────

interface ReviewRow {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: string;
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  authorName: string | null;
  productId: string | null;
  productName: string | null;
  productSlug: string | null;
  createdAt: string;
  [k: string]: unknown;
}

const PAGE_SIZE = 20;
const STATUS_FILTERS = ['PENDING', 'APPROVED', 'REJECTED', ''] as const;

// ── Helpers ───────────────────────────────────────────────────────────────

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    PENDING: 'bg-marigold/15 text-warning border-marigold/40',
    APPROVED: 'bg-success/10 text-success border-success/25',
    REJECTED: 'bg-terracotta/10 text-terracotta border-terracotta/20',
  };
  const cls = map[status] || 'bg-ink/5 text-ink/50 border-ink/15';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${cls}`}>
      {status.replace(/_/g, ' ') || 'ALL'}
    </span>
  );
}

/** Matte star row for the strict admin surface (forest fill, not the mkt saffron). */
function AdminStars({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${r} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${i < r ? 'fill-forest text-forest' : 'text-ink/20'}`}
        />
      ))}
    </span>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export default function AdminReviewsPage() {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [meta, setMeta] = useState<{ total: number; page: number; totalPages: number }>({
    total: 0,
    page: 1,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [filterStatus, setFilterStatus] = useState<string>('PENDING');
  const [page, setPage] = useState(1);
  // Per-row action lock so two clicks don't double-fire.
  const [actingId, setActingId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await api.adminListReviews({
        page,
        limit: PAGE_SIZE,
        status: filterStatus || undefined,
      });
      setRows((res?.data as ReviewRow[]) ?? []);
      setMeta(res?.meta ?? { total: 0, page: 1, totalPages: 1 });
    } catch (e: unknown) {
      setListError(errMsg(e, 'Failed to load the moderation queue.'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const moderate = useCallback(
    async (id: string, status: 'APPROVED' | 'REJECTED') => {
      setActingId(id);
      try {
        await api.adminModerateReview(id, status);
        await loadList();
      } catch (e: unknown) {
        alert(errMsg(e, `Failed to ${status === 'APPROVED' ? 'approve' : 'reject'} the review.`));
      } finally {
        setActingId(null);
      }
    },
    [loadList],
  );

  return (
    <div className="text-ink animate-fade-in px-4 sm:px-6 lg:px-8 py-8 sm:py-12 max-w-[1200px] 3xl:max-w-[1600px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-10">
        <Link
          href="/admin/dashboard"
          className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block"
        >
          ← Command Center
        </Link>
        <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold leading-none flex items-center gap-3">
          <MessageSquare className="w-7 h-7 sm:w-9 sm:h-9 text-forest/70" /> Reviews Moderation
        </h1>
        <p className="text-ink/50 mt-2 font-serif italic">
          Approve or reject customer product reviews. Approving adds the rating to the product score.
        </p>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => {
              setFilterStatus(s);
              setPage(1);
            }}
            className={`px-4 py-2 text-[10px] uppercase tracking-widest font-bold border transition-colors ${
              filterStatus === s
                ? 'border-forest bg-forest text-parchment'
                : 'border-hairline bg-white text-ink/60 hover:border-forest/30'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Queue */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Queue</p>
          </div>
        </div>
      ) : listError ? (
        <div className="border border-terracotta/30 bg-terracotta/5 p-8 text-center">
          <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-terracotta/60" />
          <p className="text-terracotta font-semibold mb-4">{listError}</p>
          <button
            onClick={loadList}
            className="px-5 py-2 border border-terracotta text-terracotta text-[10px] uppercase tracking-widest font-bold hover:bg-terracotta hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="border border-hairline bg-white overflow-x-auto">
            <div className="min-w-[820px]">
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
              <div className="col-span-5">Review</div>
              <div className="col-span-2">Product</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-1">Date</div>
              <div className="col-span-3 text-right">Actions</div>
            </div>

            {rows.length === 0 ? (
              <div className="p-12 text-center text-ink/40">
                <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="font-serif italic">
                  No reviews {filterStatus ? `with status ${filterStatus.toLowerCase()}` : ''}.
                </p>
              </div>
            ) : (
              rows.map((r) => (
                <div
                  key={r.id}
                  className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 items-start text-sm"
                >
                  {/* Review */}
                  <div className="col-span-5 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <AdminStars rating={r.rating} />
                      {r.isVerifiedPurchase && (
                        <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold text-forest/70">
                          <BadgeCheck className="w-3 h-3" /> Verified
                        </span>
                      )}
                    </div>
                    {r.title && <div className="font-bold truncate">{r.title}</div>}
                    {r.body && (
                      <div className="text-[12px] text-ink/55 mt-0.5 line-clamp-3">{r.body}</div>
                    )}
                    <div className="text-[10px] text-ink/40 mt-1.5 uppercase tracking-widest">
                      {r.authorName || 'Anonymous'}
                      {r.helpfulCount > 0 && (
                        <span className="ml-2 normal-case tracking-normal">· {r.helpfulCount} helpful</span>
                      )}
                    </div>
                  </div>

                  {/* Product */}
                  <div className="col-span-2 min-w-0">
                    {r.productSlug ? (
                      <Link
                        href={`/store/${r.productSlug}`}
                        target="_blank"
                        className="text-xs font-semibold text-forest hover:underline truncate block"
                      >
                        {r.productName || r.productSlug}
                      </Link>
                    ) : (
                      <span className="text-xs text-ink/50 truncate block">
                        {r.productName || '—'}
                      </span>
                    )}
                  </div>

                  {/* Status */}
                  <div className="col-span-1">{statusBadge(r.status)}</div>

                  {/* Date */}
                  <div className="col-span-1 text-xs text-ink/50">{fmtDate(r.createdAt)}</div>

                  {/* Actions */}
                  <div className="col-span-3 flex justify-end gap-2">
                    {r.status !== 'APPROVED' && (
                      <button
                        onClick={() => moderate(r.id, 'APPROVED')}
                        disabled={actingId === r.id}
                        className="px-3 py-1.5 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                      >
                        <CheckCircle className="w-3.5 h-3.5" /> Approve
                      </button>
                    )}
                    {r.status !== 'REJECTED' && (
                      <button
                        onClick={() => moderate(r.id, 'REJECTED')}
                        disabled={actingId === r.id}
                        className="px-3 py-1.5 border border-terracotta/40 text-terracotta text-[10px] uppercase tracking-widest font-bold hover:bg-terracotta hover:text-white disabled:opacity-50 transition-colors flex items-center gap-1.5"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
            </div>
          </div>

          {/* Footer: count + pagination */}
          <div className="mt-6 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">
              {meta.total} review{meta.total !== 1 ? 's' : ''}
            </span>
            <Pagination
              page={meta.page}
              totalPages={meta.totalPages}
              onPageChange={(p) => setPage(p)}
            />
          </div>
        </>
      )}
    </div>
  );
}
