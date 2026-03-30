'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { LogOut, ArrowLeft, Play, FileText, CheckCircle, Clock } from 'lucide-react';
import Link from 'next/link';

export default function HubTrainingPage() {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeAssignment, setActiveAssignment] = useState<any>(null);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    api.getMyTrainingAssignments()
      .then(setAssignments)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleComplete = async () => {
    if (!activeAssignment) return;
    setCompleting(true);
    try {
      await api.completeTrainingAssignment(activeAssignment.id);
      
      // Update local state instead of refetching to be snappy
      setAssignments(prev => prev.map(a => 
        a.id === activeAssignment.id ? { ...a, status: 'COMPLETED', completedAt: new Date().toISOString() } : a
      ));
      setActiveAssignment(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCompleting(false);
    }
  };

  const pendingCount = assignments.filter(a => a.status === 'PENDING').length;

  return (
    <div className="min-h-screen flex text-ink selection:bg-forest/20 selection:text-forest animate-fade-in">
      {/* Basic Sidebar for Hub */}
      <aside className="w-[250px] border-r border-hairline flex-shrink-0 h-screen sticky top-0 flex flex-col justify-between py-12 px-8 bg-parchment">
        <div>
          <div className="mb-16">
            <span className="font-serif text-2xl font-bold tracking-tight">The Founder's<br />Club.</span>
          </div>
          <nav className="flex flex-col gap-6">
            <Link href="/hub" className="group flex items-center gap-3 font-medium text-sm tracking-wide uppercase text-ink/40 hover:text-ink transition-colors">
              <span className="w-1 h-1 bg-transparent group-hover:bg-ink" />
              <span>Overview</span>
            </Link>
            <Link href="/hub/training" className="group flex items-center gap-3 font-medium text-sm tracking-wide uppercase text-ink transition-colors">
              <span className="w-1 h-1 bg-forest" />
              <span>Training Modules</span>
            </Link>
          </nav>
        </div>
        <div className="border-t border-hairline pt-8 mt-12">
          <Link href="/" className="mt-6 text-xs uppercase tracking-widest text-ink/40 hover:text-terracotta transition-colors flex items-center gap-2">
            <LogOut className="w-4 h-4" />
            Exit Hub
          </Link>
        </div>
      </aside>

      <main className="flex-1 px-16 py-12 overflow-y-auto">
        <div className="max-w-[1000px] mx-auto">
          <header className="border-b border-hairline pb-8 mb-12 flex justify-between items-end">
            <div>
              <p className="text-sm uppercase tracking-widest text-forest font-medium mb-3">Knowledge Base</p>
              <h1 className="font-serif text-5xl font-bold leading-none">Curriculum</h1>
            </div>
            <div className="text-right">
              <p className="text-3xl font-serif text-terracotta mb-1">{pendingCount} <span className="text-ink/40 text-xl">Pending</span></p>
              <p className="text-sm text-ink/40 uppercase tracking-widest">Required Modules</p>
            </div>
          </header>

          {loading ? (
           <div className="flex-center py-20">
             <div className="spinner mb-4"></div>
             <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Curriculum...</p>
           </div>
          ) : activeAssignment ? (
            <div className="animate-fade-in border border-hairline bg-white flex flex-col min-h-[500px]">
              <div className="p-6 border-b border-hairline flex justify-between items-start bg-parchment/30">
                <div>
                  <button onClick={() => setActiveAssignment(null)} className="text-xs uppercase tracking-widest font-bold text-ink/50 hover:text-forest flex items-center gap-2 mb-4">
                    <ArrowLeft className="w-4 h-4" /> Back to List
                  </button>
                  <h2 className="font-serif text-3xl font-bold">{activeAssignment.module.title}</h2>
                </div>
                <div className="bg-ink/5 px-3 py-1 text-xs uppercase tracking-widest font-bold border border-ink/10">
                  {activeAssignment.module.contentType}
                </div>
              </div>

              <div className="p-8 flex-1 flex flex-col items-center justify-center bg-ink/5 text-center">
                <p className="text-lg text-ink/80 max-w-xl mb-8 leading-relaxed">
                  {activeAssignment.module.description}
                </p>
                <a 
                  href={activeAssignment.module.contentUrl} 
                  target="_blank" 
                  rel="noreferrer"
                  className="btn bg-ink text-white hover:bg-forest text-sm px-8 py-4 flex items-center gap-3"
                >
                  {activeAssignment.module.contentType === 'VIDEO' ? <Play className="w-5 h-5"/> : <FileText className="w-5 h-5" />}
                  Access Material Externally
                </a>
              </div>

              <div className="p-6 border-t border-hairline bg-parchment/30 flex justify-between items-center">
                <p className="text-sm text-ink/60 max-w-md">By clicking complete, you certify that you have fully consumed and understood this curriculum material.</p>
                <button 
                  onClick={handleComplete} 
                  disabled={completing}
                  className="btn btn-primary px-8"
                >
                  {completing ? 'Verifying...' : 'Mark as Completed'}
                </button>
              </div>
            </div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-20 border border-hairline border-dashed bg-parchment/30">
              <h3 className="font-serif text-2xl font-bold mb-2">No Assignments</h3>
              <p className="text-ink/60">Your cohort has not been assigned any training modules yet.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {assignments.map(assignment => (
                <div 
                  key={assignment.id} 
                  onClick={() => assignment.status === 'PENDING' && setActiveAssignment(assignment)}
                  className={`border border-hairline p-6 flex items-center justify-between transition-colors
                    ${assignment.status === 'PENDING' ? 'bg-white hover:border-forest cursor-pointer' : 'bg-parchment/50 opacity-70'}
                  `}
                >
                  <div className="flex items-center gap-6">
                    <div className={`w-12 h-12 flex items-center justify-center border ${assignment.status === 'COMPLETED' ? 'bg-forest/10 border-forest/20 text-forest' : 'bg-ink/5 border-ink/10 text-ink/40'}`}>
                      {assignment.status === 'COMPLETED' ? <CheckCircle className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
                    </div>
                    <div>
                      <h3 className="font-serif text-xl font-bold mb-1">{assignment.module.title}</h3>
                      <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest font-bold">
                        <span className="text-ink/50">{assignment.module.contentType}</span>
                        {assignment.requiredBy && (
                          <>
                            <span className="text-ink/20">•</span>
                            <span className="text-terracotta">Due: {new Date(assignment.requiredBy).toLocaleDateString()}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div>
                    {assignment.status === 'COMPLETED' ? (
                      <span className="text-xs font-bold text-forest uppercase tracking-widest">Completed</span>
                    ) : (
                      <span className="text-xs font-bold text-ink uppercase tracking-widest border border-hairline px-4 py-2 hover:bg-ink hover:text-white transition-colors">Start Module</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
