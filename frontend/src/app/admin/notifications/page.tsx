'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import {
  Bell, Mail, MessageCircle, Smartphone, Search, RotateCw,
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, Clock,
} from 'lucide-react';

interface NotificationApplicant {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface NotificationRecord {
  id: string;
  applicantId: string;
  type: 'EMAIL' | 'WHATSAPP' | 'IN_APP';
  subject: string;
  body: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  metadata: Record<string, any> | null;
  sentAt: string | null;
  createdAt: string;
  applicant: NotificationApplicant | null;
}

interface ListMeta {
  total: number;
  page: number;
  totalPages: number;
}

const TYPE_FILTERS = ['ALL', 'EMAIL', 'WHATSAPP', 'IN_APP'] as const;
const STATUS_FILTERS = ['ALL', 'SENT', 'FAILED', 'PENDING'] as const;
const PAGE_LIMIT = 25;

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [meta, setMeta] = useState<ListMeta>({ total: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  // Filters
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>('ALL');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [applicantId, setApplicantId] = useState('');
  const [applicantInput, setApplicantInput] = useState('');

  // Per-row resend state
  const [resendingId, setResendingId] = useState<string | null>(null);

  const load = useCallback(
    async (page: number) => {
      setLoading(true);
      try {
        const res = await api.listNotifications({
          page,
          limit: PAGE_LIMIT,
          type: typeFilter === 'ALL' ? undefined : typeFilter,
          status: statusFilter === 'ALL' ? undefined : statusFilter,
          applicantId: applicantId.trim() || undefined,
        });
        setNotifications(res.data ?? []);
        setMeta(res.meta ?? { total: 0, page, totalPages: 1 });
      } catch (err: any) {
        console.error(err);
        alert(err?.message || 'Failed to load notifications');
      } finally {
        setLoading(false);
      }
    },
    [typeFilter, statusFilter, applicantId],
  );

  // Reload from page 1 whenever any filter changes.
  useEffect(() => {
    load(1);
  }, [load]);

  const handleResend = async (n: NotificationRecord) => {
    if (n.type !== 'EMAIL') return;
    if (!confirm('Re-send this email notification to the applicant?')) return;
    setResendingId(n.id);
    try {
      const res = await api.resendNotification(n.id);
      if (res?.success) {
        alert('Email re-sent successfully. A new log entry was created.');
      } else {
        alert('Re-send attempt completed but delivery failed. Check the new FAILED log entry.');
      }
      // Refresh current page so the freshly logged row appears.
      load(meta.page);
    } catch (err: any) {
      alert(err?.message || 'Failed to re-send notification');
    } finally {
      setResendingId(null);
    }
  };

  const applyApplicantFilter = () => {
    setApplicantId(applicantInput.trim());
  };

  const clearApplicantFilter = () => {
    setApplicantInput('');
    setApplicantId('');
  };

  const typeBadge = (type: NotificationRecord['type']) => {
    const map: Record<NotificationRecord['type'], { label: string; cls: string; icon: React.ReactNode }> = {
      EMAIL: {
        label: 'Email',
        cls: 'bg-forest/10 text-forest border-forest/20',
        icon: <Mail className="w-3 h-3" />,
      },
      WHATSAPP: {
        label: 'WhatsApp',
        cls: 'bg-success/10 text-success border-success/25',
        icon: <MessageCircle className="w-3 h-3" />,
      },
      IN_APP: {
        label: 'In-App',
        cls: 'bg-ink/5 text-ink/60 border-ink/15',
        icon: <Smartphone className="w-3 h-3" />,
      },
    };
    const t = map[type];
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${t.cls}`}>
        {t.icon}
        {t.label}
      </span>
    );
  };

  const statusBadge = (status: NotificationRecord['status']) => {
    const map: Record<NotificationRecord['status'], { cls: string; icon: React.ReactNode }> = {
      SENT: { cls: 'bg-success/10 text-success border-success/25', icon: <CheckCircle2 className="w-3 h-3" /> },
      FAILED: { cls: 'bg-terracotta/10 text-terracotta border-terracotta/20', icon: <XCircle className="w-3 h-3" /> },
      PENDING: { cls: 'bg-marigold/15 text-warning border-marigold/40', icon: <Clock className="w-3 h-3" /> },
    };
    const s = map[status];
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${s.cls}`}>
        {s.icon}
        {status}
      </span>
    );
  };

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none flex items-center gap-4">
            <Bell className="w-10 h-10" />
            Notification Log
          </h1>
          <p className="text-ink/50 mt-2 font-serif italic">
            Audit every email &amp; WhatsApp dispatch — re-send failed emails.
          </p>
        </div>
      </header>

      {/* Filters */}
      <section className="mb-8 space-y-5">
        {/* Type filter */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold w-16">Channel</span>
          <div className="flex flex-wrap gap-2">
            {TYPE_FILTERS.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-4 py-2 text-[10px] uppercase tracking-widest font-bold border transition-colors ${
                  typeFilter === t
                    ? 'bg-saffron text-parchment border-saffron'
                    : 'bg-white text-ink/50 border-hairline hover:border-saffron hover:text-saffron-deep'
                }`}
              >
                {t === 'ALL' ? 'All' : t === 'IN_APP' ? 'In-App' : t === 'WHATSAPP' ? 'WhatsApp' : 'Email'}
              </button>
            ))}
          </div>
        </div>

        {/* Status filter */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold w-16">Status</span>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-4 py-2 text-[10px] uppercase tracking-widest font-bold border transition-colors ${
                  statusFilter === s
                    ? 'bg-forest text-parchment border-forest'
                    : 'bg-white text-ink/50 border-hairline hover:border-forest hover:text-forest'
                }`}
              >
                {s === 'ALL' ? 'All' : s}
              </button>
            ))}
          </div>
        </div>

        {/* Applicant filter */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold w-16">Applicant</span>
          <div className="flex-1 min-w-[260px] relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/30" />
            <input
              type="text"
              placeholder="Filter by applicant ID (UUID)…"
              className="w-full bg-white border border-hairline pl-12 pr-4 py-2.5 text-sm focus:outline-none focus:border-forest transition-colors"
              value={applicantInput}
              onChange={(e) => setApplicantInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyApplicantFilter();
              }}
            />
          </div>
          <button
            onClick={applyApplicantFilter}
            className="px-5 py-2.5 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep transition-colors"
          >
            Filter
          </button>
          {applicantId && (
            <button
              onClick={clearApplicantFilter}
              className="px-5 py-2.5 border border-ink/20 text-ink/50 text-[10px] uppercase tracking-widest font-bold hover:border-terracotta hover:text-terracotta transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </section>

      {/* Table */}
      <div className="border border-hairline bg-white">
        {loading ? (
          <div className="p-16 text-center">
            <div className="w-6 h-6 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-ink/40 text-xs uppercase tracking-widest">Loading notifications…</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-16 text-center text-ink/40">
            <Bell className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="font-serif italic">No notifications match the current filters.</p>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
              <div className="col-span-2">Channel</div>
              <div className="col-span-3">Recipient</div>
              <div className="col-span-3">Subject</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-2">Sent / Created</div>
              <div className="col-span-1 text-right">Action</div>
            </div>

            {/* Rows */}
            {notifications.map((n) => (
              <div
                key={n.id}
                className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm"
              >
                <div className="col-span-2">{typeBadge(n.type)}</div>
                <div className="col-span-3 min-w-0">
                  {n.applicant ? (
                    <>
                      <div className="font-bold truncate">
                        {n.applicant.firstName} {n.applicant.lastName}
                      </div>
                      <div className="text-[11px] text-ink/40 truncate">{n.applicant.email}</div>
                    </>
                  ) : (
                    <span className="text-ink/40 text-xs">— deleted applicant —</span>
                  )}
                </div>
                <div className="col-span-3 text-ink/70 text-xs truncate" title={n.subject}>
                  {n.subject || '—'}
                </div>
                <div className="col-span-1">{statusBadge(n.status)}</div>
                <div className="col-span-2 text-ink/40 text-[11px]">{fmtDate(n.sentAt ?? n.createdAt)}</div>
                <div className="col-span-1 flex justify-end">
                  {n.type === 'EMAIL' ? (
                    <button
                      onClick={() => handleResend(n)}
                      disabled={resendingId === n.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-forest/30 text-forest text-[9px] uppercase tracking-widest font-bold hover:bg-forest/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Re-send this email notification"
                    >
                      <RotateCw className={`w-3 h-3 ${resendingId === n.id ? 'animate-spin' : ''}`} />
                      {resendingId === n.id ? 'Sending' : 'Resend'}
                    </button>
                  ) : (
                    <span
                      className="text-[9px] uppercase tracking-widest text-ink/25 font-bold cursor-help"
                      title="Only email notifications can be re-sent from the log. Re-trigger the milestone to resend WhatsApp."
                    >
                      N/A
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* Pagination */}
            <div className="flex items-center justify-between px-6 py-4 bg-alabaster/50">
              <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">
                {meta.total} total · Page {meta.page} of {meta.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={meta.page <= 1 || loading}
                  onClick={() => load(meta.page - 1)}
                  className="p-2 border border-hairline hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  disabled={meta.page >= meta.totalPages || loading}
                  onClick={() => load(meta.page + 1)}
                  className="p-2 border border-hairline hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footnote on resend semantics */}
      <p className="text-[10px] uppercase tracking-widest text-ink/30 font-bold mt-6">
        Note · Re-send is available for email rows only. WhatsApp templates cannot be reconstructed from the log — re-trigger the underlying milestone instead.
      </p>
    </div>
  );
}
