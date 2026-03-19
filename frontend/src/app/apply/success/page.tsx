'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function SuccessContent() {
  const searchParams = useSearchParams();
  const batchNumber = searchParams.get('batch');

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--gradient-hero)',
      padding: 'var(--space-xl)',
    }}>
      <div className="card-glass animate-fade-in" style={{
        width: '100%', maxWidth: 500,
        padding: 'var(--space-2xl)', textAlign: 'center',
      }}>
        <div style={{ fontSize: '4rem', marginBottom: 'var(--space-md)' }}>🎉</div>
        <h1 style={{
          fontSize: '1.75rem', fontWeight: 700,
          marginBottom: 'var(--space-sm)',
        }}>
          Application Submitted!
        </h1>
        <p className="text-secondary" style={{ marginBottom: 'var(--space-lg)' }}>
          Thank you for applying! You&apos;ve been placed in{' '}
          <strong style={{ color: 'var(--color-accent)' }}>Batch #{batchNumber || '1'}</strong>.
        </p>
        <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-xl)' }}>
          We&apos;ve sent a confirmation email with your application details
          and a link to track your status. We&apos;ll notify you as your batch progresses.
        </p>

        <div style={{
          background: 'var(--color-bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-md)',
          marginBottom: 'var(--space-xl)',
        }}>
          <div className="text-xs text-muted" style={{ marginBottom: 4 }}>What happens next?</div>
          <div className="text-sm">
            ✅ Screening → 🧩 Team Formation → 📝 Consent → 🚀 Launch
          </div>
        </div>

        <Link href="/" className="btn btn-primary">
          Back to Home
        </Link>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={
      <div className="loading-page" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
      </div>
    }>
      <SuccessContent />
    </Suspense>
  );
}
