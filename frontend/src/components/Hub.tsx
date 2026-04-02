"use client";

import { FileText, Users, Share2, LogOut, Check, Plus, ArrowRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import ChatWidget from './ChatWidget';
import ElectionCard from './ElectionCard';
import TeamRequests from './TeamRequests';
import PendingQuestionnaire from './PendingQuestionnaire';

export default function Hub() {
  const router = useRouter();
  const { admin, logout, isAuthenticated, loading: authLoading } = useAuth();
  const [hubData, setHubData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    const token = api.getToken();
    if (!token) {
      router.push('/login');
      return;
    }

    api.getMyHub()
      .then(data => setHubData(data))
      .catch(err => {
        console.error('Failed to fetch hub data:', err);
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated, authLoading, router]);

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-parchment">
        <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const applicant = hubData?.applicant;
  const team = hubData?.team;
  const project = hubData?.project;
  const sprint = hubData?.sprint;
  const batch = hubData?.batch;

  const firstName = applicant?.firstName || admin?.firstName || 'Founder';

  // Sprint display logic
  const renderSprintHeader = () => {
    if (!sprint) return null;
    
    if (sprint.status === 'ACTIVE') {
      return (
        <div className="text-right">
          <p className="text-3xl font-serif text-terracotta mb-1">
            Day {sprint.currentDay} <span className="text-ink/40 text-xl">of {sprint.totalDays}</span>
          </p>
          <p className="text-sm text-ink/40 uppercase tracking-widest">{sprint.phase === 'ON_TRACK' ? 'On Track' : sprint.phase}</p>
        </div>
      );
    }
    
    return (
      <div className="text-right">
        <p className="text-sm text-ink/40 uppercase tracking-widest leading-relaxed">
          {sprint.label}
        </p>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex text-ink selection:bg-forest/20 selection:text-forest">
      {/* Sidebar Navigation */}
      <aside className="w-[250px] border-r border-hairline flex-shrink-0 h-screen sticky top-0 flex flex-col justify-between py-12 px-8 bg-parchment">
        <div>
          <div className="mb-16">
            <span className="font-serif text-2xl font-bold tracking-tight">The Founder's<br />Club.</span>
          </div>
          <nav className="flex flex-col gap-6">
            {[
              { label: 'Overview', active: true, href: '/hub' },
              { label: 'Team Roster', active: false, href: '/hub/team' },
              { label: 'Batch View', active: false, href: '/hub/batch' },
              { label: 'Training Modules', active: false, href: '/hub/training' },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`group flex items-center gap-3 font-medium text-sm tracking-wide uppercase transition-colors ${item.active ? 'text-ink' : 'text-ink/40 hover:text-ink'
                  }`}
              >
                <span className={`w-1 h-1 ${item.active ? 'bg-forest' : 'bg-transparent group-hover:bg-ink'}`} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </div>
        <div className="border-t border-hairline pt-8 mt-12">
          <p className="text-xs uppercase tracking-widest text-ink/40 mb-2">
            {batch ? `Cohort #${batch.batchNumber}` : 'Cohort'}
          </p>
          <p className="font-serif text-lg font-medium">
            {firstName} {applicant?.lastName || ''}
          </p>
          <button
            onClick={handleLogout}
            className="mt-6 text-xs uppercase tracking-widest text-ink/40 hover:text-terracotta transition-colors flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 px-16 py-12 overflow-y-auto">
        <div className="max-w-[960px] mx-auto">
          {/* Header Section */}
          <header className="border-b border-hairline pb-8 mb-12 flex justify-between items-end">
            <div>
              <p className="text-sm uppercase tracking-widest text-forest font-medium mb-3">
                {firstName}&apos;s Command Center
              </p>
              <h1 className="font-serif text-5xl font-bold leading-none">Founder&apos;s Club</h1>
            </div>
            {renderSprintHeader()}
          </header>

          {/* Announcements Section */}
          <AnnouncementsSection batchId={applicant?.batchId} />

          {/* Pending Questionnaires */}
          <PendingQuestionnaire firstName={firstName} accessToken={applicant?.accessToken} />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            {/* Left Column */}
            <div className="lg:col-span-7 flex flex-col gap-12">
              {/* Idea Brief — only shown when project data exists */}
              {project && (
                <section>
                  <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
                    <FileText className="w-6 h-6 text-forest" />
                    The Idea Brief
                  </h2>
                  <div className="bg-white border border-hairline p-8">
                    <h3 className="font-serif text-xl font-medium mb-4">Project: {project.projectName}</h3>
                    <p className="text-base leading-relaxed text-ink mb-6">
                      {project.description}
                    </p>
                    <div className="grid grid-cols-2 gap-6 border-t border-hairline pt-6">
                      <div>
                        <p className="text-[13px] uppercase tracking-widest text-ink/40 mb-1">Target Market</p>
                        <p className="font-medium">{project.targetMarket}</p>
                      </div>
                      <div>
                        <p className="text-[13px] uppercase tracking-widest text-ink/40 mb-1">Initial Capital</p>
                        <p className="font-medium font-serif text-lg">${project.estimatedFunds?.toLocaleString()} USD</p>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* No project yet — show placeholder */}
              {!project && (
                <section>
                  <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
                    <FileText className="w-6 h-6 text-forest" />
                    The Idea Brief
                  </h2>
                  <div className="border border-dashed border-ink/20 p-8 text-center bg-parchment/50">
                    <p className="text-ink/40 text-sm uppercase tracking-widest mb-2">Awaiting Definition</p>
                    <p className="text-ink/60 text-sm leading-relaxed max-w-md mx-auto">
                      {team 
                        ? 'Project details will appear here once your team leader sets the idea brief during the ideation phase.'
                        : 'Once teams are formed and a team leader is elected, project details will be defined here.'}
                    </p>
                  </div>
                </section>
              )}

              {/* Team Roster */}
              <section>
                <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
                  <Users className="w-6 h-6 text-forest" />
                  Team Roster
                </h2>
                {team && team.members && team.members.length > 0 ? (
                  <>
                    <div className="border-t border-hairline">
                      {team.members.map((member: any) => (
                        <div key={member.id} className="flex items-center justify-between py-4 px-4 border-b border-hairline cursor-pointer group hover:bg-white hover:border-l-2 hover:border-l-terracotta transition-all">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-forest/10 flex items-center justify-center border border-forest/20">
                              <span className="font-serif font-bold text-forest">{member.initial}</span>
                            </div>
                            <div>
                              <p className="font-medium text-lg font-serif group-hover:text-terracotta transition-colors flex items-center gap-2">
                                {member.name}
                                {member.isLeader && (
                                  <span className="text-[10px] uppercase tracking-widest bg-forest/10 text-forest px-2 py-0.5 rounded-sm">
                                    Leader
                                  </span>
                                )}
                              </p>
                              <p className="text-[13px] uppercase tracking-widest text-ink/40">{member.role}</p>
                            </div>
                          </div>
                          <div className="text-right hidden sm:block">
                            <p className="text-sm text-ink">{member.email}</p>
                            <p className="text-xs text-ink/40">{member.timezone || member.city || ''}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button className="mt-6 text-[13px] uppercase tracking-widest font-medium text-forest hover:text-terracotta transition-colors flex items-center gap-2">
                      <Plus className="w-4 h-4" />
                      Request Additional Talent
                    </button>
                  </>
                ) : (
                  <div className="border border-dashed border-ink/20 p-8 text-center bg-parchment/50">
                    <p className="text-ink/40 text-sm uppercase tracking-widest mb-2">Team Not Formed</p>
                    <p className="text-ink/60 text-sm leading-relaxed max-w-md mx-auto">
                      You will be assigned to a team once the admissions committee finalizes batch rosters and team formation is complete.
                    </p>
                  </div>
                )}
              </section>

              {team?.activeElection && (
                <ElectionCard team={team} />
              )}

              {team?.id && (
                <TeamRequests team={team} userId={applicant?.id} />
              )}
            </div>

            {/* Right Column */}
            <div className="lg:col-span-5 flex flex-col gap-12">
              <section>
                <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
                  <Share2 className="w-6 h-6 text-forest" />
                  90-Day Sprint
                </h2>
                <div className="bg-white border border-hairline p-6 relative">
                  {sprint?.status === 'ACTIVE' && sprint.milestones && sprint.milestones.length > 0 ? (
                    <>
                      <div className="absolute left-[39px] top-6 bottom-6 w-[2px] bg-ink/10">
                        <div className="w-full bg-forest" style={{ height: `${(sprint.milestones.filter((m: any) => m.isCompleted).length / sprint.milestones.length) * 100}%` }} />
                      </div>
                      <div className="flex flex-col gap-8 relative z-10">
                        {sprint.milestones.map((m: any) => (
                          <div key={m.id} className="flex gap-6 items-start">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${m.isCompleted ? 'bg-forest' : 'bg-parchment border-2 border-forest relative'}`}>
                              {m.isCompleted ? <Check className="w-4 h-4 text-white" /> : <div className="w-3 h-3 bg-forest rounded-full animate-pulse" />}
                            </div>
                            <div className={m.isCompleted ? "" : "bg-white border border-hairline p-4 shadow-sm w-full border-l-[3px] border-l-forest"}>
                              <p className={`text-[13px] uppercase tracking-widest font-bold mb-1 ${m.isCompleted ? 'text-forest' : 'text-terracotta'}`}>
                                Deadline: {new Date(m.deadline).toLocaleDateString()}
                              </p>
                              <p className="font-serif text-lg font-bold mb-2">{m.title}</p>
                              <p className={`text-sm mb-3 ${m.isCompleted ? 'text-ink/40' : 'text-ink'}`}>{m.description}</p>
                              {!m.isCompleted && (
                                <button className="bg-forest hover:bg-forest/90 text-white text-[13px] uppercase tracking-widest py-2 px-4 transition-colors w-full">
                                  Mark Document Complete
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 px-6 border border-dashed border-ink/20 bg-parchment/50 text-center">
                      <div className="w-12 h-12 bg-forest/10 flex items-center justify-center border border-forest/20 mb-6">
                        <span className="font-serif text-xl font-bold text-forest">0</span>
                      </div>
                      <h3 className="font-serif text-2xl font-bold mb-2">Awaiting Cohort Formation</h3>
                      <p className="text-ink/60 mb-6 max-w-sm">
                        {sprint?.label || 'No active sprints are mapped to your team yet as the admissions committee finalizes batch rosters.'}
                      </p>
                      <button disabled className="bg-ink/10 text-ink/40 text-[13px] uppercase tracking-widest py-3 px-6 cursor-not-allowed">
                        Timeline Locked
                      </button>
                    </div>
                  )}
                </div>
              </section>

              {/* Capital Section — only show when project exists */}
              {project && (
                <section>
                  <div className="bg-ink text-parchment p-8 flex flex-col gap-6">
                    <div>
                      <p className="text-[13px] uppercase tracking-widest text-ink/40 mb-2">Capital Deployed</p>
                      <div className="flex items-end gap-3">
                        <p className="font-serif text-4xl font-bold text-white">
                          ${project.fundedAmount?.toLocaleString() || '0'}
                        </p>
                        <p className="text-sm text-ink/40 mb-1 pb-1">
                          / ${project.estimatedFunds?.toLocaleString() || '0'} Allocated
                        </p>
                      </div>
                    </div>
                    <div className="w-full h-1 bg-ink/30 relative">
                      <div
                        className="absolute top-0 left-0 h-full bg-forest"
                        style={{ width: `${project.estimatedFunds > 0 ? (project.fundedAmount / project.estimatedFunds) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center pt-4 border-t border-ink/30">
                      <p className="text-sm text-ink/40">
                        {sprint?.status === 'ACTIVE' ? `Day ${sprint.currentDay} of ${sprint.totalDays}` : 'Sprint not started'}
                      </p>
                      <a href="#" className="text-[13px] uppercase tracking-widest text-forest hover:text-white transition-colors flex items-center gap-1">
                        View Ledger
                        <ArrowRight className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Real-time Team Communications */}
      {team?.id && (
        <ChatWidget
          teamId={team.id}
          userId={applicant?.id || 'user'}
          userName={`${firstName} ${applicant?.lastName || ''}`}
        />
      )}
    </div>
  );
}

function AnnouncementsSection({ batchId }: { batchId?: string }) {
  const [announcements, setAnnouncements] = useState<any[]>([]);

  useEffect(() => {
    api.getActiveAnnouncements(batchId)
      .then(setAnnouncements)
      .catch(() => {});
  }, [batchId]);

  if (announcements.length === 0) return null;

  return (
    <div className="mb-8 space-y-3">
      {announcements.map((a: any) => (
        <div key={a.id} className="bg-amber-50 border border-amber-200 p-5 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-serif text-lg font-bold text-amber-900">📢 {a.title}</h3>
            {a.deadline && (
              <span className="text-[10px] uppercase tracking-widest text-amber-700 font-bold">
                ⏰ {new Date(a.deadline).toLocaleDateString()}
              </span>
            )}
          </div>
          <p className="text-sm text-amber-800 leading-relaxed">{a.content}</p>
        </div>
      ))}
    </div>
  );
}
