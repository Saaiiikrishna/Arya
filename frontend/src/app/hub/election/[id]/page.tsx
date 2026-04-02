import Election from '@/components/Election';

export default function ElectionPage({ params }: { params: { id: string } }) {
  return (
    <div className="min-h-screen bg-parchment font-sans py-12">
      <div className="max-w-5xl mx-auto px-6">
        <Election id={params.id} />
      </div>
    </div>
  );
}
