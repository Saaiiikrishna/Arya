"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Manifesto from '@/components/Manifesto';
import Layout from '@/components/Layout';
import { api } from '@/lib/api';

export default function Home() {
  const router = useRouter();
  const [batch, setBatch] = useState<any>(null);

  useEffect(() => {
    api.getCurrentBatch()
      .then(setBatch)
      .catch(() => setBatch(null));
  }, []);

  const filled = batch?.currentCount || 0;
  const total = batch?.capacity || 1;
  const fillPercent = Math.round((filled / total) * 100);
  const batchNum = batch?.batchNumber || 1;

  let bannerText = `Application Open for Batch #${batchNum}`;
  let bannerSubtext = `${filled} / ${total} slots filled`;
  let bannerBg = 'bg-forest';
  let bannerPulse = '';
  let isClosed = false;

  if (batch === null) {
    // No filling batch available
    bannerText = 'Registrations Currently Closed';
    bannerSubtext = 'Stay tuned — a new batch will open soon';
    bannerBg = 'bg-ink';
    isClosed = true;
  } else if (fillPercent >= 100) {
    bannerText = `Batch #${batchNum} Registrations Closed`;
    bannerSubtext = 'You can still apply for the coming batch';
    bannerBg = 'bg-ink';
    isClosed = true;
  } else if (fillPercent >= 90) {
    bannerText = `🔥 Almost Full — Batch #${batchNum}`;
    bannerBg = 'bg-red-700';
    bannerPulse = 'animate-pulse';
  } else if (fillPercent >= 75) {
    bannerText = `⚡ Filling Fast — Batch #${batchNum}`;
    bannerBg = 'bg-red-600';
  } else if (fillPercent >= 50) {
    bannerText = `Applications Open for Batch #${batchNum}`;
    bannerBg = 'bg-amber-700';
  }

  return (
    <Layout activeTab="manifesto">
      <div className={`w-full ${bannerBg} text-parchment py-3 text-center border-b border-hairline/30 transition-colors duration-500 ${bannerPulse}`}>
        <p className="font-sans text-[10px] uppercase tracking-[0.2em] font-semibold">
          {bannerText}
        </p>
        <p className="font-sans text-[9px] uppercase tracking-[0.15em] mt-0.5 opacity-70">
          {bannerSubtext}
        </p>
        {batch && !isClosed && (
          <div className="max-w-[200px] mx-auto mt-2 h-1 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/80 rounded-full transition-all duration-1000"
              style={{ width: `${fillPercent}%` }}
            />
          </div>
        )}
      </div>
      <Manifesto onApply={() => router.push('/apply')} />
    </Layout>
  );
}
