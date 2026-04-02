"use client";

import { useState } from 'react';
import { api } from '@/lib/api';
import { ClipboardList, Plus, Check, X } from 'lucide-react';

export default function TeamRequests({ team, userId }: { team: any, userId: string }) {
  const [requests, setRequests] = useState<any[]>(team?.pendingRequests || []);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // New request form
  const [type, setType] = useState('RESOURCE');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');

  const isLeader = team.leaderId === userId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const newReq = await api.createTeamRequest(team.id, { type, title, details });
      setRequests([newReq, ...requests]);
      setShowModal(false);
      setTitle('');
      setDetails('');
    } catch (err: any) {
      alert(err.message || 'Failed to submit request');
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async (reqId: string, status: string) => {
    try {
      await api.resolveTeamRequest(team.id, reqId, status);
      setRequests(requests.filter(r => r.id !== reqId));
    } catch (err: any) {
      alert(err.message || 'Failed to resolve request');
    }
  };

  return (
    <section className="mt-12">
      <div className="flex justify-between items-center mb-6">
        <h2 className="font-serif text-2xl font-bold flex items-center gap-3">
          <ClipboardList className="w-6 h-6 text-forest" />
          Team Requests
        </h2>
        <button 
          onClick={() => setShowModal(true)}
          className="text-[13px] uppercase tracking-widest font-medium text-forest hover:text-terracotta transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Request
        </button>
      </div>

      <div className="bg-white border border-hairline divide-y divide-hairline">
        {requests.length === 0 ? (
          <div className="p-8 text-center text-ink/40 text-sm uppercase tracking-widest">
            No pending requests
          </div>
        ) : (
          requests.map(req => (
            <div key={req.id} className="p-6 flex justify-between items-center">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-ink/40 mb-1">{req.type}</p>
                <p className="font-medium font-serif text-lg mb-1">{req.title}</p>
                <p className="text-sm text-ink/60">{req.details}</p>
                <p className="text-xs text-ink/40 mt-3">— Requested by {req.requester?.firstName || 'System'}</p>
              </div>
              
              {isLeader && (
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleResolve(req.id, 'APPROVED')}
                    className="p-2 border border-forest text-forest hover:bg-forest hover:text-white transition-colors"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => handleResolve(req.id, 'REJECTED')}
                    className="p-2 border border-terracotta text-terracotta hover:bg-terracotta hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* New Request Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-ink/80 flex justify-center items-center z-50 p-4">
          <div className="bg-parchment max-w-lg w-full p-8 border border-hairline relative">
            <button 
              onClick={() => setShowModal(false)}
              className="absolute top-6 right-6 text-ink/40 hover:text-ink transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            <h3 className="font-serif text-3xl font-bold mb-8">Submit Request</h3>
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div>
                <label className="block text-[13px] uppercase tracking-widest font-bold text-ink/60 mb-2">Request Type</label>
                <select 
                  value={type} 
                  onChange={(e) => setType(e.target.value)}
                  className="w-full bg-white border border-hairline p-4 text-ink focus:outline-none focus:border-forest transition-colors"
                >
                  <option value="RESOURCE">Resource Need</option>
                  <option value="SWAP">Team Member Swap</option>
                  <option value="COMPLAINT">Anonymous Complaint</option>
                  <option value="CODE_REVIEW">Specialized Code Review</option>
                </select>
              </div>
              <div>
                <label className="block text-[13px] uppercase tracking-widest font-bold text-ink/60 mb-2">Title</label>
                <input 
                  type="text" 
                  value={title} 
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="E.g., Need AWS Credits"
                  className="w-full bg-white border border-hairline p-4 placeholder:text-ink/20 focus:outline-none focus:border-forest transition-colors"
                />
              </div>
              <div>
                <label className="block text-[13px] uppercase tracking-widest font-bold text-ink/60 mb-2">Details</label>
                <textarea 
                  value={details} 
                  onChange={(e) => setDetails(e.target.value)}
                  required
                  rows={4}
                  placeholder="Explain your resource need or swap justification in detail."
                  className="w-full bg-white border border-hairline p-4 placeholder:text-ink/20 focus:outline-none focus:border-forest transition-colors resize-none"
                />
              </div>
              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-forest hover:bg-forest/90 text-white font-medium text-[13px] uppercase tracking-widest py-4 transition-colors disabled:opacity-50"
              >
                {loading ? 'Submitting...' : 'Submit Request'}
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
