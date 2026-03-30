"use client";

import { useRouter } from 'next/navigation';
import Manifesto from '@/components/Manifesto';
import Layout from '@/components/Layout';

export default function Home() {
  const router = useRouter();

  return (
    <Layout activeTab="manifesto">
      <div className="w-full bg-forest text-parchment py-3 text-center border-b border-hairline/30">
        <p className="font-sans text-[10px] uppercase tracking-[0.2em]">
          Applications Open for Batch #1
        </p>
      </div>
      <Manifesto onApply={() => router.push('/apply')} />
    </Layout>
  );
}
