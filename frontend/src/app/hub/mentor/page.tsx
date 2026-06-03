"use client";

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { ArrowLeft, UserCheck, Mail, BookOpen, Tag } from 'lucide-react';

export default function HubMentorPage() {
  const [mentor, setMentor] = useState<any>(null);
  const [team, setTeam] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const hub = await api.getMyHub();
        setTeam(hub?.team ?? null);
        setMentor(hub?.team?.mentor ?? null);
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
      <div className="p-12 text-center text-ink/40 uppercase tracking-widest text-sm">Loading Mentor...</div>
    </Layout>
  );

  if (!team) return (
    <Layout activeTab="hub">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Link href="/hub" className="inline-flex items-center gap-2 text-ink/60 hover:text-ink mb-8 text-[13px] uppercase tracking-widest font-bold">
          <ArrowLeft className="w-4 h-4" /> Return to Hub
        </Link>
        <div className="text-center py-20 border border-dashed border-ink/20">
          <p className="text-ink/40 uppercase tracking-widest text-xs">You haven't been assigned to a team yet</p>
        </div>
      </div>
    </Layout>
  );

  return (
    <Layout activeTab="hub">
      <div className="max-w-5xl mx-auto px-6 py-12 space-y-10">
        <div>
          <Link href="/hub" className="inline-flex items-center gap-2 text-ink/60 hover:text-ink mb-6 text-[13px] uppercase tracking-widest font-bold">
            <ArrowLeft className="w-4 h-4" /> Return to Hub
          </Link>
          <h1 className="text-4xl font-serif font-black flex items-center gap-3">
            <UserCheck className="w-8 h-8 text-forest" />
            Your Mentor
          </h1>
          <p className="text-ink/50 mt-1 text-sm uppercase tracking-widest">{team.name}</p>
        </div>

        {!mentor ? (
          <div className="text-center py-20 border border-dashed border-ink/20">
            <UserCheck className="w-10 h-10 text-ink/20 mx-auto mb-4" />
            <p className="text-ink/40 uppercase tracking-widest text-xs mb-2">No mentor assigned yet</p>
            <p className="text-ink/30 text-xs">A mentor will be assigned to your team shortly after formation</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Mentor card */}
            <div className="border border-ink/10 p-8">
              <div className="flex items-start gap-6">
                <div className="w-16 h-16 border border-ink/20 flex items-center justify-center shrink-0 bg-forest/5">
                  <span className="text-2xl font-serif font-black text-forest">
                    {mentor.firstName?.[0]}{mentor.lastName?.[0]}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl font-serif font-bold">
                    {mentor.firstName} {mentor.lastName}
                  </h2>
                  <a
                    href={`mailto:${mentor.email}`}
                    className="inline-flex items-center gap-2 text-forest hover:underline mt-2 text-sm"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {mentor.email}
                  </a>
                </div>
              </div>

              {mentor.bio && (
                <div className="mt-6 border-t border-ink/10 pt-6">
                  <p className="text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-2 flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5" /> About
                  </p>
                  <p className="text-sm text-ink/70 leading-relaxed">{mentor.bio}</p>
                </div>
              )}

              {mentor.expertise && mentor.expertise.length > 0 && (
                <div className="mt-6 border-t border-ink/10 pt-6">
                  <p className="text-[11px] uppercase tracking-widest font-bold text-ink/50 mb-3 flex items-center gap-2">
                    <Tag className="w-3.5 h-3.5" /> Expertise
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {mentor.expertise.map((tag: string) => (
                      <span
                        key={tag}
                        className="text-[11px] uppercase tracking-widest font-bold border border-ink/20 px-3 py-1 text-ink/60"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Guidance note */}
            <div className="border border-forest/20 bg-forest/5 p-6">
              <p className="text-[11px] uppercase tracking-widest font-bold text-forest mb-2">How to work with your mentor</p>
              <ul className="text-sm text-ink/70 space-y-1.5 list-disc list-inside">
                <li>Reach out via email for guidance on team dynamics and change requests</li>
                <li>Your mentor reviews SEPARATION, JOIN, and CREATE requests before admin acts</li>
                <li>Weekly check-ins are monitored by your mentor — keep them honest and specific</li>
                <li>Blockers escalated to your mentor get platform-level attention</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
