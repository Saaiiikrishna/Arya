'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface Props {
  teamId: string;
}

export default function AdminElectionControls({ teamId }: Props) {
  const [election, setElection] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getActiveElection(teamId)
      .then(setElection)
      .catch(() => setElection(null))
      .finally(() => setLoading(false));
  }, [teamId]);

  const handleAdvance = async () => {
    if (!election?.id) return;
    try {
      const result = await api.advanceElection(election.id);
      alert(
        result.unanimous
          ? `Sole nominee auto-elected as leader!`
          : result.status === 'VOTING'
          ? 'Moved to voting phase'
          : `Election completed! Winner selected.`
      );
      const updated = await api.getActiveElection(teamId);
      setElection(updated);
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) return null;

  if (!election) {
    return (
      <div className="mt-4 pt-4 border-t border-hairline">
        <p className="text-[10px] uppercase tracking-widest text-ink/30 font-bold">No active election</p>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-hairline">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-terracotta font-bold">
          🗳 Election: {election.status}
        </span>
        <span className="text-[10px] text-ink/40 uppercase tracking-widest">
          {election._count?.nominations || 0} nom. · {election._count?.votes || 0} votes
        </span>
      </div>
      {election.status !== 'COMPLETED' && (
        <button
          onClick={handleAdvance}
          className="w-full text-[10px] uppercase tracking-widest font-bold border border-terracotta text-terracotta px-3 py-2 hover:bg-terracotta hover:text-white transition-colors mt-2"
        >
          {election.status === 'NOMINATION' ? 'Advance to Voting →' : 'Finalize Results →'}
        </button>
      )}
      {election.status === 'COMPLETED' && (
        <p className="text-[10px] text-forest font-bold uppercase tracking-widest">✅ Leader elected</p>
      )}
    </div>
  );
}
