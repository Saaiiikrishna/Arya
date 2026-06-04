"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Manifesto from '@/components/Manifesto';
import Layout from '@/components/Layout';
import { api } from '@/lib/api';

export default function StartupPage() {
  const router = useRouter();
  const [batch, setBatch] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    api.getCurrentBatch()
      .then(setBatch)
      .catch(() => setBatch(null));
    api.getPublicSettings()
      .then(setSettings)
      .catch(() => setSettings({}));
  }, []);

  return (
    <Layout activeTab="startup">
      <Manifesto onApply={() => router.push('/apply')} batchInfo={batch} settings={settings} />
    </Layout>
  );
}
