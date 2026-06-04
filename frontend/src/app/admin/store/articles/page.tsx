'use client';

/**
 * Admin Articles Moderation Dashboard (store vertical).
 *
 * 3-panel queue pattern (list → detail) matching the strict admin DESIGN.md:
 * 0px radius, no shadows, parchment/forest/hairline, matte buttons.
 *
 * - Queue: status filter (SUBMITTED / APPROVED / PUBLISHED / REJECTED), free-text
 *   search, pagination. Backed by api.adminListArticles().
 * - Detail: full article (title, author, body preview via BlockRenderer, cover +
 *   media gallery), FULL admin view metrics (total views, unique IPs, daily
 *   trend, geo + referrer breakdown — only the admin detail endpoint exposes
 *   these), and the moderation actions: approve, reject (required reason),
 *   feature/unfeature, unpublish, edit, restore, soft-delete.
 *
 * Identity/actor (decidedByAdminId) is pinned server-side from the JWT — never
 * sent in any request body here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Newspaper, ChevronRight, ChevronLeft, Search, Eye, Users, Globe,
  Link2, CheckCircle, XCircle, Star, Archive, Pencil, RotateCcw, Trash2,
  AlertTriangle, Clock, User, Tag, FileText, BarChart3,
} from 'lucide-react';
import { api } from '@/lib/api';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import {
  Modal,
  Pagination,
  BlockRenderer,
  MediaGallery,
  type ContentBlock,
  type GalleryMedia,
} from '@/components/store';

// ── Types (loose — backend returns Prisma rows; we read defensively) ──────────

interface ArticleRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverS3Key: string | null;
  status: string;
  tags: string[];
  authorType?: string;
  authorName: string | null;
  viewCount: number;
  rejectionReason: string | null;
  reviewedById: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ArticleMetrics {
  path: string;
  totalViews: number;
  uniqueIps: number;
  dailyTrend: Array<{ date: string; views: number; uniqueIps: number; avgDuration: number | null }>;
  geo: Array<{ country: string | null; visitors: number }>;
  referrers: Array<{ referrer: string | null; hits: number }>;
}

interface ArticleDetail extends ArticleRow {
  body: Record<string, unknown> | null;
  media: Array<Record<string, unknown>>;
  metrics: ArticleMetrics;
}

type Panel = 'list' | 'detail';

const FEATURED_TAG = '__featured__';
const PAGE_SIZE = 20;

const STATUS_FILTERS = ['', 'DRAFT', 'SUBMITTED', 'APPROVED', 'PUBLISHED', 'REJECTED', 'ARCHIVED'] as const;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Extract a human-readable message from an unknown thrown value. */
function errMsg(e: unknown, fallback: string): string {
  return (e instanceof Error && e.message) ? e.message : fallback;
}

/** Parse the rich-text `body` JSON into the BlockRenderer block list. */
function blocksOf(body: Record<string, unknown> | null | undefined): ContentBlock[] {
  if (!body || typeof body !== 'object') return [];
  const blocks = (body as Record<string, unknown>).blocks;
  return Array.isArray(blocks) ? (blocks as ContentBlock[]) : [];
}

/** Resolve all confirmed/admin media rows (raw s3Key) to gallery items. */
function mediaOf(rows: Array<Record<string, unknown>> | undefined): GalleryMedia[] {
  if (!Array.isArray(rows)) return [];
  const out: GalleryMedia[] = [];
  for (const m of rows) {
    const url = resolveMediaUrl(
      (m.url as string | undefined) ?? (m.s3Key as string | undefined),
    );
    if (!url) continue;
    out.push({
      url,
      type: m.type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
      caption: typeof m.caption === 'string' ? m.caption : null,
      poster: resolveMediaUrl(
        (m.poster as string | undefined) ?? (m.posterS3Key as string | undefined),
      ),
    });
  }
  return out;
}

/** Visible tags (drop the reserved featured sentinel). */
function visibleTags(tags: string[] | undefined): string[] {
  return Array.isArray(tags) ? tags.filter((t) => t !== FEATURED_TAG) : [];
}

function isFeatured(tags: string[] | undefined): boolean {
  return Array.isArray(tags) && tags.includes(FEATURED_TAG);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    DRAFT: 'bg-ink/5 text-ink/50 border-ink/15',
    SUBMITTED: 'bg-marigold/15 text-warning border-marigold/40',
    PUBLISHED: 'bg-success/10 text-success border-success/25',
    REJECTED: 'bg-terracotta/10 text-terracotta border-terracotta/20',
    APPROVED: 'bg-forest/10 text-forest border-forest/20',
    ARCHIVED: 'bg-ink/10 text-ink/60 border-ink/25',
  };
  const cls = map[status] || 'bg-ink/5 text-ink/50 border-ink/15';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export default function AdminArticlesPage() {
  // Queue state
  const [rows, setRows] = useState<ArticleRow[]>([]);
  const [meta, setMeta] = useState<{ total: number; page: number; totalPages: number }>({
    total: 0, page: 1, totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [filterStatus, setFilterStatus] = useState<string>('SUBMITTED');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Bumped to force a reactive list reload (e.g. on back-navigation after a
  // moderation action) without an imperative fetch that races the useEffect.
  const [refreshKey, setRefreshKey] = useState(0);

  // Detail state
  const [panel, setPanel] = useState<Panel>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArticleDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Reject modal
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', excerpt: '', tags: '' });

  // ── Data loading ──────────────────────────────────────────────────────────
  //
  // No realtime socket here by design: storeSockets only emits stock.updated and
  // order.updated (see @/lib/storeSockets). There is no "article submitted"
  // realtime event in the socket contract, so this content-moderation queue
  // refreshes on navigation back, on filter/search/page change, and on manual
  // retry — deliberately, not as an oversight.

  const loadList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await api.adminListArticles({
        page,
        limit: PAGE_SIZE,
        status: filterStatus || undefined,
        search: search || undefined,
      });
      setRows((res?.data as ArticleRow[]) ?? []);
      setMeta(res?.meta ?? { total: 0, page: 1, totalPages: 1 });
    } catch (e: unknown) {
      setListError(errMsg(e, 'Failed to load the moderation queue.'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, search]);

  // Re-fetch when the filters/search/page change (via loadList identity) or when
  // refreshKey is bumped (e.g. back-navigation after a moderation action). Both
  // are dependencies so the fetch is fully reactive — no imperative loadList()
  // calls that could race this effect.
  useEffect(() => {
    loadList();
  }, [loadList, refreshKey]);

  // Debounce the free-text search input.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setPanel('detail');
    setLoadingDetail(true);
    setDetailError(null);
    setDetail(null);
    try {
      const d = await api.adminGetArticle(id);
      setDetail(d as ArticleDetail);
    } catch (e: unknown) {
      setDetailError(errMsg(e, 'Failed to load this article.'));
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const reloadDetail = useCallback(async () => {
    if (!selectedId) return;
    try {
      const d = await api.adminGetArticle(selectedId);
      setDetail(d as ArticleDetail);
    } catch (e: unknown) {
      setDetailError(errMsg(e, 'Failed to reload this article.'));
    }
  }, [selectedId]);

  const backToList = () => {
    setPanel('list');
    setDetail(null);
    setSelectedId(null);
    setDetailError(null);
    // Reactive reload: bump the refresh key so the loadList useEffect re-fires
    // exactly once with the current filters, instead of an imperative fetch that
    // could race a later filter-state-driven useEffect.
    setRefreshKey((k) => k + 1);
  };

  // ── Moderation actions ──────────────────────────────────────────────────────

  const doApprove = async () => {
    if (!selectedId) return;
    if (!confirm('Approve and publish this article? It becomes publicly visible immediately.')) return;
    setActionLoading(true);
    try {
      await api.adminApproveArticle(selectedId);
      await reloadDetail();
    } catch (e: unknown) {
      alert(errMsg(e, 'Failed to approve article.'));
    } finally {
      setActionLoading(false);
    }
  };

  const submitReject = async () => {
    if (!selectedId) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) {
      alert('A rejection reason is required (at least 3 characters). It is sent to the author.');
      return;
    }
    setActionLoading(true);
    try {
      await api.adminRejectArticle(selectedId, reason);
      setRejectOpen(false);
      setRejectReason('');
      await reloadDetail();
    } catch (e: unknown) {
      alert(errMsg(e, 'Failed to reject article.'));
    } finally {
      setActionLoading(false);
    }
  };

  const toggleFeatured = async () => {
    if (!selectedId || !detail) return;
    const next = !isFeatured(detail.tags);
    setActionLoading(true);
    try {
      await api.adminUpdateArticle(selectedId, { featured: next });
      await reloadDetail();
    } catch (e: unknown) {
      alert(errMsg(e, 'Failed to update featured status.'));
    } finally {
      setActionLoading(false);
    }
  };

  // Archive = unpublish a PUBLISHED article into the distinct terminal ARCHIVED
  // state (backed by adminUpdateArticle({ unpublish: true })). It is pulled off
  // the public listing but is NOT returned to the moderation queue.
  const doArchive = async () => {
    if (!selectedId) return;
    if (!confirm('Archive this article? It will be pulled off the public listing into the Archived state (it does NOT go back into the review queue). You can Restore it later.')) return;
    setActionLoading(true);
    try {
      await api.adminUpdateArticle(selectedId, { unpublish: true });
      await reloadDetail();
    } catch (e: unknown) {
      alert(errMsg(e, 'Failed to archive article.'));
    } finally {
      setActionLoading(false);
    }
  };

  const doRestore = async () => {
    if (!selectedId) return;
    if (!confirm('Restore this article? It will be (re)published and made publicly visible.')) return;
    setActionLoading(true);
    try {
      await api.adminRestoreArticle(selectedId);
      await reloadDetail();
    } catch (e: unknown) {
      alert(errMsg(e, 'Failed to restore article.'));
    } finally {
      setActionLoading(false);
    }
  };

  const doDelete = async () => {
    if (!selectedId || !detail) return;
    // Truncate the (untrusted-length, up to 300-char) title so a long or
    // newline-containing title cannot blow out the native confirm dialog.
    const shortTitle =
      detail.title.length > 80 ? `${detail.title.slice(0, 80)}…` : detail.title;
    if (!confirm(`Permanently remove "${shortTitle}"? This hard-deletes the article and all its media. This cannot be undone.`)) return;
    setActionLoading(true);
    try {
      await api.adminDeleteArticle(selectedId);
      backToList();
    } catch (e: unknown) {
      alert(errMsg(e, 'Failed to delete article.'));
      setActionLoading(false);
    }
  };

  const openEdit = () => {
    if (!detail) return;
    setEditForm({
      title: detail.title || '',
      excerpt: detail.excerpt || '',
      tags: visibleTags(detail.tags).join(', '),
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!selectedId) return;
    const title = editForm.title.trim();
    if (title.length < 3) {
      alert('Title must be at least 3 characters.');
      return;
    }
    const tags = editForm.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    // Match the backend AdminUpdateArticleDto bounds so a too-long tag (or too
    // many tags) gets a clear field-level message instead of a generic 400.
    const tooLong = tags.find((t) => t.length > 60);
    if (tooLong) {
      alert(`Each tag must be 60 characters or fewer. "${tooLong.slice(0, 30)}…" is too long.`);
      return;
    }
    if (tags.length > 25) {
      alert('A maximum of 25 tags is allowed.');
      return;
    }
    setActionLoading(true);
    try {
      await api.adminUpdateArticle(selectedId, {
        title,
        excerpt: editForm.excerpt.trim() || undefined,
        tags,
      });
      setEditOpen(false);
      await reloadDetail();
    } catch (e: unknown) {
      alert(errMsg(e, 'Failed to save edits.'));
    } finally {
      setActionLoading(false);
    }
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const blocks = useMemo(() => blocksOf(detail?.body), [detail]);
  const media = useMemo(() => mediaOf(detail?.media), [detail]);
  const coverUrl = useMemo(() => resolveMediaUrl(detail?.coverS3Key), [detail]);
  const featured = detail ? isFeatured(detail.tags) : false;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-10 flex justify-between items-end">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none flex items-center gap-3">
            <Newspaper className="w-9 h-9 text-forest/70" /> Articles Moderation
          </h1>
          <p className="text-ink/50 mt-2 font-serif italic">
            Review, publish, and curate community-submitted articles
          </p>
        </div>
      </header>

      {/* ── LIST PANEL ──────────────────────────────────────────────────────── */}
      {panel === 'list' && (
        <section className="animate-fade-in">
          {/* Filters + search */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div className="flex gap-2 flex-wrap">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s || 'all'}
                  onClick={() => { setFilterStatus(s); setPage(1); }}
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
            <div className="relative">
              <Search className="w-4 h-4 text-ink/30 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search title, excerpt, author…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-72 border border-hairline bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-forest"
              />
            </div>
          </div>

          {/* Queue table */}
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
              <div className="border border-hairline bg-white">
                <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
                  <div className="col-span-5">Article</div>
                  <div className="col-span-2">Author</div>
                  <div className="col-span-1">Status</div>
                  <div className="col-span-1 text-right">Views</div>
                  <div className="col-span-2">Submitted</div>
                  <div className="col-span-1" />
                </div>

                {rows.length === 0 ? (
                  <div className="p-12 text-center text-ink/40">
                    <Newspaper className="w-8 h-8 mx-auto mb-3 opacity-40" />
                    <p className="font-serif italic">
                      No articles {filterStatus ? `with status ${filterStatus.toLowerCase()}` : ''}{search ? ` matching “${search}”` : ''}.
                    </p>
                  </div>
                ) : (
                  rows.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => openDetail(a.id)}
                      className="w-full text-left grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm"
                    >
                      <div className="col-span-5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold truncate">{a.title}</span>
                          {isFeatured(a.tags) && (
                            <Star className="w-3.5 h-3.5 text-saffron-deep fill-saffron-deep shrink-0" />
                          )}
                        </div>
                        {a.excerpt && (
                          <div className="text-[11px] text-ink/40 truncate mt-0.5">{a.excerpt}</div>
                        )}
                      </div>
                      <div className="col-span-2 min-w-0">
                        <div className="text-xs font-semibold truncate">{a.authorName || '—'}</div>
                        {a.authorType && (
                          <div className="text-[10px] text-ink/40 uppercase tracking-widest">{a.authorType}</div>
                        )}
                      </div>
                      <div className="col-span-1">{statusBadge(a.status)}</div>
                      <div className="col-span-1 text-right font-serif font-bold tabular-nums">{a.viewCount ?? 0}</div>
                      <div className="col-span-2 text-xs text-ink/50">{fmtDate(a.createdAt)}</div>
                      <div className="col-span-1 flex justify-end">
                        <ChevronRight className="w-4 h-4 text-ink/30" />
                      </div>
                    </button>
                  ))
                )}
              </div>

              {/* Footer: count + pagination */}
              <div className="mt-6 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">
                  {meta.total} article{meta.total !== 1 ? 's' : ''}
                </span>
                <Pagination
                  page={meta.page}
                  totalPages={meta.totalPages}
                  onPageChange={(p) => setPage(p)}
                />
              </div>
            </>
          )}
        </section>
      )}

      {/* ── DETAIL PANEL ────────────────────────────────────────────────────── */}
      {panel === 'detail' && (
        <section className="animate-fade-in">
          <button
            onClick={backToList}
            className="text-forest text-sm uppercase tracking-widest font-bold mb-6 inline-flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Back to Queue
          </button>

          {loadingDetail ? (
            <div className="p-12 text-center">
              <div className="w-6 h-6 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Article</p>
            </div>
          ) : detailError ? (
            <div className="border border-terracotta/30 bg-terracotta/5 p-8 text-center">
              <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-terracotta/60" />
              <p className="text-terracotta font-semibold mb-4">{detailError}</p>
              <button
                onClick={() => selectedId && openDetail(selectedId)}
                className="px-5 py-2 border border-terracotta text-terracotta text-[10px] uppercase tracking-widest font-bold hover:bg-terracotta hover:text-white transition-colors"
              >
                Retry
              </button>
            </div>
          ) : detail ? (
            <div className="space-y-8">
              {/* Header + actions */}
              <div className="border border-hairline bg-white p-8">
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 flex-wrap mb-2">
                      {statusBadge(detail.status)}
                      {featured && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border bg-saffron/10 text-saffron-deep border-saffron/30">
                          <Star className="w-3 h-3 fill-current" /> Featured
                        </span>
                      )}
                    </div>
                    <h2 className="font-serif text-3xl font-bold leading-tight">{detail.title}</h2>
                    <div className="flex items-center gap-4 mt-3 text-xs text-ink/50 flex-wrap">
                      <span className="inline-flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5" /> {detail.authorName || 'Unknown author'}
                        {detail.authorType && <span className="text-ink/30 uppercase tracking-widest">· {detail.authorType}</span>}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> Submitted {fmtDate(detail.createdAt)}
                      </span>
                      {detail.publishedAt && (
                        <span className="inline-flex items-center gap-1.5 text-success">
                          <CheckCircle className="w-3.5 h-3.5" /> Published {fmtDate(detail.publishedAt)}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-xs text-ink/40">
                      Slug: <code className="bg-alabaster px-2 py-0.5">/articles/{detail.slug}</code>
                    </div>
                  </div>
                </div>

                {/* Action bar */}
                <div className="mt-6 pt-6 border-t border-hairline flex flex-wrap gap-2">
                  {detail.status === 'SUBMITTED' && (
                    <>
                      <button
                        onClick={doApprove}
                        disabled={actionLoading}
                        className="px-4 py-2 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                      >
                        <CheckCircle className="w-3.5 h-3.5" /> Approve &amp; Publish
                      </button>
                      <button
                        onClick={() => { setRejectReason(''); setRejectOpen(true); }}
                        disabled={actionLoading}
                        className="px-4 py-2 bg-terracotta text-white text-[10px] uppercase tracking-widest font-bold hover:bg-terracotta/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    </>
                  )}

                  {detail.status === 'PUBLISHED' && (
                    <>
                      <button
                        onClick={toggleFeatured}
                        disabled={actionLoading}
                        className={`px-4 py-2 text-[10px] uppercase tracking-widest font-bold transition-colors flex items-center gap-2 disabled:opacity-50 border ${
                          featured
                            ? 'border-saffron bg-saffron/10 text-saffron-deep hover:bg-saffron/20'
                            : 'border-forest text-forest hover:bg-forest hover:text-parchment'
                        }`}
                      >
                        <Star className={`w-3.5 h-3.5 ${featured ? 'fill-current' : ''}`} />
                        {featured ? 'Unfeature' : 'Feature'}
                      </button>
                      <button
                        onClick={doArchive}
                        disabled={actionLoading}
                        className="px-4 py-2 border border-hairline text-ink/70 text-[10px] uppercase tracking-widest font-bold hover:border-terracotta hover:text-terracotta disabled:opacity-50 transition-colors flex items-center gap-2"
                      >
                        <Archive className="w-3.5 h-3.5" /> Archive
                      </button>
                    </>
                  )}

                  {/*
                    ARCHIVED is the terminal "unpublished" state (distinct from the
                    SUBMITTED queue). The only forward transition is Restore
                    (ARCHIVED -> PUBLISHED), which makes it publicly visible again.
                  */}
                  {detail.status === 'ARCHIVED' && (
                    <button
                      onClick={doRestore}
                      disabled={actionLoading}
                      className="px-4 py-2 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Restore &amp; Publish
                    </button>
                  )}

                  {/*
                    APPROVED is an intermediate "approved but not yet live" state.
                    The only valid backend transition from APPROVED is restore()
                    (→ PUBLISHED): approve() and reject() both act ONLY on
                    SUBMITTED (they throw ARTICLE_NOT_PENDING for APPROVED), and
                    unpublish only applies to PUBLISHED. So the single correct
                    action here is Publish — offering Reject/Approve would
                    guarantee a 409. (Edit and Delete remain available below.)
                  */}
                  {detail.status === 'APPROVED' && (
                    <button
                      onClick={doRestore}
                      disabled={actionLoading}
                      className="px-4 py-2 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Publish
                    </button>
                  )}

                  {detail.status === 'REJECTED' && (
                    <button
                      onClick={doRestore}
                      disabled={actionLoading}
                      className="px-4 py-2 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Restore &amp; Publish
                    </button>
                  )}

                  {/*
                    Defensive catch-all for any future ArticleStatus the schema
                    might add (the enum is open). restore() publishes any
                    non-PUBLISHED article, so it is the safe universal action.
                    Scoped to known-unhandled statuses only so adding a new
                    status surfaces a usable action instead of a dead-end bar.
                  */}
                  {!['DRAFT', 'SUBMITTED', 'APPROVED', 'PUBLISHED', 'REJECTED', 'ARCHIVED'].includes(detail.status) && (
                    <button
                      onClick={doRestore}
                      disabled={actionLoading}
                      className="px-4 py-2 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Restore &amp; Publish
                    </button>
                  )}

                  <button
                    onClick={openEdit}
                    disabled={actionLoading}
                    className="px-4 py-2 border border-hairline text-ink/70 text-[10px] uppercase tracking-widest font-bold hover:border-forest hover:text-forest disabled:opacity-50 transition-colors flex items-center gap-2"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>

                  <button
                    onClick={doDelete}
                    disabled={actionLoading}
                    className="px-4 py-2 border border-terracotta/40 text-terracotta text-[10px] uppercase tracking-widest font-bold hover:bg-terracotta hover:text-white disabled:opacity-50 transition-colors flex items-center gap-2 ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>

                {(detail.status === 'REJECTED' || detail.status === 'APPROVED') && (
                  <div className="mt-5 border border-marigold/30 bg-marigold/5 p-4 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <p className="text-xs text-ink/60">
                      <span className="font-bold uppercase tracking-widest text-[10px] text-warning">Heads up · </span>
                      Restoring publishes this article immediately, bypassing the normal
                      reject → author-edit → re-submit → approve flow. The author is not
                      asked to make further changes first.
                    </p>
                  </div>
                )}

                {detail.status === 'REJECTED' && detail.rejectionReason && (
                  <div className="mt-5 border border-terracotta/20 bg-terracotta/5 p-4">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-terracotta mb-1 flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5" /> Rejection Reason
                    </div>
                    <p className="text-sm text-ink/70">{detail.rejectionReason}</p>
                  </div>
                )}
              </div>

              {/* ── FULL ADMIN VIEW METRICS ──────────────────────────────────── */}
              <div className="border border-hairline bg-white p-6">
                <h3 className="font-serif text-lg font-bold mb-5 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-forest/60" /> View Metrics
                  <span className="text-[10px] uppercase tracking-widest text-ink/30 font-bold ml-1">(admin-only)</span>
                </h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="border border-hairline p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <Eye className="w-4 h-4 text-forest/60" />
                      <span className="text-[9px] uppercase tracking-widest text-ink/40 font-bold">Total Views</span>
                    </div>
                    <div className="font-serif text-3xl font-bold text-forest tabular-nums">{detail.metrics?.totalViews ?? 0}</div>
                  </div>
                  <div className="border border-hairline p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-4 h-4 text-terracotta-warm/60" />
                      <span className="text-[9px] uppercase tracking-widest text-ink/40 font-bold">Unique IPs</span>
                    </div>
                    <div className="font-serif text-3xl font-bold tabular-nums">{detail.metrics?.uniqueIps ?? 0}</div>
                  </div>
                  <div className="border border-hairline p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <Globe className="w-4 h-4 text-ink/40" />
                      <span className="text-[9px] uppercase tracking-widest text-ink/40 font-bold">Countries</span>
                    </div>
                    <div className="font-serif text-3xl font-bold tabular-nums">{detail.metrics?.geo?.length ?? 0}</div>
                  </div>
                  <div className="border border-hairline p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <Link2 className="w-4 h-4 text-ink/40" />
                      <span className="text-[9px] uppercase tracking-widest text-ink/40 font-bold">Referrers</span>
                    </div>
                    <div className="font-serif text-3xl font-bold tabular-nums">{detail.metrics?.referrers?.length ?? 0}</div>
                  </div>
                </div>

                {/* Daily trend sparkline (bar chart) */}
                {detail.metrics?.dailyTrend && detail.metrics.dailyTrend.length > 0 && (
                  <div className="mb-6">
                    <div className="text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-3">Daily Views (last {detail.metrics.dailyTrend.length} days)</div>
                    <DailyTrendChart trend={detail.metrics.dailyTrend} />
                  </div>
                )}

                {/* Geo + referrer breakdown */}
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-3 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5" /> Geo Breakdown
                    </div>
                    {(!detail.metrics?.geo || detail.metrics.geo.length === 0) ? (
                      <p className="text-ink/40 text-sm font-serif italic">No geo data yet.</p>
                    ) : (
                      <BreakdownBars
                        items={detail.metrics.geo.map((g) => ({
                          label: g.country || 'Unknown',
                          value: g.visitors,
                        }))}
                        unit="visitors"
                      />
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-3 flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5" /> Referrer Breakdown
                    </div>
                    {(!detail.metrics?.referrers || detail.metrics.referrers.length === 0) ? (
                      <p className="text-ink/40 text-sm font-serif italic">No referrer data yet.</p>
                    ) : (
                      <BreakdownBars
                        items={detail.metrics.referrers.map((r) => ({
                          label: r.referrer || 'Direct / None',
                          value: r.hits,
                        }))}
                        unit="hits"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* ── Tags ────────────────────────────────────────────────────── */}
              {visibleTags(detail.tags).length > 0 && (
                <div className="border border-hairline bg-white p-6">
                  <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2">
                    <Tag className="w-5 h-5 text-forest/60" /> Tags
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {visibleTags(detail.tags).map((t) => (
                      <span key={t} className="px-2.5 py-1 text-[10px] uppercase tracking-widest font-bold border border-hairline bg-alabaster text-ink/60">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Cover + Media ───────────────────────────────────────────── */}
              {(coverUrl || media.length > 0) && (
                <div className="border border-hairline bg-white p-6">
                  <h3 className="font-serif text-lg font-bold mb-4">Cover &amp; Media</h3>
                  {coverUrl && (
                    <div className="mb-5">
                      <div className="text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-2">Cover Image</div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={coverUrl}
                        alt={detail.title}
                        className="max-h-72 w-auto border border-hairline object-contain bg-parchment-dark"
                      />
                    </div>
                  )}
                  {media.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-ink/40 font-bold mb-2">
                        Attached Media ({media.length})
                      </div>
                      <MediaGallery media={media} aspect="aspect-video" />
                    </div>
                  )}
                </div>
              )}

              {/* ── Body preview ────────────────────────────────────────────── */}
              <div className="border border-hairline bg-white p-6">
                <h3 className="font-serif text-lg font-bold mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-forest/60" /> Article Body
                </h3>
                {detail.excerpt && (
                  <p className="text-sm text-ink/60 italic border-l-2 border-forest/20 pl-4 mb-6">{detail.excerpt}</p>
                )}
                {blocks.length > 0 ? (
                  <BlockRenderer blocks={blocks} />
                ) : (
                  <p className="text-ink/40 text-sm font-serif italic">This article has no rich-text body blocks.</p>
                )}
              </div>
            </div>
          ) : null}
        </section>
      )}

      {/* ── Reject Modal ──────────────────────────────────────────────────────── */}
      <Modal
        open={rejectOpen}
        onClose={() => !actionLoading && setRejectOpen(false)}
        title="Reject Article"
        dismissible={!actionLoading}
        footer={
          <>
            <button
              onClick={() => setRejectOpen(false)}
              disabled={actionLoading}
              className="px-5 py-2.5 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submitReject}
              disabled={actionLoading}
              className="px-6 py-2.5 bg-terracotta text-white text-[10px] uppercase tracking-widest font-bold hover:bg-terracotta/90 disabled:opacity-50 transition-colors"
            >
              {actionLoading ? 'Rejecting…' : 'Confirm Rejection'}
            </button>
          </>
        }
      >
        <p className="text-sm text-ink/60 mb-4">
          The reason below is required and is emailed to the author so they can edit and re-submit.
        </p>
        <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Reason *</label>
        <textarea
          rows={4}
          autoFocus
          maxLength={2000}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Explain what needs to change before this can be published…"
          className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
        />
        <div className="text-right text-[10px] text-ink/30 mt-1">{rejectReason.length}/2000</div>
      </Modal>

      {/* ── Edit Modal ────────────────────────────────────────────────────────── */}
      <Modal
        open={editOpen}
        onClose={() => !actionLoading && setEditOpen(false)}
        title="Edit Article"
        size="max-w-2xl"
        dismissible={!actionLoading}
        footer={
          <>
            <button
              onClick={() => setEditOpen(false)}
              disabled={actionLoading}
              className="px-5 py-2.5 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submitEdit}
              disabled={actionLoading}
              className="px-6 py-2.5 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors"
            >
              {actionLoading ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Title *</label>
            <input
              type="text"
              maxLength={300}
              value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Excerpt</label>
            <textarea
              rows={3}
              maxLength={600}
              value={editForm.excerpt}
              onChange={(e) => setEditForm({ ...editForm, excerpt: e.target.value })}
              className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest resize-none"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">Tags (comma-separated)</label>
            <input
              type="text"
              value={editForm.tags}
              onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
              placeholder="e.g. startups, fundraising, india"
              className="w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
            />
            <p className="text-[10px] text-ink/40 mt-1">The featured flag is managed by the Feature button and is preserved across edits.</p>
          </div>
          <p className="text-[10px] text-ink/40 border-t border-hairline pt-3">
            The rich-text body is edited by the author. Admin edits here cover title, excerpt, and tags.
          </p>
        </div>
      </Modal>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

/** Horizontal bar list for a labelled value breakdown (geo / referrers). */
function BreakdownBars({
  items,
  unit,
}: {
  items: Array<{ label: string; value: number }>;
  unit: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
      {items.map((item, i) => (
        <div key={`${item.label}-${i}`}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="truncate text-ink/70 max-w-[70%]" title={item.label}>{item.label}</span>
            <span className="font-bold tabular-nums text-ink/60">
              {item.value} <span className="text-ink/30 text-[10px] font-normal">{unit}</span>
            </span>
          </div>
          <div className="h-1.5 bg-parchment">
            <div className="h-full bg-forest" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Compact daily-views bar chart (newest-first input rendered oldest-first). */
function DailyTrendChart({
  trend,
}: {
  trend: Array<{ date: string; views: number; uniqueIps: number }>;
}) {
  // Sort by date ascending for a left→right time axis. Defensive: don't depend
  // on the backend's implicit ordering (documented as newest-first) — sort by
  // the explicit `date` field so a future ordering change can't silently flip
  // the chart.
  const ordered = [...trend].sort((a, b) => a.date.localeCompare(b.date));
  const max = Math.max(1, ...ordered.map((t) => t.views));
  return (
    <div className="border border-hairline bg-alabaster/40 p-4">
      <div className="flex items-end gap-1 h-28">
        {ordered.map((t) => (
          <div key={t.date} className="flex-1 flex flex-col justify-end group relative min-w-[3px]">
            <div
              className="bg-forest/70 group-hover:bg-forest transition-colors w-full"
              style={{ height: `${Math.max(2, (t.views / max) * 100)}%` }}
              title={`${t.date}: ${t.views} views · ${t.uniqueIps} unique`}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-2 text-[9px] uppercase tracking-widest text-ink/30 font-bold">
        <span>{ordered[0]?.date}</span>
        <span>{ordered[ordered.length - 1]?.date}</span>
      </div>
    </div>
  );
}
