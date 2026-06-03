"use client";

import Layout from '@/components/Layout';
import ComingSoon from '@/components/ComingSoon';

export default function ArticleSubmitPage() {
  return (
    <Layout activeTab="articles">
      <ComingSoon
        title="Submissions open soon."
        subtitle="Soon you'll be able to write up your build and submit it for publication. Until then, share it with the community on Discord."
      />
    </Layout>
  );
}
