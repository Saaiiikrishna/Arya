import { ArrowRight, Edit3 } from 'lucide-react';

interface ManifestoProps {
  onApply: () => void;
}

export default function Manifesto({ onApply }: ManifestoProps) {
  return (
    <div className="max-w-screen-2xl mx-auto px-8">
      {/* Hero Section */}
      <section className="pt-24 pb-32">
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-12 md:col-span-8 lg:col-span-7">
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-terracotta block mb-8">
              Volume I: Philosophy
            </span>
            <h1 className="text-7xl md:text-8xl font-serif leading-[0.9] text-forest tracking-tighter mb-12">
              Passion is the only <span className="italic text-terracotta">prerequisite.</span>
            </h1>
            <p className="text-xl md:text-2xl font-sans leading-relaxed text-ink/80 max-w-xl">
              We are not looking for polished pitch decks or three-year financial projections. We are looking for the obsessive, the restless, and the relentlessly curious.
            </p>
          </div>
          <div className="col-span-12 md:col-span-4 lg:col-span-5 flex items-end justify-end">
            <div className="w-full aspect-[4/5] overflow-hidden grayscale contrast-125 border border-hairline">
              <img
                className="w-full h-full object-cover"
                src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1000&auto=format&fit=crop"
                alt="Founder Portrait"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      </section>

      <div className="w-full border-t border-hairline" />

      {/* The Pact Section */}
      <section className="py-24">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
          <div className="md:col-span-3 border-r border-hairline pr-8">
            <h2 className="font-serif text-3xl italic text-forest mb-6">The Pact</h2>
            <p className="font-sans text-[10px] uppercase tracking-widest leading-loose text-ink/60">
              A three-year co-founder commitment that transcends traditional incubation.
            </p>
          </div>
          <div className="md:col-span-9 grid grid-cols-1 md:grid-cols-3 gap-12">
            {[
              {
                title: 'I. Radical Tenure',
                text: 'The startup cycle is broken. We replace the 3-month demo day sprint with a 36-month architectural build. We are your co-founders from day zero to exit.',
              },
              {
                title: 'II. Shared Risk',
                text: "We don't take \"advisory shares.\" We invest capital, labor, and reputation. When you bleed, we bleed. When you win, we rebuild the world together.",
              },
              {
                title: 'III. Unyielding Focus',
                text: 'We eliminate the noise. No networking mixers. No vanity metrics. Just pure, unadulterated execution within the quiet of the Club.',
              },
            ].map((item) => (
              <div key={item.title} className="space-y-6">
                <h3 className="font-serif text-2xl text-forest">{item.title}</h3>
                <p className="font-sans text-ink/70 leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="w-full border-t border-hairline" />

      {/* Stats Section */}
      <section className="py-32 bg-alabaster -mx-8 px-8">
        <div className="max-w-screen-2xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-16 items-center">
          <div className="lg:col-span-6 space-y-8">
            <blockquote className="border-l-2 border-terracotta pl-8">
              <p className="font-serif text-4xl text-forest italic leading-snug">
                "The most dangerous founders aren't the ones with the best ideas, but the ones with the longest horizons."
              </p>
            </blockquote>
          </div>
          <div className="lg:col-span-6 flex flex-col items-center lg:items-end">
            <div className="text-center lg:text-right">
              <span className="text-[12rem] font-serif leading-none text-terracotta font-bold tracking-tighter">1000</span>
              <p className="font-sans text-[12px] uppercase tracking-[0.4em] text-forest mt-[-2rem]">
                Visionaries per batch
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-hairline relative overflow-hidden">
        <div className="py-32 flex flex-col items-center text-center">
          <h2 className="font-serif text-5xl md:text-7xl text-forest mb-12 max-w-4xl">
            Are you prepared to commit the next three years?
          </h2>
          <button
            onClick={onApply}
            className="group relative inline-flex items-center justify-center px-12 py-6 bg-forest text-parchment font-sans text-sm uppercase tracking-widest hover:bg-forest/90 transition-all duration-300"
          >
            Apply Now
            <ArrowRight className="ml-4 w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </section>

      {/* Sticky Apply Button (Mobile) */}
      <div className="fixed bottom-8 right-8 z-40 md:hidden">
        <button
          onClick={onApply}
          className="bg-forest text-parchment w-16 h-16 flex items-center justify-center shadow-2xl"
        >
          <Edit3 className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}
