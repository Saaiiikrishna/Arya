'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

export default function BatchesPage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getBatches().then(setBatches).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-page"><div className="spinner" /> Loading...</div>;

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Batches</h1>
          <p className="page-subtitle">Manage batch lifecycle from filling to production</p>
        </div>
      </div>

      {batches.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <p>No batches yet. Batches are created automatically when applicants apply.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {batches.map((batch) => (
            <Link key={batch.id} href={`/admin/batches/${batch.id}`} style={{ textDecoration: 'none' }}>
              <div className="card" style={{ cursor: 'pointer' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-md">
                    <div style={{
                      width: 48, height: 48,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--gradient-primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: '1.125rem', color: 'white',
                    }}>
                      #{batch.batchNumber}
                    </div>
                    <div>
                      <div className="font-semibold">Batch {batch.batchNumber}</div>
                      <div className="text-xs text-muted">
                        {batch._count.applicants} applicants · {batch._count.teams} teams
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-md">
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ marginBottom: 4 }}>
                        <span className={`badge badge-${batch.status.toLowerCase()}`}>
                          {batch.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="text-xs text-muted">
                        {batch.currentCount} / {batch.capacity}
                      </div>
                    </div>
                    <span className="text-muted">→</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{
                  marginTop: 'var(--space-md)', height: 4,
                  background: 'var(--color-bg-tertiary)',
                  borderRadius: 'var(--radius-full)', overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${(batch.currentCount / batch.capacity) * 100}%`,
                    background: batch.status === 'PRODUCTION' ? 'var(--color-success)' : 'var(--gradient-primary)',
                    borderRadius: 'var(--radius-full)',
                    transition: 'width var(--transition-slow)',
                  }} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
