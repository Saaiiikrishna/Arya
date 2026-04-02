"use client";

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { UserPlus, ArrowRight, ShieldAlert, Vote } from 'lucide-react';

export default function ElectionCard({ team }: { team: any }) {
  const [election, setElection] = useState<any>(team?.activeElection);
  const [nominees, setNominees] = useState<any[]>([]);
  const [showPitchModal, setShowPitchModal] = useState(false);
  const [pitchContent, setPitchContent] = useState('');
  const [selectedNominee, setSelectedNominee] = useState<string | null>(null);

  // If there's no active election, don't render anything
  if (!election || election.status === 'COMPLETED') return null;

  return (
    <section className="mt-12">
      <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
        <Vote className="w-6 h-6 text-terracotta" />
        Active Team Election
      </h2>
      <div className="bg-white border-2 border-terracotta/20 p-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-terracotta" />
        
        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="text-sm uppercase tracking-widest text-terracotta font-medium mb-2">Phase: {election.status}</p>
            <h3 className="font-serif text-xl font-bold">
              {election.status === 'NOMINATION' ? 'Nominate Your Leader' : 'Cast Your Vote'}
            </h3>
          </div>
        </div>

        <p className="text-ink/60 mb-6 leading-relaxed max-w-2xl">
          {election.status === 'NOMINATION' 
            ? 'The nomination phase is open. Please access the dedicated election portal to nominate a team member or submit your own pitch.'
            : 'Nominations are closed. Anonymous voting is now underway. Make sure your voice is heard.'}
        </p>

        <a 
          href={`/hub/election/${election.id}`}
          className="bg-terracotta hover:bg-terracotta/90 text-white text-[13px] uppercase tracking-widest py-3 px-6 transition-colors inline-flex items-center gap-2"
        >
          Enter Election Portal
          <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    </section>
  );
}
