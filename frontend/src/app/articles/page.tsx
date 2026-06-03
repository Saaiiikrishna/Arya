"use client";

import Layout from '@/components/Layout';
import ComingSoon from '@/components/ComingSoon';

export default function ArticlesPage() {
  return (
    <Layout activeTab="articles">
      <ComingSoon
        title="The journal is warming up."
        subtitle="Teardowns, build logs, and hard-won lessons are coming soon — and you'll be able to publish your own. Join the community to be first to read and write."
      />
    </Layout>
  );
}
