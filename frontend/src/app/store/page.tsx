"use client";

import Layout from '@/components/Layout';
import ComingSoon from '@/components/ComingSoon';

export default function StorePage() {
  return (
    <Layout activeTab="store">
      <ComingSoon
        title="The store is being stocked."
        subtitle="Kits, components, and build-it-yourself projects are on their way. Join the community to get first dibs the moment the shelves open."
      />
    </Layout>
  );
}
