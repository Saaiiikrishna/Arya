'use client';

/**
 * Admin → Applications.
 *
 * Two tabs over the SAME applicant data, split by submission state:
 *   - Submitted: applicants who paid the application fee (a CAPTURED payment) —
 *     i.e. a completed, submitted application.
 *   - Drafts: applicants who started but have NOT paid yet — previously INVISIBLE
 *     to admins because the legacy list hard-filtered on a captured payment.
 *
 * The split is driven server-side by the `submission` query param on
 * GET /admin/applicants (submitted | draft). Each row supports the same status
 * actions as the Users console (approve / hold / reject / restore / delete) and
 * an expandable detail panel (answers + documents) loaded lazily.
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  Inbox,
  FileEdit,
  Search,
  ChevronDown,
  CheckCircle2,
  PauseCircle,
  XCircle,
  RotateCcw,
  Trash2,
  Loader2,
} from 'lucide-react';

type Tab = 'submitted' | 'draft';

const STATUS_CONFIG: Record<string, { bg: string; text: string; border: string; label: string }> = {
  PENDING: { bg: 'bg-marigold/15', text: 'text-warning', border: 'border-marigold/40', label: 'Pending' },
  ELIGIBLE: { bg: 'bg-forest/10', text: 'text-forest', border: 'border-forest/20', label: 'Approved' },
  INELIGIBLE: { bg: 'bg-terracotta/10', text: 'text-terracotta', border: 'border-terracotta/20', label: 'Ineligible' },
  ACTIVE: { bg: 'bg-saffron/10', text: 'text-saffron-deep', border: 'border-saffron/20', label: 'Active' },
  REMOVED: { bg: 'bg-terracotta/10', text: 'text-terracotta', border: 'border-terracotta/20', label: 'Removed' },
  CONSENTED: { bg: 'bg-success/10', text: 'text-success', border: 'border-success/25', label: 'Consented' },
  FINALIZED: { bg: 'bg-terracotta-warm/10', text: 'text-terracotta-warm', border: 'border-terracotta-warm/25', label: 'Finalized' },
  TRAINING: { bg: 'bg-info/10', text: 'text-info', border: 'border-info/25', label: 'Training' },
  HELD: { bg: 'bg-ink/5', text: 'text-ink/50', border: 'border-ink/15', label: 'On Hold' },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] || { bg: 'bg-ink/5', text: 'text-ink/50', border: 'border-ink/15', label: status };
  return (
    <span className={`inline-block border px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-widest ${c.bg} ${c.text} ${c.border}`}>
      {c.label}
    </span>
  );
}

function fmtDate(s?: string): string {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Answer.value is a JSON column (any shape): string / number / boolean / array
 * (MULTISELECT) / object. Coerce to a display string so React never receives a
 * non-primitive child (which would throw "Objects are not valid as a React child").
 */
function fmtAnswer(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

interface ApplicantRow {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  status: string;
  appliedAt?: string;
  batch?: { batchNumber?: number; status?: string } | null;
  _count?: { answers?: number; documents?: number };
  [k: string]: unknown;
}

export default function ApplicationsPage() {
  const [tab, setTab] = useState<Tab>('submitted');
  const [rows, setRows] = useState<ApplicantRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);

  const PAGE_SIZE = 25;

  // Expanded detail (answers + documents), lazily loaded per applicant.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, any>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { submission: tab, page: String(page), limit: String(PAGE_SIZE) };
      if (search) params.search = search;
      const res = await api.getApplicants(params);
      setRows((res?.data as ApplicantRow[]) ?? []);
      setTotal(res?.meta?.total ?? 0);
      setTotalPages(Math.max(1, res?.meta?.totalPages ?? 1));
    } catch (e: any) {
      setError(e?.message || 'Failed to load applications.');
      setRows([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [tab, search, page]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  // Debounce the search box into `search` (resets to page 1).
  useEffect(() => {
    const h = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(h);
  }, [searchInput]);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!detail[id]) {
      setDetailLoading(id);
      try {
        const d = await api.getApplicant(id);
        setDetail((prev) => ({ ...prev, [id]: d }));
      } catch {
        setDetail((prev) => ({ ...prev, [id]: { __error: true } }));
      } finally {
        setDetailLoading(null);
      }
    }
  };

  const act = async (id: string, fn: () => Promise<unknown>, confirmMsg: string) => {
    if (!confirm(confirmMsg)) return;
    setActionId(id);
    try {
      await fn();
      await fetchRows();
    } catch (e: any) {
      alert(e?.message || 'Action failed.');
    } finally {
      setActionId(null);
    }
  };

  const setStatus = (r: ApplicantRow, status: string, label: string) =>
    act(r.id, () => api.updateApplicantStatus(r.id, status), `${label} "${r.firstName ?? ''} ${r.lastName ?? ''}"?`);

  const remove = (r: ApplicantRow) =>
    act(
      r.id,
      () => api.deleteApplicant(r.id),
      `Permanently delete the application for "${r.firstName ?? ''} ${r.lastName ?? ''}"? This cannot be undone.`,
    );

  return (
    <div className="text-ink animate-fade-in px-4 sm:px-6 lg:px-8 py-8 sm:py-12 max-w-[1200px] 3xl:max-w-[1600px] mx-auto min-h-screen">
      <header className="border-b border-hairline pb-6 mb-8">
        <p className="text-sm uppercase tracking-widest text-forest font-medium mb-2">Command Center</p>
        <h1 className="font-serif text-3xl sm:text-4xl font-bold leading-none">Applications</h1>
        <p className="mt-3 text-ink/60 font-sans text-sm max-w-2xl">
          Submitted applications are those that completed the application-fee payment. Drafts were
          started but not paid yet — review their progress or remove stale ones.
        </p>
      </header>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6 border-b border-hairline">
        {([
          { id: 'submitted', label: 'Submitted', Icon: Inbox },
          { id: 'draft', label: 'Drafts', Icon: FileEdit },
        ] as { id: Tab; label: string; Icon: typeof Inbox }[]).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setExpandedId(null);
              setPage(1);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 font-sans text-[11px] font-bold uppercase tracking-widest transition-colors -mb-px border-b-2 cursor-pointer ${
              tab === id
                ? 'border-forest text-forest'
                : 'border-transparent text-ink/45 hover:text-forest'
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden />
            {label}
            {tab === id && <span className="ml-1 text-ink/40">({total})</span>}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-5 flex items-center gap-3 border border-hairline bg-white px-4 py-2.5 max-w-md focus-within:border-forest transition-colors">
        <Search className="w-4 h-4 shrink-0 text-ink/40" aria-hidden />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name or email…"
          aria-label="Search applications"
          className="w-full border-0 bg-transparent p-0 font-sans text-sm text-ink outline-none placeholder:text-ink/40"
        />
      </div>

      {/* States */}
      {loading ? (
        <div className="flex items-center gap-3 text-ink/50 py-16 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
          <span className="font-sans text-xs uppercase tracking-widest">Loading applications</span>
        </div>
      ) : error ? (
        <div className="border border-terracotta/30 bg-terracotta/5 p-6 text-center">
          <p className="text-terracotta font-sans text-sm">{error}</p>
          <button type="button" onClick={() => void fetchRows()} className="mt-3 border border-forest text-forest px-4 py-2 font-sans text-[10px] uppercase tracking-widest hover:bg-forest hover:text-white transition-colors">
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="border border-hairline bg-white p-12 text-center">
          <p className="font-serif text-xl text-forest mb-1">No {tab === 'draft' ? 'drafts' : 'submitted applications'}</p>
          <p className="text-ink/50 font-sans text-sm">
            {tab === 'draft'
              ? 'Every applicant who started has completed payment, or none have started yet.'
              : 'No applicants have completed the application-fee payment yet.'}
          </p>
        </div>
      ) : (
        <div className="border border-hairline bg-white">
          {/* Header row (md+) */}
          <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-3 border-b border-hairline bg-parchment/50 font-sans text-[10px] font-bold uppercase tracking-widest text-ink/45">
            <span>Applicant</span>
            <span>Status</span>
            <span>{tab === 'draft' ? 'Progress' : 'Applied'}</span>
            <span className="text-right">Actions</span>
          </div>

          {rows.map((r) => {
            const name = `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || '(no name)';
            const isExpanded = expandedId === r.id;
            const busy = actionId === r.id;
            return (
              <Fragment key={r.id}>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3 md:gap-4 px-5 py-4 border-b border-hairline items-center">
                  {/* Applicant */}
                  <button type="button" onClick={() => void toggleExpand(r.id)} className="flex items-center gap-3 text-left cursor-pointer min-w-0">
                    <ChevronDown className={`w-4 h-4 shrink-0 text-ink/40 transition-transform ${isExpanded ? 'rotate-180' : ''}`} aria-hidden />
                    <span className="min-w-0">
                      <span className="block font-sans text-sm font-semibold text-ink truncate">{name}</span>
                      <span className="block font-sans text-xs text-ink/50 truncate">{r.email ?? '—'}</span>
                    </span>
                  </button>

                  {/* Status */}
                  <div className="md:px-2"><StatusBadge status={r.status} /></div>

                  {/* Applied / Progress */}
                  <div className="font-sans text-xs text-ink/55">
                    {tab === 'draft'
                      ? `${r._count?.answers ?? 0} answers · ${r._count?.documents ?? 0} docs`
                      : fmtDate(r.appliedAt)}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1.5">
                    {busy ? (
                      <Loader2 className="w-4 h-4 animate-spin text-ink/40" aria-hidden />
                    ) : (
                      <>
                        {r.status !== 'ELIGIBLE' && (
                          <button type="button" title="Approve" onClick={() => setStatus(r, 'ELIGIBLE', 'Approve')} className="p-1.5 border border-hairline text-forest hover:bg-forest hover:text-white transition-colors" aria-label="Approve">
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        {r.status !== 'HELD' && (
                          <button type="button" title="Hold" onClick={() => setStatus(r, 'HELD', 'Hold')} className="p-1.5 border border-hairline text-ink/60 hover:bg-ink/10 transition-colors" aria-label="Hold">
                            <PauseCircle className="w-4 h-4" />
                          </button>
                        )}
                        {r.status !== 'REMOVED' ? (
                          <button type="button" title="Reject" onClick={() => setStatus(r, 'REMOVED', 'Reject')} className="p-1.5 border border-hairline text-terracotta hover:bg-terracotta hover:text-white transition-colors" aria-label="Reject">
                            <XCircle className="w-4 h-4" />
                          </button>
                        ) : (
                          <button type="button" title="Restore" onClick={() => setStatus(r, 'PENDING', 'Restore')} className="p-1.5 border border-hairline text-info hover:bg-info hover:text-white transition-colors" aria-label="Restore">
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        <button type="button" title="Delete permanently" onClick={() => remove(r)} className="p-1.5 border border-hairline text-terracotta/70 hover:bg-terracotta hover:text-white transition-colors" aria-label="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-5 py-5 border-b border-hairline bg-parchment/30">
                    {detailLoading === r.id ? (
                      <div className="flex items-center gap-2 text-ink/50">
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                        <span className="font-sans text-xs uppercase tracking-widest">Loading details</span>
                      </div>
                    ) : detail[r.id]?.__error ? (
                      <p className="text-terracotta font-sans text-sm">Failed to load details.</p>
                    ) : detail[r.id] ? (
                      <div className="grid gap-6 md:grid-cols-2">
                        <div>
                          <h3 className="font-sans text-[10px] font-bold uppercase tracking-widest text-ink/45 mb-3">Answers</h3>
                          {Array.isArray(detail[r.id].answers) && detail[r.id].answers.length > 0 ? (
                            <ul className="space-y-3">
                              {detail[r.id].answers.map((a: any, i: number) => (
                                <li key={a.id ?? i} className="border-l-2 border-hairline pl-3">
                                  <p className="font-sans text-xs font-semibold text-forest">
                                    {a.question?.label ?? 'Question'}
                                  </p>
                                  <p className="font-sans text-sm text-ink/75 whitespace-pre-wrap break-words">
                                    {fmtAnswer(a.value)}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="font-sans text-sm text-ink/40 italic">No answers submitted.</p>
                          )}
                        </div>
                        <div>
                          <h3 className="font-sans text-[10px] font-bold uppercase tracking-widest text-ink/45 mb-3">Documents</h3>
                          {Array.isArray(detail[r.id].documents) && detail[r.id].documents.length > 0 ? (
                            <ul className="space-y-2">
                              {detail[r.id].documents.map((d: any, i: number) => (
                                <li key={d.id ?? i} className="flex items-center justify-between gap-3 border border-hairline px-3 py-2">
                                  <span className="font-sans text-xs text-ink truncate">{d.fileName ?? d.type ?? 'Document'}</span>
                                  <StatusBadge status={d.status ?? 'PENDING'} />
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="font-sans text-sm text-ink/40 italic">No documents uploaded.</p>
                          )}
                          <Link
                            href="/admin/users"
                            className="inline-block mt-4 font-sans text-[10px] uppercase tracking-widest text-forest hover:text-saffron-deep transition-colors"
                          >
                            Full document management →
                          </Link>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && rows.length > 0 && totalPages > 1 && (
        <div className="mt-5 flex items-center justify-between gap-4">
          <span className="font-sans text-[11px] uppercase tracking-widest text-ink/45">
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="border border-hairline px-3 py-1.5 font-sans text-[10px] font-bold uppercase tracking-widest text-forest transition-colors hover:bg-forest hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-forest"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="border border-hairline px-3 py-1.5 font-sans text-[10px] font-bold uppercase tracking-widest text-forest transition-colors hover:bg-forest hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-forest"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
