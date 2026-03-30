"use client";

import { useState, useEffect } from 'react';
interface WaitingRoomProps {
  onComplete: () => void;
}

export default function WaitingRoom({ onComplete }: WaitingRoomProps) {
  return (
    <div 
      className="min-h-screen flex flex-col justify-center items-center px-6 relative overflow-hidden cursor-pointer"
      onClick={onComplete}
    >
      {/* Background Architectural Grain */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.03]" 
        style={{ backgroundImage: "url('https://images.unsplash.com/photo-1518005020251-58296b8f51f0?q=80&w=1000&auto=format&fit=crop')" }}
      />
      
      {/* Global Progress Bar */}
      <div className="fixed top-0 left-0 w-full h-[2px] bg-hairline z-50">
        <div className="h-full bg-forest transition-all duration-1000" style={{ width: '74.2%' }} />
      </div>

      <div className="max-w-4xl w-full text-center z-10">
        <div className="mb-12">
          <span className="font-sans text-[10px] uppercase tracking-widest text-forest border border-forest/20 px-4 py-1">
            Cohort 04 Admission
          </span>
        </div>

        <div className="font-serif font-light text-[120px] leading-none tracking-tighter text-forest md:text-[180px] lg:text-[220px]">
          742 <span className="text-hairline italic">/</span> 1,000
        </div>

        <div className="mt-8 flex flex-col items-center gap-6">
          <p className="font-sans text-lg md:text-xl text-ink max-w-md">
            Awaiting cohort completion. Your spot is secured.
          </p>
          <div className="flex items-center gap-3 text-terracotta">
            <span className="w-2 h-2 bg-terracotta inline-block animate-pulse" />
            <span className="font-sans text-[12px] uppercase tracking-wider font-bold">
              Synchronizing with node network
            </span>
          </div>
        </div>

        <div className="mt-24 grid grid-cols-2 md:grid-cols-4 gap-0 border-t border-hairline/30">
          {[
            { label: 'Verified Members', value: '74%', italic: true },
            { label: 'Pending Node', value: '258', italic: false },
            { label: 'Avg. Net Worth', value: 'Excl.', italic: true },
            { label: 'Launch Est.', value: '48h', italic: false },
          ].map((stat, i) => (
            <div 
              key={stat.label} 
              className={`p-8 border-hairline/30 text-left ${i < 3 ? 'border-r' : ''} ${i < 4 ? 'border-b md:border-b-0' : ''}`}
            >
              <div className="font-sans text-[10px] uppercase text-ink/40 mb-2">{stat.label}</div>
              <div className={`font-serif text-3xl ${stat.italic ? 'italic' : ''}`}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Signature Pull Quote */}
      <aside className="hidden lg:block absolute left-12 bottom-32 max-w-xs border-l border-forest pl-6">
        <h3 className="font-serif italic text-2xl text-terracotta leading-snug">
          "The quiet before the storm is where the most significant alliances are forged."
        </h3>
        <p className="font-sans text-[10px] uppercase mt-4 text-ink/40">— Founder's Log, entry 012</p>
      </aside>

      {/* Aesthetic Imagery Fragment */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-32 h-96 opacity-20 pointer-events-none grayscale">
        <img
          src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1000&auto=format&fit=crop"
          alt="Architectural shadows"
          className="h-full object-cover"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
}
