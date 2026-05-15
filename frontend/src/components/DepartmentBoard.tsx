"use client";

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface DeptMember {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
}

interface DeptSlot {
  department: string;
  member: DeptMember | null;
}

interface DeptData {
  slots: DeptSlot[];
  filledCount: number;
  totalRequired: number;
  isComplete: boolean;
}

const DEPT_META: Record<string, { label: string; description: string; icon: string }> = {
  PRODUCT: {
    label: 'Product',
    description: 'Owns the product vision, roadmap, and user experience.',
    icon: '🧩',
  },
  OPERATIONS: {
    label: 'Operations',
    description: 'Manages day-to-day processes, timelines, and team coordination.',
    icon: '⚙️',
  },
  RESOURCES: {
    label: 'Resources',
    description: 'Handles hiring, tools, infrastructure, and resource allocation.',
    icon: '🔧',
  },
  SALES_MARKETING: {
    label: 'Sales & Marketing',
    description: 'Drives customer acquisition, brand, and go-to-market strategy.',
    icon: '📣',
  },
  FOUNDING_OTHER: {
    label: 'Founding Other',
    description: 'Additional founding role tailored to the team\'s specific needs.',
    icon: '⭐',
  },
};

export default function DepartmentBoard({ teamId }: { teamId: string }) {
  const { user } = useAuth();
  const [data, setData] = useState<DeptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchDepts = useCallback(async () => {
    try {
      const res = await api.getTeamDepartments(teamId);
      setData(res);
    } catch {
      setError('Failed to load department data');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    fetchDepts();
  }, [fetchDepts]);

  const handleClaim = async (dept: string) => {
    if (!user?.id) return;
    setClaiming(dept);
    setError('');
    try {
      await api.claimDepartment(teamId, user.id, dept);
      await fetchDepts();
    } catch (err: any) {
      setError(err.message || 'Failed to claim department');
    } finally {
      setClaiming(null);
    }
  };

  const myDept = data?.slots.find((s) => s.member?.id === user?.id)?.department;

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-6 h-6 border-2 border-forest border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-white border border-hairline shadow-sm">
      <div className="px-8 py-6 border-b border-hairline flex items-center justify-between">
        <div>
          <h3 className="font-serif text-xl font-bold">Department Board</h3>
          <p className="text-ink/50 text-xs uppercase tracking-widest mt-1">
            {data.filledCount} of {data.totalRequired} roles claimed
          </p>
        </div>
        {data.isComplete && (
          <span className="bg-forest/10 text-forest text-[10px] font-bold uppercase tracking-widest px-3 py-1">
            All departments filled
          </span>
        )}
      </div>

      {error && (
        <div className="mx-8 mt-4 px-4 py-3 bg-terracotta/10 text-terracotta text-sm border border-terracotta/20">
          {error}
        </div>
      )}

      <div className="divide-y divide-hairline">
        {data.slots.map(({ department, member }) => {
          const meta = DEPT_META[department];
          const isMe = member?.id === user?.id;
          const isMine = department === myDept;
          const isClaiming = claiming === department;

          return (
            <div
              key={department}
              className={`px-8 py-5 flex items-center gap-6 transition-colors ${
                isMe ? 'bg-forest/5' : ''
              }`}
            >
              <div className="w-10 h-10 bg-parchment flex items-center justify-center text-xl flex-shrink-0 border border-hairline">
                {meta.icon}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{meta.label}</p>
                <p className="text-ink/50 text-xs leading-snug mt-0.5">{meta.description}</p>
              </div>

              <div className="flex items-center gap-4 flex-shrink-0">
                {member ? (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-forest/20 rounded-full flex items-center justify-center text-xs font-bold text-forest">
                      {member.firstName.charAt(0)}{member.lastName.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-tight">
                        {member.firstName} {member.lastName}
                        {isMe && (
                          <span className="ml-2 text-[10px] text-forest font-bold uppercase tracking-widest">
                            You
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                ) : (
                  <span className="text-ink/30 text-xs uppercase tracking-widest italic">Unclaimed</span>
                )}

                {!member && !myDept && (
                  <button
                    onClick={() => handleClaim(department)}
                    disabled={!!claiming}
                    className="px-4 py-2 bg-forest text-white text-[10px] font-bold uppercase tracking-widest hover:bg-forest/90 transition-colors disabled:opacity-50"
                  >
                    {isClaiming ? 'Claiming…' : 'Claim'}
                  </button>
                )}

                {isMine && (
                  <span className="px-4 py-2 border border-forest text-forest text-[10px] font-bold uppercase tracking-widest">
                    Your Role
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!data.isComplete && (
        <div className="px-8 py-4 bg-parchment/50 border-t border-hairline">
          <p className="text-xs text-ink/50 uppercase tracking-widest">
            All 5 departments must be filled before the team can be locked and finalised.
          </p>
        </div>
      )}
    </div>
  );
}
