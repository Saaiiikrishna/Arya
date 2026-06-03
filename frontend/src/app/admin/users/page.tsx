'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

const STATUS_CONFIG: Record<string, { bg: string; text: string; border: string; label: string }> = {
  PENDING:   { bg: 'bg-marigold/15',        text: 'text-warning',         border: 'border-marigold/40', label: 'Pending' },
  ELIGIBLE:  { bg: 'bg-forest/10',          text: 'text-forest',          border: 'border-forest/20', label: 'Approved' },
  INELIGIBLE:{ bg: 'bg-terracotta/10',      text: 'text-terracotta',      border: 'border-terracotta/20', label: 'Ineligible' },
  ACTIVE:    { bg: 'bg-saffron/10',         text: 'text-saffron-deep',    border: 'border-saffron/20', label: 'Active' },
  REMOVED:   { bg: 'bg-terracotta/10',      text: 'text-terracotta',      border: 'border-terracotta/20', label: 'Rejected' },
  CONSENTED: { bg: 'bg-success/10',         text: 'text-success',         border: 'border-success/25', label: 'Consented' },
  FINALIZED: { bg: 'bg-terracotta-warm/10', text: 'text-terracotta-warm', border: 'border-terracotta-warm/25', label: 'Finalized' },
  TRAINING:  { bg: 'bg-info/10',            text: 'text-info',            border: 'border-info/25', label: 'Training' },
  HELD:      { bg: 'bg-ink/5',              text: 'text-ink/50',          border: 'border-ink/15', label: 'On Hold' },
};

// DocumentStatus enum (PENDING | UPLOADED | VERIFIED) → badge styling.
const DOC_STATUS_CONFIG: Record<string, { bg: string; text: string; border: string; label: string }> = {
  PENDING:  { bg: 'bg-marigold/15', text: 'text-warning', border: 'border-marigold/40', label: 'Pending' },
  UPLOADED: { bg: 'bg-info/10',     text: 'text-info',    border: 'border-info/25',     label: 'Uploaded' },
  VERIFIED: { bg: 'bg-success/10',  text: 'text-success', border: 'border-success/25',  label: 'Verified' },
};

export default function UsersPage() {
  const [data, setData] = useState<{ data: any[]; meta: any }>({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // Per-applicant documents, keyed by applicant id, loaded lazily on expand.
  const [docs, setDocs] = useState<Record<string, any[]>>({});
  const [docsLoading, setDocsLoading] = useState<string | null>(null);
  const [docsError, setDocsError] = useState<Record<string, string>>({});
  // Tracks an in-flight per-document action (download/verify), keyed by document id.
  const [docActionLoading, setDocActionLoading] = useState<string | null>(null);

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

  const handleStatusAction = async (id: string, status: string, actionLabel: string, name: string) => {
    if (!confirm(`${actionLabel} "${name}"?`)) return;
    setActionLoading(id);
    try {
      await api.updateApplicantStatus(id, status);
      loadUsers();
    } catch (err: any) {
      alert(err.message || `Failed to ${actionLabel.toLowerCase()}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`Remove ${name}? This action will mark them as rejected.`)) return;
    setActionLoading(id);
    try {
      await api.updateApplicantStatus(id, 'REMOVED');
      loadUsers();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Permanently delete application for ${name}? This action cannot be undone.`)) return;
    setActionLoading(id);
    try {
      await api.deleteApplicant(id);
      loadUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to delete');
    } finally {
      setActionLoading(null);
    }
  };

  const loadDocs = async (applicantId: string) => {
    setDocsLoading(applicantId);
    setDocsError((prev) => { const next = { ...prev }; delete next[applicantId]; return next; });
    try {
      const result = await api.getApplicantDocuments(applicantId);
      setDocs((prev) => ({ ...prev, [applicantId]: result }));
    } catch (err: any) {
      setDocsError((prev) => ({ ...prev, [applicantId]: err.message || 'Failed to load documents' }));
    } finally {
      setDocsLoading(null);
    }
  };

  const toggleExpand = (applicantId: string) => {
    const next = expandedId === applicantId ? null : applicantId;
    setExpandedId(next);
    // Lazy-load documents the first time a row is expanded.
    if (next && docs[next] === undefined) loadDocs(next);
  };

  const handleDownloadDoc = async (documentId: string) => {
    setDocActionLoading(documentId);
    try {
      const res = await api.downloadDocument(documentId);
      const url = res?.downloadUrl;
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        alert('No download URL was returned for this document.');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to generate download link');
    } finally {
      setDocActionLoading(null);
    }
  };

  const handleVerifyDoc = async (documentId: string, applicantId: string) => {
    if (!confirm('Mark this document as verified?')) return;
    setDocActionLoading(documentId);
    try {
      await api.verifyDocument(documentId);
      await loadDocs(applicantId);
    } catch (err: any) {
      alert(err.message || 'Failed to verify document');
    } finally {
      setDocActionLoading(null);
    }
  };

  const formatFileSize = (bytes?: number | null) => {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statuses = ['', 'PENDING', 'HELD', 'ELIGIBLE', 'INELIGIBLE', 'ACTIVE', 'REMOVED', 'CONSENTED', 'FINALIZED', 'TRAINING'];

  const getStatusBadge = (status: string) => {
    const cfg = STATUS_CONFIG[status] || { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', label: status };
    return (
      <span className={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
        {cfg.label}
      </span>
    );
  };

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
          <p className="text-3xl font-serif text-terracotta-warm mb-1">{data.meta.total.toLocaleString()}</p>
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
          <button type="submit" className="bg-ink hover:bg-terracotta-warm text-white px-8 py-3 text-xs uppercase tracking-widest font-semibold transition-colors hidden sm:block">Search</button>
        </form>
        <div className="w-px h-12 bg-hairline hidden md:block"></div>
        <select
          className="w-full md:w-64 bg-transparent border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors outline-none cursor-pointer"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">All Statuses</option>
          {statuses.filter(Boolean).map((s) => (
            <option key={s} value={s}>{STATUS_CONFIG[s]?.label || s}</option>
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
                  <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Applied</th>
                  <th className="px-6 py-5 text-xs font-bold uppercase tracking-widest text-ink/60">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((user) => (
                  <>
                    <tr key={user.id} className={`border-b border-hairline last:border-0 hover:bg-parchment/30 transition-colors ${expandedId === user.id ? 'bg-parchment/40' : ''}`}>
                      <td className="px-6 py-5 font-serif text-lg font-bold">
                        <button onClick={() => toggleExpand(user.id)} className="text-left hover:text-forest transition-colors">
                          {user.firstName} {user.lastName}
                          <span className="ml-2 text-ink/30 text-sm">{expandedId === user.id ? '▲' : '▼'}</span>
                        </button>
                      </td>
                      <td className="px-6 py-5 text-ink/60 text-sm">{user.email}</td>
                      <td className="px-6 py-5">{getStatusBadge(user.status)}</td>
                      <td className="px-6 py-5 font-serif text-lg">{user.batch ? `#${user.batch.batchNumber}` : '—'}</td>
                      <td className="px-6 py-5 text-[11px] text-ink/40 uppercase tracking-widest">{new Date(user.appliedAt).toLocaleDateString()}</td>
                      <td className="px-6 py-5">
                        <div className="flex gap-3 items-center flex-wrap">
                          {actionLoading === user.id ? (
                            <span className="text-[10px] uppercase tracking-widest text-ink/40 animate-pulse">Processing...</span>
                          ) : (
                            <>
                              {/* Approve: set ELIGIBLE */}
                              {user.status !== 'ELIGIBLE' && user.status !== 'REMOVED' && user.status !== 'ACTIVE' && (
                                <button
                                  className="text-[10px] uppercase tracking-widest font-bold text-forest hover:text-forest-deep transition-colors px-2 py-1 border border-forest/20 bg-forest/10 hover:bg-forest/20"
                                  onClick={() => handleStatusAction(user.id, 'ELIGIBLE', 'Approve', `${user.firstName} ${user.lastName}`)}
                                >
                                  ✓ Approve
                                </button>
                              )}
                              {/* Hold: set HELD */}
                              {user.status !== 'HELD' && user.status !== 'REMOVED' && (
                                <button
                                  className="text-[10px] uppercase tracking-widest font-bold text-ink/50 hover:text-ink transition-colors px-2 py-1 border border-ink/15 bg-ink/5 hover:bg-ink/10"
                                  onClick={() => handleStatusAction(user.id, 'HELD', 'Hold', `${user.firstName} ${user.lastName}`)}
                                >
                                  ⏸ Hold
                                </button>
                              )}
                              {/* Reject: set REMOVED */}
                              {user.status !== 'REMOVED' && (
                                <button
                                  className="text-[10px] uppercase tracking-widest font-bold text-terracotta hover:text-terracotta-warm transition-colors px-2 py-1 border border-terracotta/20 bg-terracotta/5 hover:bg-terracotta/10"
                                  onClick={() => handleRemove(user.id, `${user.firstName} ${user.lastName}`)}
                                >
                                  ✕ Reject
                                </button>
                              )}
                              {/* Re-activate from REMOVED */}
                              {user.status === 'REMOVED' && (
                                <button
                                  className="text-[10px] uppercase tracking-widest font-bold text-forest hover:text-forest/80 transition-colors px-2 py-1 border border-forest/20 bg-forest/5 hover:bg-forest/10"
                                  onClick={() => handleStatusAction(user.id, 'PENDING', 'Restore', `${user.firstName} ${user.lastName}`)}
                                >
                                  ↺ Restore
                                </button>
                              )}
                              {/* Delete completely */}
                              <button
                                className="text-[10px] uppercase tracking-widest font-bold text-parchment bg-terracotta hover:bg-[#7a0c03] transition-colors px-2 py-1 border border-terracotta"
                                onClick={() => handleDelete(user.id, `${user.firstName} ${user.lastName}`)}
                              >
                                ✕ Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    
                    {/* Expandable Detail Row */}
                    {expandedId === user.id && (
                      <tr key={`${user.id}-detail`} className="bg-parchment/30">
                        <td colSpan={6} className="px-6 py-8">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            {/* Personal Info */}
                            <div className="border border-hairline bg-white p-5">
                              <h4 className="text-[10px] uppercase tracking-widest text-forest font-bold mb-4 pb-2 border-b border-hairline">Personal Info</h4>
                              <div className="space-y-2 text-sm">
                                <p><span className="text-ink/40 w-20 inline-block">Phone:</span> {user.phone || '—'}</p>
                                <p><span className="text-ink/40 w-20 inline-block">City:</span> {user.city || '—'}</p>
                                <p><span className="text-ink/40 w-20 inline-block">Age:</span> {user.age || '—'}</p>
                                <p><span className="text-ink/40 w-20 inline-block">Team:</span> {user.team?.name || '—'}</p>
                              </div>
                            </div>

                            {/* Dossier */}
                            <div className="border border-hairline bg-white p-5">
                              <h4 className="text-[10px] uppercase tracking-widest text-forest font-bold mb-4 pb-2 border-b border-hairline">Dossier</h4>
                              <div className="space-y-3 text-sm">
                                {user.vocation && (
                                  <div>
                                    <span className="text-ink/40 text-[10px] uppercase tracking-widest block mb-1">Vocation</span>
                                    <p className="font-serif italic">{user.vocation}</p>
                                  </div>
                                )}
                                {user.obsession && (
                                  <div>
                                    <span className="text-ink/40 text-[10px] uppercase tracking-widest block mb-1">Obsession</span>
                                    <p className="text-ink/70 leading-relaxed line-clamp-3">{user.obsession}</p>
                                  </div>
                                )}
                                {user.heresy && (
                                  <div>
                                    <span className="text-ink/40 text-[10px] uppercase tracking-widest block mb-1">Heresy</span>
                                    <p className="text-ink/70 leading-relaxed line-clamp-3">{user.heresy}</p>
                                  </div>
                                )}
                                {user.scarTissue && (
                                  <div>
                                    <span className="text-ink/40 text-[10px] uppercase tracking-widest block mb-1">Scar Tissue</span>
                                    <p className="text-ink/70 leading-relaxed line-clamp-3">{user.scarTissue}</p>
                                  </div>
                                )}
                                {!user.vocation && !user.obsession && (
                                  <p className="text-ink/30 italic">No dossier submitted yet</p>
                                )}
                              </div>
                            </div>

                            {/* Matching Profile */}
                            <div className="border border-hairline bg-white p-5">
                              <h4 className="text-[10px] uppercase tracking-widest text-forest font-bold mb-4 pb-2 border-b border-hairline">Skills & Matching</h4>
                              {user.matchingProfile ? (
                                <div className="space-y-3 text-sm">
                                  {user.matchingProfile.skills?.length > 0 && (
                                    <div>
                                      <span className="text-ink/40 text-[10px] uppercase tracking-widest block mb-2">Skills</span>
                                      <div className="flex flex-wrap gap-1">
                                        {user.matchingProfile.skills.map((s: string) => (
                                          <span key={s} className="bg-forest/10 text-forest px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border border-forest/20">{s}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <p><span className="text-ink/40">Commitment:</span> {user.matchingProfile.commitmentLevel || '—'}</p>
                                  <p><span className="text-ink/40">Hours/Day:</span> {user.matchingProfile.hoursPerDay || '—'}</p>
                                  <p><span className="text-ink/40">Has Idea:</span> {user.matchingProfile.hasIdea ? 'Yes' : 'No'}</p>
                                  {user.matchingProfile.ideaCategory && (
                                    <p><span className="text-ink/40">Category:</span> {user.matchingProfile.ideaCategory}</p>
                                  )}
                                </div>
                              ) : (
                                <p className="text-ink/30 italic text-sm">No matching profile yet</p>
                              )}
                            </div>
                          </div>

                          {/* Documents */}
                          <div className="border border-hairline bg-white p-5 mt-8">
                            <h4 className="text-[10px] uppercase tracking-widest text-forest font-bold mb-4 pb-2 border-b border-hairline flex items-center justify-between">
                              <span>Documents</span>
                              <button
                                onClick={() => loadDocs(user.id)}
                                disabled={docsLoading === user.id}
                                className="text-[9px] uppercase tracking-widest font-bold text-ink/40 hover:text-forest transition-colors disabled:opacity-40"
                              >
                                ↻ Refresh
                              </button>
                            </h4>

                            {docsLoading === user.id ? (
                              <p className="uppercase tracking-widest text-[10px] font-semibold text-ink/50 animate-pulse py-2">Loading documents...</p>
                            ) : docsError[user.id] ? (
                              <p className="text-terracotta text-sm py-2">{docsError[user.id]}</p>
                            ) : (docs[user.id]?.length ?? 0) === 0 ? (
                              <p className="text-ink/30 italic text-sm py-2">No documents uploaded yet</p>
                            ) : (
                              <div className="divide-y divide-hairline">
                                {docs[user.id].map((doc: any) => {
                                  const cfg = DOC_STATUS_CONFIG[doc.status] || { bg: 'bg-ink/5', text: 'text-ink/50', border: 'border-ink/15', label: doc.status };
                                  return (
                                    <div key={doc.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
                                      <div className="min-w-0">
                                        <p className="font-serif text-base font-bold truncate">{doc.fileName}</p>
                                        <p className="text-[11px] text-ink/40 uppercase tracking-widest mt-0.5">
                                          {doc.type || 'OTHER'} · {formatFileSize(doc.fileSize)}
                                          {doc.uploadedAt ? ` · ${new Date(doc.uploadedAt).toLocaleDateString()}` : ''}
                                        </p>
                                      </div>
                                      <div className="flex gap-3 items-center flex-wrap shrink-0">
                                        <span className={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                                          {cfg.label}
                                        </span>
                                        {docActionLoading === doc.id ? (
                                          <span className="text-[10px] uppercase tracking-widest text-ink/40 animate-pulse">Processing...</span>
                                        ) : (
                                          <>
                                            <button
                                              onClick={() => handleDownloadDoc(doc.id)}
                                              className="text-[10px] uppercase tracking-widest font-bold text-forest hover:text-forest-deep transition-colors px-2 py-1 border border-forest/20 bg-forest/10 hover:bg-forest/20"
                                            >
                                              ↓ Download
                                            </button>
                                            {doc.status !== 'VERIFIED' && (
                                              <button
                                                onClick={() => handleVerifyDoc(doc.id, user.id)}
                                                className="text-[10px] uppercase tracking-widest font-bold text-saffron-deep hover:text-saffron transition-colors px-2 py-1 border border-saffron/20 bg-saffron/10 hover:bg-saffron/20"
                                              >
                                                ✓ Verify
                                              </button>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
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
                <button key={p} className={`px-4 py-2 border border-hairline text-xs uppercase tracking-widest transition-colors font-semibold ${p === page ? 'bg-saffron text-parchment border-saffron' : 'bg-white hover:bg-parchment'}`} onClick={() => setPage(p)}>
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
