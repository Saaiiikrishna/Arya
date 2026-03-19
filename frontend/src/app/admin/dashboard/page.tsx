'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

interface Stats {
  totalApplicants: number;
  statusBreakdown: {
    pending: number;
    eligible: number;
    active: number;
    removed: number;
  };
  totalBatches: number;
  activeBatch: {
    id: string;
    batchNumber: number;
    status: string;
    currentCount: number;
    capacity: number;
    teamCount: number;
  } | null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDashboardStats().then(setStats).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="loading-page"><div className="spinner" /> Loading dashboard...</div>;
  }

  if (!stats) return <div className="empty-state">Failed to load dashboard</div>;

  const activeBatch = stats.activeBatch;

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Overview of your batch pipeline</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid-stats" style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="stat-card">
          <div className="stat-value">{stats.totalApplicants.toLocaleString()}</div>
          <div className="stat-label">Total Applicants</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalBatches}</div>
          <div className="stat-label">Total Batches</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.statusBreakdown.active}</div>
          <div className="stat-label">Active Users</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.statusBreakdown.pending}</div>
          <div className="stat-label">Pending Review</div>
        </div>
      </div>

      <div className="grid-2">
        {/* Active Batch Card */}
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 'var(--space-md)' }}>
            Active Batch
          </h3>
          {activeBatch ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div className="flex items-center justify-between">
                <span className="text-secondary">Batch #{activeBatch.batchNumber}</span>
                <span className={`badge badge-${activeBatch.status.toLowerCase()}`}>
                  {activeBatch.status.replace(/_/g, ' ')}
                </span>
              </div>
              <div>
                <div className="flex justify-between text-sm" style={{ marginBottom: '6px' }}>
                  <span className="text-muted">Capacity</span>
                  <span>{activeBatch.currentCount} / {activeBatch.capacity}</span>
                </div>
                <div style={{
                  height: 8,
                  background: 'var(--color-bg-tertiary)',
                  borderRadius: 'var(--radius-full)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${(activeBatch.currentCount / activeBatch.capacity) * 100}%`,
                    background: 'var(--gradient-primary)',
                    borderRadius: 'var(--radius-full)',
                    transition: 'width var(--transition-slow)',
                  }} />
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Teams Formed</span>
                <span className="font-semibold">{activeBatch.teamCount}</span>
              </div>
              <Link href={`/admin/batches/${activeBatch.id}`} className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
                View Details →
              </Link>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 'var(--space-lg)' }}>
              <p className="text-muted">No active batch</p>
            </div>
          )}
        </div>

        {/* Status Breakdown */}
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 'var(--space-md)' }}>
            User Status Breakdown
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {Object.entries(stats.statusBreakdown).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between" style={{ padding: '0.5rem 0' }}>
                <div className="flex items-center gap-sm">
                  <span className={`badge badge-${status}`}>{status}</span>
                </div>
                <span className="font-semibold">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card" style={{ marginTop: 'var(--space-xl)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 'var(--space-md)' }}>
          Quick Actions
        </h3>
        <div className="flex gap-sm flex-wrap">
          <Link href="/admin/questions" className="btn btn-secondary">
            ❓ Manage Questions
          </Link>
          <Link href="/admin/batches" className="btn btn-secondary">
            📦 View Batches
          </Link>
          <Link href="/admin/users" className="btn btn-secondary">
            👥 Browse Users
          </Link>
          <Link href="/admin/eligibility" className="btn btn-secondary">
            ✅ Eligibility Criteria
          </Link>
        </div>
      </div>
    </div>
  );
}
