"use client";

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { ArrowLeft, Users, Crown, Mail, MapPin, Briefcase } from 'lucide-react';

export default function HubTeamPage() {
  const [team, setTeam] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const hub = await api.getMyHub();
        setTeam(hub.team);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return (
    <Layout activeTab="hub">
      <div className="p-12 text-center text-ink/40 uppercase tracking-widest text-sm">Loading Team...</div>
    </Layout>
  );

  if (!team) return (
    <Layout activeTab="hub">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <Link href="/hub" className="inline-flex items-center gap-2 text-ink/60 hover:text-ink transition-colors mb-8 text-[13px] uppercase tracking-widest font-bold">
          <ArrowLeft className="w-4 h-4" /> Return to Hub
        </Link>
        <div className="text-center py-20 border border-dashed border-ink/20 bg-parchment/50">
          <p className="text-ink/40 uppercase tracking-widest text-xs">You haven't been assigned to a team yet</p>
        </div>
      </div>
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
            <Users className="w-10 h-10 text-forest" />
            {team.name}
          </h1>
          <p className="text-ink/60">{team.members?.length || 0} members · Your Team</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {(team.members || []).map((member: any) => (
            <Link
              key={member.id}
              href={`/hub/members/${member.id}`}
              className="bg-white border border-hairline p-6 hover:border-forest transition-all hover:-translate-y-0.5 group"
            >
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 bg-gradient-to-br from-forest to-forest/60 rounded-full flex items-center justify-center text-white font-bold text-xl flex-shrink-0 shadow-md">
                  {(member.firstName?.[0] || '?')}{(member.lastName?.[0] || '')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-serif text-xl font-bold group-hover:text-forest transition-colors">
                      {member.firstName} {member.lastName}
                    </h3>
                    {member.id === team.leaderId && (
                      <Crown className="w-4 h-4 text-amber-500" />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-ink/50">
                    {member.email && (
                      <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{member.email}</span>
                    )}
                    {member.city && (
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{member.city}</span>
                    )}
                    {member.vocation && (
                      <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{member.vocation}</span>
                    )}
                  </div>
                  <p className="text-[10px] uppercase tracking-widest text-forest mt-2 font-semibold group-hover:translate-x-1 transition-transform">
                    {member.id === team.leaderId ? '⭐ Team Leader' : 'View Profile →'}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Layout>
  );
}
