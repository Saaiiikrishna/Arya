"use client";

import { useState, useEffect } from 'react';

interface DossierProps {
  onSubmit: (data: any) => void;
  defaultData?: any;
}

export default function Dossier({ onSubmit, defaultData }: DossierProps) {
  const [identity, setIdentity] = useState('');
  const [vocation, setVocation] = useState('');
  const [obsession, setObsession] = useState('');
  const [heresy, setHeresy] = useState('');
  const [scarTissue, setScarTissue] = useState('');

  useEffect(() => {
    if (defaultData) {
      if (defaultData.identity) setIdentity(defaultData.identity);
      if (defaultData.vocation) setVocation(defaultData.vocation);
      if (defaultData.obsession) setObsession(defaultData.obsession);
      if (defaultData.heresy) setHeresy(defaultData.heresy);
      if (defaultData.scarTissue) setScarTissue(defaultData.scarTissue);
    }
  }, [defaultData]);
  return (
    <div className="min-h-screen py-24 px-6">
      <section className="max-w-[640px] mx-auto mb-20">
        <h1 className="font-serif text-5xl md:text-6xl text-forest leading-tight mb-8">
          Tell us who you are. We don't care about your resume.
        </h1>
        <p className="font-serif italic text-xl text-ink/70 leading-relaxed border-l border-terracotta pl-6 py-2">
          This dossier is designed to capture the nuance of your ambition. We are looking for the obsession that keeps you awake, the failures that shaped your resolve, and the vision that feels inevitable to you.
        </p>
      </section>

      <form 
        className="max-w-[640px] mx-auto space-y-16"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ identity, vocation, obsession, heresy, scarTissue });
        }}
      >
        <div className="space-y-12">
          <div className="group">
            <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 group-focus-within:text-terracotta transition-colors">
              Full Identity
            </label>
            <input
              type="text"
              placeholder="Elias Thorne"
              className="w-full bg-transparent border-0 border-b border-hairline py-4 px-0 focus:ring-0 focus:border-forest text-xl font-serif placeholder:text-hairline/40 transition-all"
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              required
            />
          </div>
          <div className="group">
            <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2 group-focus-within:text-terracotta transition-colors">
              Primary Vocation
            </label>
            <input
              type="text"
              placeholder="Architect of decentralized systems"
              className="w-full bg-transparent border-0 border-b border-hairline py-4 px-0 focus:ring-0 focus:border-forest text-xl font-serif placeholder:text-hairline/40 transition-all"
              value={vocation}
              onChange={(e) => setVocation(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="space-y-4">
          <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2">
            The Obsession
          </label>
          <div className="text-ink/60 text-sm font-sans mb-4 italic">
            What is the one problem you cannot stop thinking about? Describe it with the clarity of a physical object.
          </div>
          <textarea
            rows={6}
            className="w-full bg-transparent border-0 border-b border-hairline py-4 px-0 focus:ring-0 focus:border-forest text-lg font-sans leading-relaxed placeholder:text-hairline/40 transition-all resize-none"
            value={obsession}
            onChange={(e) => setObsession(e.target.value)}
            required
          />
        </div>

        <div className="py-8">
          <div className="aspect-[16/9] w-full overflow-hidden grayscale contrast-125">
            <img
              src="https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=1000&auto=format&fit=crop"
              alt="Space for Clarity"
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          <p className="font-sans text-[9px] uppercase tracking-[0.2em] text-ink/40 mt-4 text-right italic">
            Plate 01: The Space for Clarity
          </p>
        </div>

        <div className="space-y-4">
          <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2">
            The Heresy
          </label>
          <div className="text-ink/60 text-sm font-sans mb-4 italic">
            What is a truth you hold that most of your peers consider a delusion?
          </div>
          <textarea
            rows={6}
            className="w-full bg-transparent border-0 border-b border-hairline py-4 px-0 focus:ring-0 focus:border-forest text-lg font-sans leading-relaxed placeholder:text-hairline/40 transition-all resize-none"
            value={heresy}
            onChange={(e) => setHeresy(e.target.value)}
            required
          />
        </div>

        <div className="space-y-4">
          <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2">
            The Scar Tissue
          </label>
          <div className="text-ink/60 text-sm font-sans mb-4 italic">
            Detail a project that failed. Not a 'learning experience,' but a genuine collapse. What remains?
          </div>
          <textarea
            rows={6}
            className="w-full bg-transparent border-0 border-b border-hairline py-4 px-0 focus:ring-0 focus:border-forest text-lg font-sans leading-relaxed placeholder:text-hairline/40 transition-all resize-none"
            value={scarTissue}
            onChange={(e) => setScarTissue(e.target.value)}
            required
          />
        </div>

        <div className="pt-12 pb-24 border-t border-hairline/20 flex flex-col items-center">
          <button
            type="submit"
            className="bg-forest text-parchment px-12 py-5 text-sm font-sans uppercase tracking-widest hover:bg-forest/90 transition-colors active:opacity-70"
          >
            Seal & Submit Dossier
          </button>
          <p className="mt-8 text-[10px] font-sans uppercase tracking-[0.15em] text-ink/40">
            Applications are reviewed on a rolling basis.
          </p>
        </div>
      </form>
    </div>
  );
}
