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
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      <header className="border-b border-hairline pb-8 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Network Batches</h1>
        </div>
        <div className="text-left md:text-right">
          <p className="text-sm text-ink/40 uppercase tracking-widest mb-1">Manage lifecycle & logistics</p>
        </div>
      </header>

      {batches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-6 border border-dashed border-ink/20 bg-parchment/50 text-center">
          <div className="text-4xl mb-4">📦</div>
          <p className="text-ink/60 uppercase tracking-widest text-xs">No batches currently exist. Awaiting network applicant deposits.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {batches.map((batch) => (
            <Link key={batch.id} href={`/admin/batches/${batch.id}`} className="group block h-full">
              <div className="border border-hairline bg-white p-8 h-full flex flex-col hover:border-forest hover:-translate-y-1 transition-all shadow-sm">
                <div className="flex justify-between items-start mb-8">
                  <div className="w-16 h-16 bg-ink flex items-center justify-center font-serif text-2xl text-white font-bold shadow-md">
                    #{batch.batchNumber}
                  </div>
                  <span className={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold border ${batch.status === 'PRODUCTION' ? 'bg-forest/10 text-forest border-forest/20' : 'bg-parchment text-ink/60 border-ink/20'}`}>
                    {batch.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="mb-10 flex-1">
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-xs uppercase tracking-widest text-ink/60 font-semibold">Network Capacity</span>
                    <span className="font-serif text-xl font-bold">{batch.currentCount} / {batch.capacity}</span>
                  </div>
                  <div className="h-2 bg-parchment w-full shadow-inner border border-hairline">
                    <div 
                      className={`h-full transition-all ${batch.status === 'PRODUCTION' ? 'bg-forest' : 'bg-ink'}`} 
                      style={{ width: `${Math.min(100, (batch.currentCount / batch.capacity) * 100)}%` }} 
                    />
                  </div>
                </div>
                <div className="pt-4 border-t border-hairline flex flex-wrap justify-between items-center text-[11px] uppercase tracking-widest text-ink/60 font-bold gap-3">
                  <span>{batch._count.applicants} Applic.</span>
                  <span className="w-1 h-1 bg-ink/20 rounded-full"></span>
                  <span>{batch._count.teams} Teams</span>
                  <span className="ml-auto text-forest group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
