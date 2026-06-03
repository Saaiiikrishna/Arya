'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Heart, ChevronLeft, ChevronRight, Filter } from 'lucide-react';

interface Donation {
  id: string;
  donorName: string | null;
  donorEmail: string | null;
  amount: number; // integer paise
  type: string;
  message: string | null;
  isAnonymous: boolean;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  status: string;
  createdAt: string;
}

interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// PaymentStatus enum (backend) — CREATED is the default/unpaid state.
const STATUS_OPTIONS = ['', 'CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED'];

const PAGE_SIZE = 20;

// Integer paise → ₹ display. Backend stores amounts as integer paise.
const formatRupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AdminDonationsPage() {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (page: number, statusFilter: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAdminDonations({
        page,
        limit: PAGE_SIZE,
        status: statusFilter || undefined,
      });
      setDonations(res.data);
      setMeta(res.meta);
    } catch (err: any) {
      setError(err?.message || 'Failed to load donations.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload from page 1 whenever the status filter changes.
  useEffect(() => {
    load(1, status);
  }, [status, load]);

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      CAPTURED: 'bg-success/10 text-success border-success/25',
      AUTHORIZED: 'bg-forest/10 text-forest border-forest/20',
      CREATED: 'bg-marigold/15 text-warning border-marigold/40',
      FAILED: 'bg-terracotta/10 text-terracotta border-terracotta/20',
      REFUNDED: 'bg-ink/5 text-ink/50 border-ink/15',
    };
    return (
      <span className={`px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${colors[s] || 'bg-ink/5 text-ink/50 border-ink/15'}`}>
        {s}
      </span>
    );
  };

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-12 flex justify-between items-end">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Contributions</h1>
          <p className="text-ink/50 mt-2 font-serif italic">Donations and support received through the platform</p>
        </div>
      </header>

      {/* Filter */}
      <div className="flex items-center gap-3 mb-6">
        <Filter className="w-4 h-4 text-ink/30" />
        <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">Status</span>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="bg-white border border-hairline px-4 py-2 text-sm focus:outline-none focus:border-forest transition-colors"
        >
          {STATUS_OPTIONS.map(s => (
            <option key={s || 'all'} value={s}>{s === '' ? 'All Statuses' : s}</option>
          ))}
        </select>
      </div>

      {/* Results */}
      <div className="border border-hairline bg-white">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-6 h-6 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-ink/40 text-xs uppercase tracking-widest">Loading Contributions</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center text-terracotta">
            <p className="font-serif italic">{error}</p>
            <button
              onClick={() => load(meta.page, status)}
              className="mt-4 px-6 py-2 border border-hairline text-[10px] uppercase tracking-widest font-bold hover:bg-alabaster transition-colors"
            >
              Retry
            </button>
          </div>
        ) : donations.length === 0 ? (
          <div className="p-12 text-center text-ink/40">
            <Heart className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="font-serif italic">No contributions found{status ? ` with status “${status}”` : ''}.</p>
          </div>
        ) : (
          <>
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
              <div className="col-span-3">Donor</div>
              <div className="col-span-3">Email</div>
              <div className="col-span-2 text-right">Amount</div>
              <div className="col-span-1">Type</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-2">Date</div>
            </div>

            {/* Table Rows */}
            {donations.map(d => (
              <div key={d.id} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm">
                <div className="col-span-3 font-bold truncate">
                  {d.isAnonymous ? <span className="text-ink/40 italic font-normal">Anonymous</span> : (d.donorName || '—')}
                </div>
                <div className="col-span-3 text-ink/60 truncate text-xs">
                  {d.isAnonymous ? '—' : (d.donorEmail || '—')}
                </div>
                <div className="col-span-2 text-right font-serif font-bold text-forest tabular-nums">
                  {formatRupees(d.amount)}
                </div>
                <div className="col-span-1 text-[10px] uppercase tracking-widest text-ink/50">
                  {d.type?.replace('_', ' ') || '—'}
                </div>
                <div className="col-span-1">{statusBadge(d.status)}</div>
                <div className="col-span-2 text-ink/40 text-xs">
                  {new Date(d.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              </div>
            ))}

            {/* Pagination */}
            <div className="flex items-center justify-between px-6 py-4 bg-alabaster/50">
              <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">
                {meta.total} total contributions · Page {meta.page} of {meta.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={meta.page <= 1}
                  onClick={() => load(meta.page - 1, status)}
                  className="p-2 border border-hairline hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => load(meta.page + 1, status)}
                  className="p-2 border border-hairline hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
