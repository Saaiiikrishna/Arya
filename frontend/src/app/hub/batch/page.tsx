"use client";

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { ArrowLeft, Users, Building2, Lock } from 'lucide-react';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'];

export default function HubBatchPage() {
  const { role, loading: authLoading } = useAuth();
  const isAdmin = !!role && ADMIN_ROLES.includes(role);

  const [teams, setTeams] = useState<any[]>([]);
  const [batch, setBatch] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // True when the viewer can only see their own team (the full batch roster is admin-only)
  const [ownTeamOnly, setOwnTeamOnly] = useState(false);

  useEffect(() => {
    // Wait for auth to resolve so `isAdmin` is correct before choosing the
    // admin (full roster) vs member (own team) data path — otherwise the first
    // render's null role would always take the member branch.
    if (authLoading) return;

    async function load() {
      try {
        const hub = await api.getMyHub();
        const batchId = hub.batch?.id || hub.applicant?.batchId;
        if (batchId) {
          const batchData = await api.getPublicBatchStatus(hub.batch?.batchNumber || 1);
          setBatch(batchData);

          if (isAdmin) {
            // Admins can see every team in the batch.
            const teamData = await api.getTeamsByBatch(batchId);
            setTeams(teamData);
          } else {
            // The batch-wide roster endpoint is admin-only. For regular members,
            // surface their own team (already returned by the Hub) instead of a
            // permanently empty roster they have no permission to load.
            setOwnTeamOnly(true);
            setTeams(hub.team ? [hub.team] : []);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [authLoading, isAdmin]);

  if (loading) return (
    <Layout activeTab="hub">
      <div className="p-12 text-center text-ink/40 uppercase tracking-widest text-sm">Loading Batch View...</div>
    </Layout>
  );

  return (
    <Layout activeTab="hub">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <Link href="/hub" className="inline-flex items-center gap-2 text-ink/60 hover:text-ink transition-colors mb-8 text-[13px] uppercase tracking-widest font-bold">
          <ArrowLeft className="w-4 h-4" /> Return to Hub
        </Link>

        <div className="mb-12">
          <h1 className="text-4xl md:text-5xl font-serif font-black mb-2 flex items-center gap-4">
            <Building2 className="w-10 h-10 text-forest" />
            Batch {batch?.batchNumber ? `#${batch.batchNumber}` : ''} {ownTeamOnly ? 'Team' : 'Roster'}
          </h1>
          {batch?.name && <p className="text-lg text-ink/60">{batch.name}</p>}
          {ownTeamOnly ? (
            <p className="text-sm text-ink/40 mt-2">
              {batch?._count?.teams ?? 0} team{(batch?._count?.teams ?? 0) !== 1 ? 's' : ''} in this batch
            </p>
          ) : (
            <p className="text-sm text-ink/40 mt-2">
              {teams.length} team{teams.length !== 1 ? 's' : ''} · {batch?._count?.teams || teams.length} total
            </p>
          )}
        </div>

        {ownTeamOnly && (
          <div className="mb-8 flex items-start gap-3 border border-hairline bg-parchment/50 p-4 text-sm text-ink/60">
            <Lock className="w-4 h-4 mt-0.5 flex-shrink-0 text-ink/40" />
            <p>
              The full batch roster is visible to programme staff only. Below is your own team.
            </p>
          </div>
        )}

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {teams.map((team: any) => (
            <div key={team.id} className="bg-white border border-hairline p-6 hover:border-forest transition-colors">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-serif text-xl font-bold">{team.name}</h3>
                <span className="px-2 py-1 text-[10px] uppercase tracking-widest font-bold bg-forest/10 text-forest border border-forest/20">
                  {team.members?.length || team._count?.members || 0} members
                </span>
              </div>
              <div className="space-y-2 mb-4">
                {(team.members || []).slice(0, 6).map((m: any) => (
                  <Link
                    key={m.id}
                    href={`/hub/members/${m.id}`}
                    className="flex items-center gap-3 p-2 hover:bg-parchment/50 transition-colors group"
                  >
                    <div className="w-8 h-8 bg-forest/10 rounded-full flex items-center justify-center text-forest font-bold text-sm">
                      {(m.firstName?.[0] || '?')}{(m.lastName?.[0] || '')}
                    </div>
                    <div>
                      <p className="text-sm font-medium group-hover:text-forest transition-colors">
                        {m.firstName} {m.lastName}
                      </p>
                      <p className="text-[10px] text-ink/40 uppercase tracking-widest">
                        {(m.isLeader || m.id === team.leaderId) ? '⭐ Leader' : 'Member'}
                      </p>
                    </div>
                  </Link>
                ))}
                {(team.members?.length || 0) > 6 && (
                  <p className="text-xs text-ink/40 uppercase tracking-widest pl-2">+{team.members.length - 6} more</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {teams.length === 0 && (
          <div className="text-center py-20 border border-dashed border-ink/20 bg-parchment/50">
            <Users className="w-8 h-8 mx-auto mb-3 text-ink/20" />
            <p className="text-ink/40 uppercase tracking-widest text-xs">
              {ownTeamOnly ? 'You are not on a team yet' : 'No teams in this batch yet'}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
