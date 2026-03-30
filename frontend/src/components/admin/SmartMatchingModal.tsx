'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface SmartMatchingModalProps {
  batchId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SmartMatchingModal({ batchId, onClose, onSuccess }: SmartMatchingModalProps) {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [previewData, setPreviewData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [weights, setWeights] = useState({
    ideaCategory: 0.30,
    skillDiversity: 0.25,
    commitmentLevel: 0.20,
    personality: 0.15,
    experience: 0.10,
  });

  useEffect(() => {
    api.getMatchingProfiles(batchId)
      .then(setProfiles)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [batchId]);

  const handlePreview = async () => {
    setActionLoading('preview');
    try {
      const result = await api.previewMatch(batchId, { weights });
      setPreviewData(result);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading('');
    }
  };

  const handleExecute = async () => {
    if (!confirm('Execute match? This will overwrite existing teams for this batch.')) return;
    setActionLoading('execute');
    try {
      await api.executeMatch(batchId, { weights });
      onSuccess();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading('');
    }
  };

  const handleWeightChange = (key: keyof typeof weights, value: number) => {
    setWeights(prev => ({ ...prev, [key]: value }));
  };

  if (loading) return (
    <div className="modal-overlay">
      <div className="modal flex-center p-xl">
        <div className="spinner mb-md"></div>
        <p className="text-secondary text-sm">Loading eligible profiles...</p>
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal max-w-[800px] w-[90vw] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-md border-b border-hairline pb-4">
          <h2 className="font-serif text-2xl font-bold">Smart Matching Engine</h2>
          <button onClick={onClose} className="text-ink/60 hover:text-terracotta">✕</button>
        </div>

        {!previewData ? (
          <div className="flex flex-col gap-6">
            <div className="bg-parchment p-4 border border-hairline">
              <h3 className="uppercase tracking-widest text-xs font-semibold mb-2 text-forest">Eligible Pool</h3>
              <p className="text-3xl font-serif">{profiles.length} <span className="text-sm font-sans text-ink/60">Applicants ready to match</span></p>
            </div>

            <div className="card border border-hairline p-6">
              <h3 className="font-serif text-lg font-bold mb-4 border-b border-hairline pb-2">Algorithm Weights</h3>
              <div className="grid gap-4">
                {Object.entries(weights).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-4">
                    <label className="w-40 text-sm uppercase tracking-widest text-ink/80 truncate">
                      {key.replace(/([A-Z])/g, ' $1')}
                    </label>
                    <input 
                      type="range" 
                      min="0" max="1" step="0.05" 
                      value={val}
                      onChange={(e) => handleWeightChange(key as keyof typeof weights, parseFloat(e.target.value))}
                      className="flex-1 accent-forest"
                    />
                    <span className="w-12 text-sm font-semibold text-right">{Math.round(val * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <button 
                className="btn btn-primary" 
                onClick={handlePreview}
                disabled={!!actionLoading || profiles.length === 0}
              >
                {actionLoading === 'preview' ? 'Running Algorithm...' : 'Run Preview Match'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex justify-between items-center bg-forest/10 p-4 border border-forest/20">
              <div>
                <h3 className="font-serif text-xl font-bold text-forest">Simulation Complete</h3>
                <p className="text-sm text-ink/70">{previewData.totalTeams} Teams Formed</p>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-secondary border border-hairline" onClick={() => setPreviewData(null)}>Recalculate</button>
                <button className="btn bg-forest text-white hover:bg-forest/90" onClick={handleExecute} disabled={!!actionLoading}>
                  {actionLoading === 'execute' ? 'Saving...' : 'Deploy Teams to DB'}
                </button>
              </div>
            </div>

            {previewData.message && previewData.assignments?.length === 0 && (
              <div className="bg-terracotta/10 text-terracotta p-4 border border-terracotta/20 font-semibold text-sm">
                ⚠️ {previewData.message}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              {previewData.assignments?.map((team: any, i: number) => (
                <div key={i} className="border border-hairline bg-white p-4 hover:shadow-sm transition-shadow">
                  <div className="flex justify-between items-start mb-3 border-b border-hairline pb-2">
                    <div>
                      <h4 className="font-serif font-bold text-lg">{team.teamName}</h4>
                      <p className="text-[10px] uppercase tracking-widest text-ink/50 mt-1">
                        {team.teamType.replace('_', ' ')} {team.ideaCategory ? `· ${team.ideaCategory}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-serif text-forest">{team.matchScore}</div>
                      <div className="text-[10px] uppercase tracking-widest text-ink/50">Score</div>
                    </div>
                  </div>
                  
                  <ul className="text-sm flex flex-col gap-1">
                    {team.memberIds.map((id: string) => {
                      const p = profiles.find(x => x.id === id);
                      return (
                        <li key={id} className="flex justify-between items-center p-1 hover:bg-parchment/50">
                          <span className="font-medium">{p ? `${p.firstName} ${p.lastName}` : 'Unknown'}</span>
                          <span className="text-xs text-ink/60 bg-ink/5 px-2 py-0.5 rounded">
                            {p?.matchingProfile?.skills?.[0] || 'General'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
