"use client";

import StartLanding from '@/components/StartLanding';
import Layout from '@/components/Layout';

export default function Home() {
  return (
    <Layout activeTab="home">
      <StartLanding />
    </Layout>
  );
}
