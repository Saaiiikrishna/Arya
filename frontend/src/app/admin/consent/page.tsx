'use client';

import Link from 'next/link';

export default function ConsentPage() {
  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen relative">
      <header className="border-b border-hairline pb-8 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Affidavit Protocol</h1>
        </div>
        <div className="text-left md:text-right">
          <p className="text-sm text-ink/40 uppercase tracking-widest mb-1">Define mandatory execution funnels</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Video Card */}
        <div className="border border-hairline bg-white p-8 group hover:border-forest transition-colors shadow-sm flex flex-col">
          <h3 className="font-serif text-2xl font-bold mb-4 flex items-center gap-3">
            <span className="text-2xl">📹</span> Initialization Broadcast
          </h3>
          <p className="text-xs uppercase tracking-widest text-ink/60 mb-8 leading-relaxed font-semibold">
            Upload or link a mandated video broadcast that applicants must consume prior to affidavit signatures.
          </p>
          <div className="mb-6 flex-1">
            <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Video URI</label>
            <input 
              className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors" 
              placeholder="https://youtube.com/watch?v=..." 
            />
          </div>
          <button className="bg-ink hover:opacity-90 text-white px-8 py-3 text-xs uppercase tracking-widest font-semibold transition-opacity self-start">
            Persist Reference
          </button>
        </div>

        {/* Agreement Card */}
        <div className="border border-hairline bg-white p-8 group hover:border-forest transition-colors shadow-sm flex flex-col">
          <h3 className="font-serif text-2xl font-bold mb-4 flex items-center gap-3">
            <span className="text-2xl">📄</span> Binding Affidavit
          </h3>
          <p className="text-xs uppercase tracking-widest text-ink/60 mb-8 leading-relaxed font-semibold">
            Define the target covenant document required for standard digital execution via Adobe Sign workflow.
          </p>
          <div className="mb-6 flex-1">
            <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Target File Payload</label>
            <input 
              type="file" 
              className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors cursor-pointer" 
              accept=".pdf,.doc,.docx" 
            />
          </div>
          <button className="bg-forest hover:opacity-90 text-white px-8 py-3 text-xs uppercase tracking-widest font-semibold transition-opacity self-start">
            Transmit Payload
          </button>
        </div>
      </div>

      <div className="border border-hairline bg-ink text-parchment p-8 mt-12 shadow-sm">
        <h3 className="font-serif text-2xl font-bold mb-8">
          Standard Execution Funnel
        </h3>
        <div className="flex flex-col md:flex-row gap-6 items-start md:items-center flex-wrap">
          {['Consume Broadcast', 'Parse Covenant', 'Affix Primary Consent', 'Transmit Signature', 'Notarization Complete'].map((step, i) => (
            <div key={i} className="flex items-center gap-4 group">
              <div className="w-10 h-10 border border-parchment/30 bg-white/5 flex items-center justify-center font-serif text-xl font-bold group-hover:bg-terracotta group-hover:text-white group-hover:border-terracotta transition-colors">
                {i + 1}
              </div>
              <span className="text-xs uppercase tracking-widest font-semibold">{step}</span>
              {i < 4 && <span className="text-parchment/40 hidden md:inline-block ml-2 group-hover:translate-x-1 transition-transform">→</span>}
            </div>
          ))}
        </div>
        <p className="text-[10px] uppercase tracking-widest text-parchment/40 mt-8 border-t border-parchment/10 pt-4">
          The pipeline dictates strictly ordered linear traversal. Docusign integration operates externally via callback execution hooks.
        </p>
      </div>
    </div>
  );
}
