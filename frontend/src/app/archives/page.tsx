'use client';

import { useState, useEffect } from 'react';
import Layout from '@/components/Layout';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'];

export default function ArchivesPage() {
  const { role, loading: authLoading } = useAuth();
  const isAdmin = !!role && ADMIN_ROLES.includes(role);

  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Wait until auth has resolved so we know whether to use the admin or the
    // public data source.
    if (authLoading) return;

    let cancelled = false;

    async function loadAdmin() {
      const data = await api.getBatches();
      return data.sort((a: any, b: any) => b.batchNumber - a.batchNumber);
    }

    async function loadPublic() {
      // Public, safe-field list of all batches (newest first) — no PII, no admin
      // auth required. Replaces the fragile current-batch-and-walk-backwards
      // approach, which returned nothing whenever no batch was currently FILLING.
      const data = await api.getPublicBatches().catch(() => []);
      return Array.isArray(data) ? data : [];
    }

    (async () => {
      try {
        const data = isAdmin ? await loadAdmin() : await loadPublic();
        if (!cancelled) setBatches(data);
      } catch (err) {
        console.error(err);
        if (!cancelled) setBatches([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, isAdmin]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'FINALIZED': case 'PRODUCTION': return 'text-forest bg-forest/10 border-forest/20';
      case 'FILLING': return 'text-marigold bg-marigold/10 border-marigold/20';
      default: return 'text-ink/60 bg-ink/5 border-ink/10';
    }
  };

  return (
    <Layout activeTab="archives">
      <div className="max-w-[1000px] mx-auto py-20 px-6 animate-fade-in">
        <div className="text-center mb-16">
          <h1 className="font-serif text-5xl font-bold mb-4">The Archives</h1>
          <p className="text-lg text-ink/70 max-w-xl mx-auto">
            A living ledger of every cohort that has passed through the Aryavartham pipeline. Each batch represents a generation of builders.
          </p>
        </div>

        {(loading || authLoading) ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="animate-pulse text-forest font-serif italic text-xl">Decrypting Archives...</div>
          </div>
        ) : batches.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-hairline bg-parchment/30">
            <h3 className="font-serif text-2xl font-bold mb-2">No Cohorts Yet</h3>
            <p className="text-ink/60 mb-6">The first generation of builders has not yet been formed.</p>
            <Link href="/apply" className="btn btn-primary px-8">
              Be the First
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {batches.map(batch => (
              <div key={batch.id || batch.batchNumber} className="border border-hairline bg-white">
                <div className="p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                  <div className="flex-1">
                    <div className="flex items-center gap-4 mb-3">
                      <h2 className="font-serif text-3xl font-bold">Batch #{batch.batchNumber}</h2>
                      <span className={`text-[10px] uppercase tracking-widest font-bold px-3 py-1 border ${getStatusColor(batch.status)}`}>
                        {batch.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-ink/60">
                      Formed {new Date(batch.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-8 text-center">
                    <div>
                      <div className="font-serif text-2xl font-bold">{batch.currentCount}</div>
                      <div className="text-[10px] uppercase tracking-widest text-ink/40">Founders</div>
                    </div>
                    <div>
                      <div className="font-serif text-2xl font-bold">{batch.capacity}</div>
                      <div className="text-[10px] uppercase tracking-widest text-ink/40">Capacity</div>
                    </div>
                    <div>
                      <div className="font-serif text-2xl font-bold text-forest">{batch._count?.teams || 0}</div>
                      <div className="text-[10px] uppercase tracking-widest text-ink/40">Teams</div>
                    </div>
                  </div>
                </div>

                {/* Capacity Bar */}
                <div className="px-8 pb-6">
                  <div className="h-1.5 w-full bg-parchment">
                    <div
                      className="h-full bg-saffron transition-all"
                      style={{ width: `${Math.min(100, (batch.currentCount / batch.capacity) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
