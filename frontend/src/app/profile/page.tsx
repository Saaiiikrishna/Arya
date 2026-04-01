"use client";

import { useAuth } from '@/lib/auth';
import Layout from '@/components/Layout';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LogOut, User, Mail, Shield } from 'lucide-react';

export default function ProfilePage() {
  const { admin: user, isAuthenticated, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, loading, router]);

  const handleLogout = () => {
    logout();
    window.location.href = '/';
  };

  if (loading || !user) {
    return (
      <Layout activeTab="archives">
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="animate-pulse text-forest font-serif italic text-xl">Loading profile...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout activeTab="archives">
      <div className="min-h-[80vh] flex items-center justify-center py-20 px-6">
        <div className="max-w-2xl w-full bg-white border border-hairline shadow-sm overflow-hidden translate-y-[-5vh]">
          {/* Header Section */}
          <div className="bg-parchment/30 border-b border-hairline p-12 text-center">
            {user.avatarUrl ? (
              <img 
                src={user.avatarUrl} 
                alt="Profile" 
                className="w-24 h-24 rounded-full border-2 border-forest/20 mx-auto mb-6 shadow-lg"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-forest/5 flex items-center justify-center mx-auto mb-6 border border-hairline">
                <User className="w-12 h-12 text-forest/40" />
              </div>
            )}
            <h1 className="font-serif text-4xl font-bold text-forest mb-2">{user.firstName} {user.lastName}</h1>
            <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-ink/40">Member of the Aryavartham</p>
          </div>

          {/* Details Section */}
          <div className="p-12 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-ink/30 font-bold flex items-center gap-2">
                  <Mail className="w-3 h-3" /> Email Address
                </label>
                <p className="text-ink font-serif text-lg">{user.email}</p>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-ink/30 font-bold flex items-center gap-2">
                  <Shield className="w-3 h-3" /> System Role
                </label>
                <p className="text-ink font-serif text-lg capitalize">{user.role.toLowerCase()}</p>
              </div>
            </div>

            <hr className="border-t border-hairline" />

            <div className="flex flex-col md:flex-row justify-between items-center pt-4 gap-6">
              <div className="text-left">
                <p className="text-[10px] text-ink/40 uppercase tracking-widest leading-relaxed max-w-xs">
                  All personal data is synced via Google Identity Services and encrypted at rest.
                </p>
              </div>

              <button 
                onClick={handleLogout}
                className="flex items-center gap-3 px-8 py-3 bg-white border border-terracotta text-terracotta hover:bg-terracotta hover:text-parchment transition-all duration-300 font-sans text-xs uppercase tracking-widest font-bold group"
              >
                <LogOut className="w-4 h-4 group-hover:translate-x-[-2px] transition-transform" />
                Terminate Session
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
