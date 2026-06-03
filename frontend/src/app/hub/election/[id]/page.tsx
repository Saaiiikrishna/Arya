import Election from '@/components/Election';

export default async function ElectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="min-h-screen bg-parchment font-sans py-12">
      <div className="max-w-5xl mx-auto px-6">
        <Election id={id} />
      </div>
    </div>
  );
}
