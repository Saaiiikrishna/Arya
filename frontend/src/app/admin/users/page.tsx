'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

export default function UsersPage() {
  const [data, setData] = useState<{ data: any[]; meta: any }>({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const loadUsers = async () => {
    setLoading(true);
    const params: Record<string, string> = { page: String(page), limit: '20' };
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    try {
      const result = await api.getApplicants(params);
      setData(result);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, [page, statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadUsers();
  };

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`Remove ${name}? This will trigger backfill from the next batch.`)) return;
    try {
      await api.removeApplicant(id);
      loadUsers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const statuses = ['', 'PENDING', 'ELIGIBLE', 'INELIGIBLE', 'ACTIVE', 'REMOVED', 'CONSENTED', 'FINALIZED'];

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Users & Roster</h1>
        </div>
        <div className="text-left md:text-right">
          <p className="text-3xl font-serif text-terracotta mb-1">{data.meta.total.toLocaleString()}</p>
          <p className="text-sm text-ink/40 uppercase tracking-widest">Total Applicants</p>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-6 items-center mb-12 border border-hairline bg-white p-6">
        <form onSubmit={handleSearch} className="flex-1 flex gap-4 w-full">
          <span className="text-2xl mt-2 text-ink/40">🔍</span>
          <input
            type="text"
            placeholder="Search by name or email..."
            className="w-full bg-transparent border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="bg-ink hover:bg-terracotta text-white px-8 py-3 text-xs uppercase tracking-widest font-semibold transition-colors hidden sm:block">Search</button>
        </form>
        <div className="w-px h-12 bg-hairline hidden md:block"></div>
        <select
          className="w-full md:w-64 bg-transparent border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors outline-none cursor-pointer"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">All Statuses</option>
          {statuses.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-ink">
          <div className="w-12 h-12 bg-forest/10 flex items-center justify-center border border-forest/20 mb-6 animate-pulse">
            <span className="font-serif text-xl font-bold text-forest">...</span>
          </div>
          <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Directory...</p>
        </div>
      ) : data.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-6 border border-dashed border-ink/20 bg-parchment/50 text-center">
          <div className="text-4xl mb-4">👥</div>
          <h3 className="font-serif text-2xl font-bold mb-2">No Records Found</h3>
          <p className="text-ink/60">Adjust your search parameters or filters to locate members.</p>
        </div>
      ) : (
        <>
          <div className="border border-hairline bg-white overflow-x-auto shadow-sm">
            <table className="w-full text-left font-sans">
              <thead className="bg-parchment/80 border-b border-hairline">
                <tr>
                  <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Name</th>
                  <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Email</th>
                  <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Status</th>
                  <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Batch</th>
                  <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Team</th>
                  <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Applied</th>
                  <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((user) => (
                  <tr key={user.id} className="border-b border-hairline last:border-0 hover:bg-parchment/30 transition-colors">
                    <td className="px-6 py-5 font-serif text-xl font-bold">{user.firstName} {user.lastName}</td>
                    <td className="px-6 py-5 text-ink/60 text-sm">{user.email}</td>
                    <td className="px-6 py-5">
                      <span className={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold border ${user.status === 'REMOVED' ? 'bg-terracotta/10 text-terracotta border-terracotta/20' : 'bg-forest/10 text-forest border-forest/20'}`}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-6 py-5 font-serif text-lg">{user.batch ? `#${user.batch.batchNumber}` : '—'}</td>
                    <td className="px-6 py-5 text-sm">{user.team?.name || '—'}</td>
                    <td className="px-6 py-5 text-[11px] text-ink/40 uppercase tracking-widest">{new Date(user.appliedAt).toLocaleDateString()}</td>
                    <td className="px-6 py-5">
                      <div className="flex gap-4">
                        <Link href={`/admin/users/${user.id}`} className="text-[11px] uppercase tracking-widest font-bold text-forest hover:text-ink transition-colors">View</Link>
                        {user.status !== 'REMOVED' && (
                          <button className="text-[11px] uppercase tracking-widest font-bold text-terracotta hover:text-ink transition-colors" onClick={() => handleRemove(user.id, `${user.firstName} ${user.lastName}`)}>
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-12 flex justify-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-4 py-2 border border-hairline bg-white text-xs uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-parchment transition-colors font-semibold">← Prev</button>
            {Array.from({ length: Math.min(data.meta.totalPages, 5) }, (_, i) => {
              const p = page <= 3 ? i + 1 : page - 2 + i;
              if (p > data.meta.totalPages) return null;
              return (
                <button key={p} className={`px-4 py-2 border border-hairline text-xs uppercase tracking-widest transition-colors font-semibold ${p === page ? 'bg-forest text-white border-forest' : 'bg-white hover:bg-parchment'}`} onClick={() => setPage(p)}>
                  {p}
                </button>
              );
            })}
            <button disabled={page >= data.meta.totalPages} onClick={() => setPage(page + 1)} className="px-4 py-2 border border-hairline bg-white text-xs uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-parchment transition-colors font-semibold">Next →</button>
          </div>
        </>
      )}
    </div>
  );
}
