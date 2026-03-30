"use client";

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Dossier from '@/components/Dossier';
import Layout from '@/components/Layout';
import GlobalOneTap from '@/components/GlobalOneTap';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

export default function ApplyPage() {
  const router = useRouter();
  const { isAuthenticated, admin } = useAuth();
  const [dossierData, setDossierData] = useState({ 
    vocation: '', 
    obsession: '', 
    heresy: '', 
    scarTissue: '' 
  });
  const [authTriggered, setAuthTriggered] = useState(false);

  const handleSubmit = async (data: any) => {
    if (!isAuthenticated) {
      setDossierData(data);
      setAuthTriggered(true);
      return;
    }
    
    // Process Submission
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
              Your dossier is ready to be sealed. Please authenticate your identity using Google to proceed to the pledge phase.
            </p>
            {/* The One Tap hook will automatically trigger, but we could also show the explicit button here */}
            <div className="flex justify-center">
              <div className="animate-pulse flex items-center gap-3 text-terracotta text-sm uppercase tracking-widest font-bold">
                Awaiting Google Authentication...
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <Dossier onSubmit={handleSubmit} defaultData={dossierData} />
    </Layout>
  );
}
