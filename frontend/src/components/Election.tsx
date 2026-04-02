"use client";

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { ArrowLeft, Check, Vote, UserPlus, PlayCircle, Trophy, ArrowRight, Clock, Hand } from 'lucide-react';
import Link from 'next/link';

export default function Election({ id }: { id: string }) {
  const [election, setElection] = useState<any>(null);
  const [team, setTeam] = useState<any>(null);
  const [applicant, setApplicant] = useState<any>(null);
  const [nominees, setNominees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Self-nomination flow
  const [showSelfNomPrompt, setShowSelfNomPrompt] = useState(false);
  const [selfNomStep, setSelfNomStep] = useState<'ask' | 'questions' | 'done'>('ask');
  const [selfNomAnswers, setSelfNomAnswers] = useState<Record<string, any>>({});
  const [selfNomPitch, setSelfNomPitch] = useState('');

  // Pitch & voting
  const [pitch, setPitch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [votedId, setVotedId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const hubData = await api.getMyHub();
        setTeam(hubData.team);
        setApplicant(hubData.applicant);

        const [electionData, nomineesData] = await Promise.all([
          api.getElection(id),
          api.getNominees(id),
        ]);

        setElection(electionData);
        setNominees(nomineesData);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return <div className="p-12 text-center text-ink/40 uppercase tracking-widest text-sm">Loading Election Portal...</div>;
  }

  if (!election || !team) {
    return <div className="p-12 text-center text-terracotta uppercase tracking-widest text-sm">Election not found.</div>;
  }

  const phase = election.status as 'NOMINATION' | 'VOTING' | 'COMPLETED';
  const myNomination = nominees.find((n) => n.nomineeId === applicant?.id);
  const electionQuestions = election.questions || [];
  const deadlineStr = election.deadline
    ? new Date(election.deadline).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;

  const handleNominate = async (nomineeId: string) => {
    try {
      await api.nominate(id, nomineeId);
      const nomineesData = await api.getNominees(id);
      setNominees(nomineesData);
    } catch (err: any) {
      alert(err.message || 'Failed to nominate');
    }
  };

  const handleSelfNominate = async () => {
    setIsSubmitting(true);
    try {
      const answers = electionQuestions.map((q: any) => ({
        questionId: q.id,
        value: selfNomAnswers[q.id] || '',
      })).filter((a: any) => a.value !== '');

      await api.selfNominate(id, applicant.id, selfNomPitch || undefined, answers.length > 0 ? answers : undefined);
      setSelfNomStep('done');
      const nomineesData = await api.getNominees(id);
      setNominees(nomineesData);
    } catch (err: any) {
      alert(err.message || 'Failed to self-nominate');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePitchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myNomination) return;
    setIsSubmitting(true);
    try {
      await api.submitElectionPitch(id, myNomination.nomineeId, pitch);
      alert('Pitch updated successfully.');
    } catch (err: any) {
      alert(err.message || 'Failed to submit pitch');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVote = async (nomineeId: string) => {
    if (!confirm('Are you sure? Votes are anonymous but final.')) return;
    try {
      await api.castVote(id, nomineeId, applicant?.id);
      setVotedId(nomineeId);
    } catch (err: any) {
      alert(err.message || 'Failed to cast vote. You may have already voted.');
    }
  };

  return (
    <div>
      <Link href="/hub" className="inline-flex items-center gap-2 text-ink/60 hover:text-ink transition-colors mb-8 text-[13px] uppercase tracking-widest font-bold">
        <ArrowLeft className="w-4 h-4" /> Return to Hub
      </Link>

      {/* Header */}
      <div className="mb-12">
        <h1 className="text-4xl md:text-5xl font-serif font-black mb-4 flex items-center gap-4">
          <Vote className="w-10 h-10 text-terracotta" />
          Team Leader Election
        </h1>
        {election.instructions && (
          <div className="bg-amber-50 border border-amber-200 p-4 mb-4 text-sm text-amber-900 leading-relaxed">
            📋 {election.instructions}
          </div>
        )}
        {deadlineStr && (
          <p className="flex items-center gap-2 text-sm text-terracotta font-semibold">
            <Clock className="w-4 h-4" /> Deadline: {deadlineStr}
          </p>
        )}
      </div>

      {/* Phase Indicator */}
      <div className="flex gap-4 mb-12">
        {['NOMINATION', 'VOTING', 'COMPLETED'].map((p, i) => (
          <div key={p} className={`flex-1 relative border-t-2 pt-4 ${p === phase ? 'border-terracotta' : i < ['NOMINATION', 'VOTING', 'COMPLETED'].indexOf(phase) ? 'border-forest' : 'border-hairline'}`}>
            <p className={`text-[11px] uppercase tracking-widest font-bold ${p === phase ? 'text-terracotta' : i < ['NOMINATION', 'VOTING', 'COMPLETED'].indexOf(phase) ? 'text-forest' : 'text-ink/40'}`}>
              Phase 0{i + 1}
            </p>
            <p className={`font-serif text-lg ${p === phase ? 'text-ink' : 'text-ink/40'}`}>
              {p.replace(/_/g, ' ')}
            </p>
            {p === phase && <div className="absolute -top-[11px] left-0 w-2 h-2 rounded-full bg-terracotta" />}
          </div>
        ))}
      </div>

      {/* ═══════════ NOMINATION PHASE ═══════════ */}
      {phase === 'NOMINATION' && (
        <section className="bg-white border border-hairline p-8 lg:p-12">
          <h2 className="text-2xl font-serif font-bold mb-8">Nominate Candidates</h2>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Left: Nominate others */}
            <div>
              <h3 className="text-sm uppercase tracking-widest font-bold text-ink/40 mb-6">Eligible Members</h3>
              <div className="space-y-4">
                {team.members.map((member: any) => {
                  const isNominated = nominees.some((n) => n.nomineeId === member.id);
                  return (
                    <div key={member.id} className="flex justify-between items-center p-4 border border-hairline hover:border-terracotta/30 transition-colors">
                      <div>
                        <p className="font-bold font-serif">{member.firstName} {member.lastName}</p>
                        <p className="text-xs text-ink/60 uppercase tracking-widest">{member.role || 'Member'}</p>
                      </div>
                      <button
                        onClick={() => handleNominate(member.id)}
                        disabled={isNominated}
                        className={`text-[11px] uppercase tracking-widest font-bold px-4 py-2 transition-colors ${
                          isNominated
                            ? 'bg-forest/10 text-forest'
                            : 'bg-white border border-terracotta text-terracotta hover:bg-terracotta hover:text-white'
                        }`}
                      >
                        {isNominated ? 'Nominated' : 'Nominate'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Self-Nomination Prompt */}
              {!myNomination && selfNomStep === 'ask' && (
                <div className="mt-8 bg-sage/10 border border-sage/30 p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Hand className="w-5 h-5 text-forest" />
                    <h4 className="font-serif text-lg font-bold">Want to lead?</h4>
                  </div>
                  <p className="text-sm text-ink/60 mb-4">
                    You can self-nominate for the leadership position. You'll answer a few questions to help your team understand your vision.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        if (electionQuestions.length > 0) {
                          setSelfNomStep('questions');
                        } else {
                          setShowSelfNomPrompt(true);
                        }
                      }}
                      className="bg-forest text-white px-6 py-2 text-[11px] uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors"
                    >
                      Yes, I want to lead
                    </button>
                    <button
                      onClick={() => setSelfNomStep('done')}
                      className="border border-ink/20 text-ink/60 px-6 py-2 text-[11px] uppercase tracking-widest font-bold hover:bg-parchment transition-colors"
                    >
                      No thanks
                    </button>
                  </div>
                </div>
              )}

              {/* Self-Nomination: Answer Election Questions */}
              {selfNomStep === 'questions' && (
                <div className="mt-8 bg-white border-2 border-forest p-6 animate-fade-in">
                  <h4 className="font-serif text-lg font-bold mb-4 text-forest">Self-Nomination Questions</h4>
                  <div className="space-y-5 mb-6">
                    {electionQuestions.map((q: any, idx: number) => (
                      <div key={q.id}>
                        <label className="block text-xs uppercase tracking-widest font-bold text-ink/50 mb-2">
                          {idx + 1}. {q.label} {q.isRequired && <span className="text-terracotta">*</span>}
                        </label>
                        {q.helpText && <p className="text-[10px] text-ink/40 mb-2 italic">{q.helpText}</p>}
                        <textarea
                          rows={3}
                          value={selfNomAnswers[q.id] || ''}
                          onChange={(e) => setSelfNomAnswers({ ...selfNomAnswers, [q.id]: e.target.value })}
                          className="w-full bg-parchment/30 border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                          placeholder="Your answer..."
                        />
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-widest font-bold text-ink/50 mb-2">
                      Leadership Pitch (optional)
                    </label>
                    <textarea
                      rows={3}
                      value={selfNomPitch}
                      onChange={(e) => setSelfNomPitch(e.target.value)}
                      className="w-full bg-parchment/30 border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                      placeholder="Why should you lead the team? What's your strategy?"
                    />
                  </div>
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={handleSelfNominate}
                      disabled={isSubmitting}
                      className="bg-forest text-white px-6 py-2 text-[11px] uppercase tracking-widest font-bold hover:bg-forest/90"
                    >
                      {isSubmitting ? 'Submitting...' : 'Submit Self-Nomination'}
                    </button>
                    <button
                      onClick={() => setSelfNomStep('ask')}
                      className="border border-ink/20 text-ink/60 px-6 py-2 text-[11px] uppercase tracking-widest font-bold"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Simple self-nominate (no questions) */}
              {showSelfNomPrompt && !myNomination && electionQuestions.length === 0 && (
                <div className="mt-8 bg-white border-2 border-forest p-6 animate-fade-in">
                  <h4 className="font-serif text-lg font-bold mb-4 text-forest">Self-Nomination</h4>
                  <div className="mb-4">
                    <label className="block text-xs uppercase tracking-widest font-bold text-ink/50 mb-2">
                      Leadership Pitch
                    </label>
                    <textarea
                      rows={4}
                      value={selfNomPitch}
                      onChange={(e) => setSelfNomPitch(e.target.value)}
                      className="w-full bg-parchment/30 border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest"
                      placeholder="Why should you lead the team?"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleSelfNominate}
                      disabled={isSubmitting}
                      className="bg-forest text-white px-6 py-2 text-[11px] uppercase tracking-widest font-bold"
                    >
                      {isSubmitting ? 'Submitting...' : 'Confirm Self-Nomination'}
                    </button>
                    <button
                      onClick={() => setShowSelfNomPrompt(false)}
                      className="border border-ink/20 text-ink/60 px-6 py-2 text-[11px] uppercase tracking-widest font-bold"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Right: If already nominated, show pitch form */}
            {myNomination && (
              <div className="bg-sage/10 p-8 border border-sage/20">
                <h3 className="text-xl font-serif font-bold text-forest mb-4 flex items-center gap-2">
                  <PlayCircle className="w-5 h-5" />
                  You are nominated
                </h3>
                <p className="text-sm text-ink/60 mb-6">
                  Submit or update your leadership pitch. Team members will review this during voting.
                </p>
                <form onSubmit={handlePitchSubmit} className="space-y-4">
                  <textarea
                    rows={5}
                    value={pitch || myNomination.pitch || ''}
                    onChange={(e) => setPitch(e.target.value)}
                    placeholder="Why should you lead the team? What is your strategy?"
                    className="w-full bg-white border border-hairline p-4 placeholder:text-ink/30 focus:outline-none focus:border-forest"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-forest text-white px-6 py-3 text-[13px] uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors"
                  >
                    {isSubmitting ? 'Saving...' : 'Update Pitch'}
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ═══════════ VOTING PHASE ═══════════ */}
      {phase === 'VOTING' && (
        <section className="space-y-8">
          <div className="bg-terracotta text-white p-6">
            <h2 className="text-xl font-serif font-bold mb-2">Voting is Open</h2>
            <p className="text-sm opacity-90">Review pitches and answers from the nominees below and cast your single ballot.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {nominees.map((nominee) => {
              const member = team.members.find((m: any) => m.id === nominee.nomineeId);
              return (
                <div key={nominee.id} className="bg-white border border-hairline p-8 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <div className="w-10 h-10 bg-forest/10 rounded-full flex items-center justify-center font-bold text-forest text-sm">
                        {member?.firstName?.[0]}{member?.lastName?.[0]}
                      </div>
                      <div>
                        <h3 className="text-xl font-serif font-bold">{member?.firstName} {member?.lastName}</h3>
                        <p className="text-[10px] uppercase tracking-widest text-terracotta">
                          {nominee.isSelfNomination ? '🙋 Self-Nominated' : 'Nominated'}
                        </p>
                      </div>
                    </div>

                    {/* Pitch */}
                    <div className="my-6 border-l-2 border-hairline pl-4">
                      {nominee.pitch ? (
                        <p className="text-ink/70 text-sm leading-relaxed italic">"{nominee.pitch}"</p>
                      ) : (
                        <p className="text-ink/40 text-sm italic">No formal pitch submitted.</p>
                      )}
                    </div>

                    {/* Nomination question answers */}
                    {nominee.answers && nominee.answers.length > 0 && (
                      <div className="space-y-3 mb-6">
                        <p className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Responses</p>
                        {nominee.answers.map((ans: any) => (
                          <div key={ans.id} className="bg-parchment/50 p-3 border border-hairline">
                            <p className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold mb-1">
                              {ans.question?.label || 'Question'}
                            </p>
                            <p className="text-sm text-ink/70">
                              {typeof ans.value === 'object' ? JSON.stringify(ans.value) : String(ans.value)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => handleVote(nominee.nomineeId)}
                    disabled={votedId !== null}
                    className={`w-full py-4 text-[13px] uppercase tracking-widest font-bold border-2 transition-colors ${
                      votedId === nominee.nomineeId
                        ? 'bg-forest border-forest text-white'
                        : votedId !== null
                        ? 'bg-gray-100 border-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-transparent border-terracotta text-terracotta hover:bg-terracotta hover:text-white'
                    }`}
                  >
                    {votedId === nominee.nomineeId ? '✓ Voted' : votedId !== null ? 'Vote Cast' : 'Cast Vote'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══════════ COMPLETED PHASE ═══════════ */}
      {phase === 'COMPLETED' && (
        <section className="bg-white border-2 border-forest p-12 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 text-forest/10 pointer-events-none">
            <Trophy className="w-48 h-48" />
          </div>
          <div className="relative z-10">
            <p className="text-[13px] uppercase tracking-widest font-bold text-forest mb-4">Election Complete</p>
            <h2 className="text-4xl font-serif font-black mb-8">Leadership Decided</h2>
            <p className="text-lg text-ink/70 max-w-xl mx-auto mb-12">
              The team has spoken. The election has concluded and the new leader's privileges are active.
            </p>
            <Link
              href="/hub"
              className="inline-flex items-center gap-2 bg-forest text-white px-8 py-4 text-[13px] uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors"
            >
              Return to Hub <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
