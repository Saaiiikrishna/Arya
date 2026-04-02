"use client";

import { useState, useEffect, use } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { ArrowLeft, Mail, MapPin, Briefcase, Calendar, GraduationCap, User } from 'lucide-react';

export default function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [member, setMember] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.getMemberProfile(id);
        setMember(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) return (
    <Layout activeTab="hub">
      <div className="p-12 text-center text-ink/40 uppercase tracking-widest text-sm">Loading Profile...</div>
    </Layout>
  );

  if (!member) return (
    <Layout activeTab="hub">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link href="/hub" className="inline-flex items-center gap-2 text-ink/60 hover:text-ink transition-colors mb-8 text-[13px] uppercase tracking-widest font-bold">
          <ArrowLeft className="w-4 h-4" /> Return to Hub
        </Link>
        <div className="text-center py-20 border border-dashed border-ink/20 bg-parchment/50">
          <p className="text-ink/40 uppercase tracking-widest text-xs">Member not found</p>
        </div>
      </div>
    </Layout>
  );

  const initials = `${member.firstName?.[0] || ''}${member.lastName?.[0] || ''}`;

  // Group answers by phase
  const initialAnswers = (member.answers || []).filter((a: any) => a.phaseTag === 'INITIAL');
  const screeningAnswers = (member.answers || []).filter((a: any) => a.phaseTag === 'ADDITIONAL');

  return (
    <Layout activeTab="hub">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link href="/hub/team" className="inline-flex items-center gap-2 text-ink/60 hover:text-ink transition-colors mb-8 text-[13px] uppercase tracking-widest font-bold">
          <ArrowLeft className="w-4 h-4" /> Back to Team
        </Link>

        {/* Profile Header */}
        <div className="bg-white border border-hairline mb-8 overflow-hidden">
          <div className="h-32 bg-gradient-to-r from-forest via-forest/80 to-sage relative">
            <div className="absolute -bottom-12 left-8">
              <div className="w-24 h-24 bg-white rounded-full border-4 border-white shadow-lg flex items-center justify-center text-4xl font-serif font-black text-forest">
                {initials}
              </div>
            </div>
          </div>
          <div className="pt-16 pb-8 px-8">
            <h1 className="text-3xl font-serif font-black mb-1">
              {member.firstName} {member.lastName}
            </h1>
            <p className="text-ink/60 text-sm mb-4">{member.vocation || 'Member'}</p>
            <div className="flex flex-wrap gap-4 text-xs text-ink/50">
              {member.email && (
                <span className="flex items-center gap-1.5 bg-parchment/50 px-3 py-1.5 rounded-full">
                  <Mail className="w-3.5 h-3.5" />{member.email}
                </span>
              )}
              {member.city && (
                <span className="flex items-center gap-1.5 bg-parchment/50 px-3 py-1.5 rounded-full">
                  <MapPin className="w-3.5 h-3.5" />{member.city}
                </span>
              )}
              {member.age && (
                <span className="flex items-center gap-1.5 bg-parchment/50 px-3 py-1.5 rounded-full">
                  <Calendar className="w-3.5 h-3.5" />Age {member.age}
                </span>
              )}
              {member.phone && (
                <span className="flex items-center gap-1.5 bg-parchment/50 px-3 py-1.5 rounded-full">
                  📞 {member.phone}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Profile Sections */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {member.obsession && (
            <ProfileSection icon="🔥" title="Obsession" content={member.obsession} />
          )}
          {member.heresy && (
            <ProfileSection icon="⚡" title="Heretical Belief" content={member.heresy} />
          )}
          {member.scarTissue && (
            <ProfileSection icon="💪" title="Scar Tissue" content={member.scarTissue} />
          )}
          {member.vocation && (
            <ProfileSection icon="💼" title="Vocation" content={member.vocation} />
          )}
        </div>

        {/* Initial Application Answers */}
        {initialAnswers.length > 0 && (
          <div className="mb-8">
            <h2 className="font-serif text-2xl font-bold mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-forest" /> Application Responses
            </h2>
            <div className="bg-white border border-hairline divide-y divide-hairline">
              {initialAnswers.map((answer: any) => (
                <div key={answer.id} className="p-5">
                  <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-2">
                    {answer.question?.label || 'Question'}
                  </p>
                  <p className="text-ink/80 leading-relaxed">
                    {typeof answer.value === 'object' ? JSON.stringify(answer.value) : String(answer.value)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Screening Answers */}
        {screeningAnswers.length > 0 && (
          <div className="mb-8">
            <h2 className="font-serif text-2xl font-bold mb-4 flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-terracotta" /> Screening Responses
            </h2>
            <div className="bg-white border border-hairline divide-y divide-hairline">
              {screeningAnswers.map((answer: any) => (
                <div key={answer.id} className="p-5">
                  <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-2">
                    {answer.question?.label || 'Question'}
                  </p>
                  <p className="text-ink/80 leading-relaxed">
                    {typeof answer.value === 'object' ? JSON.stringify(answer.value) : String(answer.value)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Team Info */}
        {member.team && (
          <div className="bg-forest/5 border border-forest/20 p-6">
            <p className="text-xs uppercase tracking-widest text-forest font-bold mb-1">Team Assignment</p>
            <p className="font-serif text-xl font-bold">{member.team.name}</p>
          </div>
        )}
      </div>
    </Layout>
  );
}

function ProfileSection({ icon, title, content }: { icon: string; title: string; content: string }) {
  return (
    <div className="bg-white border border-hairline p-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{icon}</span>
        <h3 className="text-xs uppercase tracking-widest font-bold text-ink/50">{title}</h3>
      </div>
      <p className="text-ink/80 leading-relaxed">{content}</p>
    </div>
  );
}
