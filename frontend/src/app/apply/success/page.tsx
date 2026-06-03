'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect } from 'react';
import { api } from '@/lib/api';

function SuccessContent() {
  const searchParams = useSearchParams();
  const batchNumber = searchParams.get('batch');
  const [batchStatus, setBatchStatus] = useState<any>(null);

  useEffect(() => {
    api.getCurrentBatch()
      .then(setBatchStatus)
      .catch(() => {});
  }, []);

  const isFull = batchStatus && batchStatus.currentCount >= batchStatus.capacity;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-parchment to-parchment-dark p-8">
      <div className="w-full max-w-lg bg-alabaster border border-hairline p-12 text-center animate-fade-in">
        <div className="text-6xl mb-4">
          {isFull ? '📋' : '🎉'}
        </div>
        <h1 className="font-serif text-3xl font-bold mb-2 text-forest">
          {isFull ? 'Application Received — Batch Full' : 'Application Submitted!'}
        </h1>
        <p className="text-ink/60 mb-6">
          {isFull ? (
            <>
              Your application has been received for{' '}
              <strong className="text-saffron-deep">Batch #{batchNumber || '1'}</strong>.
              This batch is now at full capacity. You&apos;ve been placed on the waitlist
              and will be notified if a spot opens or when the next batch begins.
            </>
          ) : (
            <>
              Thank you for applying! You&apos;ve been placed in{' '}
              <strong className="text-saffron-deep">Batch #{batchNumber || '1'}</strong>.
            </>
          )}
        </p>
        <p className="text-sm text-ink/40 mb-8">
          {isFull
            ? "We'll send you a notification email as soon as there's an update regarding your batch. Keep an eye on your inbox."
            : "We've sent a confirmation email with your application details and a link to track your status. We'll notify you as your batch progresses."
          }
        </p>

        {batchStatus && (
          <div className="bg-parchment-dark p-4 mb-6">
            <div className="text-xs text-ink/40 mb-1">
              Batch #{batchNumber || batchStatus.batchNumber} Status
            </div>
            <div className="text-sm font-semibold">
              {batchStatus.currentCount}/{batchStatus.capacity} applicants
              {isFull && <span className="text-terracotta ml-2">● Full</span>}
            </div>
          </div>
        )}

        <div className="bg-parchment-dark p-4 mb-8">
          <div className="text-xs text-ink/40 mb-1">What happens next?</div>
          <div className="text-sm">
            ✅ Screening → 🧩 Team Formation → 📝 Consent → 🚀 Launch
          </div>
        </div>

        <Link
          href="/"
          className="inline-flex items-center justify-center bg-saffron text-parchment px-7 py-3.5 font-bold uppercase tracking-widest text-xs hover:bg-saffron-deep active:translate-x-0.5 active:translate-y-0.5 transition-colors"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-hairline border-t-forest animate-spin" />
      </div>
    }>
      <SuccessContent />
    </Suspense>
  );
}
