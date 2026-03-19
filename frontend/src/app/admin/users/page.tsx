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
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">{data.meta.total.toLocaleString()} total applicants</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-md items-center" style={{ marginBottom: 'var(--space-lg)' }}>
        <form onSubmit={handleSearch} className="search-bar" style={{ flex: 1, maxWidth: 400 }}>
          <span>🔍</span>
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
        <select
          className="form-input form-select"
          style={{ width: 180 }}
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
        <div className="loading-page"><div className="spinner" /> Loading...</div>
      ) : data.data.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👥</div>
          <p>No users found</p>
        </div>
      ) : (
        <>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Batch</th>
                  <th>Team</th>
                  <th>Applied</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((user) => (
                  <tr key={user.id}>
                    <td className="font-semibold">{user.firstName} {user.lastName}</td>
                    <td className="text-secondary">{user.email}</td>
                    <td><span className={`badge badge-${user.status.toLowerCase()}`}>{user.status}</span></td>
                    <td>{user.batch ? `#${user.batch.batchNumber}` : '—'}</td>
                    <td>{user.team?.name || '—'}</td>
                    <td className="text-sm text-muted">{new Date(user.appliedAt).toLocaleDateString()}</td>
                    <td>
                      <div className="flex gap-sm">
                        <Link href={`/admin/users/${user.id}`} className="btn btn-ghost btn-sm">View</Link>
                        {user.status !== 'REMOVED' && (
                          <button className="btn btn-danger btn-sm" onClick={() => handleRemove(user.id, `${user.firstName} ${user.lastName}`)}>
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
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
            {Array.from({ length: Math.min(data.meta.totalPages, 5) }, (_, i) => {
              const p = page <= 3 ? i + 1 : page - 2 + i;
              if (p > data.meta.totalPages) return null;
              return (
                <button key={p} className={p === page ? 'active' : ''} onClick={() => setPage(p)}>
                  {p}
                </button>
              );
            })}
            <button disabled={page >= data.meta.totalPages} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        </>
      )}
    </div>
  );
}
