"use client";

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ApplicationForm from '@/components/Dossier';
import Layout from '@/components/Layout';
import GlobalOneTap from '@/components/GlobalOneTap';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

export default function ApplyPage() {
  const router = useRouter();
  const { isAuthenticated, admin } = useAuth();
  const [authTriggered, setAuthTriggered] = useState(false);

  const handleSubmit = async (data: any) => {
    if (!isAuthenticated) {
      // Store form data temporarily and prompt for auth
      localStorage.setItem('arya_pending_application', JSON.stringify(data));
      setAuthTriggered(true);
      return;
    }
    
    try {
      await api.submitDossier(data);
      router.push('/pledge');
    } catch (e) {
      console.error('Submission failed', e);
    }
  };

  return (
    <Layout activeTab="apply">
      <GlobalOneTap />
      
      {authTriggered && !isAuthenticated ? (
        <div className="fixed inset-0 z-50 bg-parchment/90 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white border border-hairline p-12 max-w-lg w-full text-center shadow-2xl">
            <h2 className="font-serif text-3xl font-bold mb-4 text-forest">Identity Required</h2>
            <p className="text-ink/60 mb-8 leading-relaxed">
              Your application is ready to be sealed. Please authenticate your identity to proceed to the pledge phase.
            </p>
            <a 
              href="/login" 
              className="inline-block bg-forest text-parchment px-8 py-4 text-sm uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors"
            >
              Login to Submit →
            </a>
          </div>
        </div>
      ) : null}

      <ApplicationForm 
        onSubmit={handleSubmit} 
        userInfo={admin ? { firstName: admin.firstName, lastName: admin.lastName, email: admin.email } : undefined}
      />
    </Layout>
  );
}
