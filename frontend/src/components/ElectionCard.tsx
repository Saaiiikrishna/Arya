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

  // If there's no election at all, don't render anything.
  if (!election) return null;

  // Completed election — show the result (winner + completed date) instead of
  // hiding the card entirely.
  if (election.status === 'COMPLETED') {
    const winnerId = election.winnerId || team?.leaderId;
    const members: any[] = team?.members || [];
    const winner = members.find((m: any) => m.id === winnerId);
    const winnerName =
      winner?.name ||
      [winner?.firstName, winner?.lastName].filter(Boolean).join(' ').trim() ||
      election.winnerName ||
      'Team Leader';
    const completedDate = election.completedAt
      ? new Date(election.completedAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null;

    return (
      <section className="mt-12">
        <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
          <Vote className="w-6 h-6 text-forest" />
          Team Election Result
        </h2>
        <div className="bg-white border-2 border-forest/20 p-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-forest" />
          <p className="text-sm uppercase tracking-widest text-forest font-medium mb-2">
            Election Completed
          </p>
          <h3 className="font-serif text-xl font-bold mb-3">
            {winnerName} elected as Team Leader
          </h3>
          {completedDate && (
            <p className="text-ink/60 leading-relaxed">
              Results finalized on {completedDate}.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="mt-12">
      <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
        <Vote className="w-6 h-6 text-terracotta-warm" />
        Active Team Election
      </h2>
      <div className="bg-white border-2 border-terracotta-warm/20 p-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-terracotta-warm" />

        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="text-sm uppercase tracking-widest text-saffron-deep font-medium mb-2">Phase: {election.status}</p>
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
          className="bg-saffron hover:bg-saffron-deep text-parchment text-[13px] uppercase tracking-widest py-3 px-6 transition-colors inline-flex items-center gap-2 shadow-pop"
        >
          Enter Election Portal
          <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    </section>
  );
}
