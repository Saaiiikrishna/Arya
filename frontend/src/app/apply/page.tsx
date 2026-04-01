"use client";

import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import ApplicationForm from '@/components/Dossier';
import Layout from '@/components/Layout';
import GlobalOneTap from '@/components/GlobalOneTap';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

export default function ApplyPage() {
  const router = useRouter();
  const { isAuthenticated, admin, loading } = useAuth();
  
  const [authTriggered, setAuthTriggered] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  // Draft / State
  const [dossierData, setDossierData] = useState<any>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [paymentPending, setPaymentPending] = useState(false);
  const [fetchingDossier, setFetchingDossier] = useState(true);

  const autoSubmitDone = useRef(false);

  // 1. Fetch Draft & Status when Authenticated
  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      setFetchingDossier(false);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        const data = await api.getMyDossier();
        if (!mounted) return;
        
        if (data.status !== 'PENDING') {
          setIsSubmitted(true);
        } else if (data.agreementAccepted) {
          setPaymentPending(true);
        } else {
          setDossierData(data);
        }
      } catch (err) {
        console.error('Failed to fetch dossier draft', err);
      } finally {
        if (mounted) setFetchingDossier(false);
      }
    })();

    return () => { mounted = false; };
  }, [isAuthenticated, loading]);

  // 2. Auto-submit pending application after login (fallback for local storage)
  useEffect(() => {
    if (loading || !isAuthenticated || autoSubmitDone.current || fetchingDossier) return;

    // Don't auto-submit if already fully submitted
    if (isSubmitted || paymentPending) return;

    const pending = localStorage.getItem('arya_pending_application');
    if (!pending) return;

    autoSubmitDone.current = true;

    (async () => {
      setSubmitting(true);
      setError('');
      try {
        const data = JSON.parse(pending);
        await api.submitDossier(data);
        localStorage.removeItem('arya_pending_application');
        router.push('/pledge');
      } catch (e: any) {
        console.error('Auto-submit failed', e);
        const errorMessage = e?.message || 'Submission failed. Please try again.';
        setError(errorMessage);
        setSubmitting(false);
        if (errorMessage.toLowerCase().includes('format') || errorMessage.toLowerCase().includes('invalid')) {
          localStorage.removeItem('arya_pending_application');
        }
      }
    })();
  }, [isAuthenticated, loading, router, fetchingDossier, isSubmitted, paymentPending]);

  const handleSubmit = async (data: any) => {
    if (!isAuthenticated) {
      // Store form data temporarily and prompt for auth
      localStorage.setItem('arya_pending_application', JSON.stringify(data));
      setAuthTriggered(true);
      return;
    }
    
    setSubmitting(true);
    setError('');
    try {
      await api.submitDossier(data);
      localStorage.removeItem('arya_pending_application');
      router.push('/pledge');
    } catch (e: any) {
      console.error('Submission failed', e);
      setError(e?.message || 'Submission failed. Please try again.');
      setSubmitting(false);
    }
  };

  // Render Loader while fetching
  if (loading || fetchingDossier) {
    return (
      <Layout activeTab="apply">
        <GlobalOneTap />
        <div className="min-h-screen py-24 px-6 flex items-center justify-center bg-parchment">
          <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  // Render Already Submitted Page
  if (isSubmitted) {
    return (
      <Layout activeTab="apply">
         <GlobalOneTap />
         <div className="min-h-screen py-24 px-6 flex items-center justify-center">
           <div className="bg-white border border-hairline p-12 max-w-lg w-full text-center shadow-lg">
             <div className="w-16 h-16 bg-forest/10 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl">
               ✅
             </div>
             <h2 className="font-serif text-3xl font-bold mb-4 text-forest">Dossier Sealed</h2>
             <p className="text-ink/60 mb-8 leading-relaxed">
               {admin?.firstName || 'Founder'}, your application is submitted successfully. Please wait for further instructions. Our team will reach out to the registered email with next steps.
             </p>
             <button
               onClick={() => router.push('/hub')}
               className="inline-block bg-forest text-parchment px-8 py-4 text-sm uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors"
             >
               Return to Hub →
             </button>
           </div>
         </div>
      </Layout>
    );
  }

  // Render Pending Payment Page
  if (paymentPending) {
    return (
      <Layout activeTab="apply">
         <GlobalOneTap />
         <div className="min-h-screen py-24 px-6 flex items-center justify-center">
           <div className="bg-white border border-hairline p-12 max-w-lg w-full text-center shadow-lg">
             <div className="w-16 h-16 bg-terracotta/10 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl">
               ⏳
             </div>
             <h2 className="font-serif text-3xl font-bold mb-4 text-forest">Final Step Required</h2>
             <p className="text-ink/60 mb-8 leading-relaxed">
               Your form filling is complete, but the pledge payment was not finalized. Please securely complete the pledge to formally seal your dossier.
             </p>
             <button
               onClick={() => router.push('/pledge')}
               className="inline-block bg-terracotta text-parchment px-8 py-4 text-sm uppercase tracking-widest font-bold hover:bg-terracotta/90 transition-colors"
             >
               Commit Pledge →
             </button>
           </div>
         </div>
      </Layout>
    );
  }

  return (
    <Layout activeTab="apply">
      <GlobalOneTap />
      
      {/* Submitting overlay */}
      {submitting && (
        <div className="fixed inset-0 z-50 bg-parchment/90 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-white border border-hairline p-12 max-w-lg w-full text-center shadow-2xl">
            <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-6" />
            <h2 className="font-serif text-2xl font-bold mb-2 text-forest">Sealing Your Application</h2>
            <p className="text-ink/50 text-sm uppercase tracking-widest">Transmitting dossier...</p>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && !submitting && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-terracotta text-parchment px-8 py-4 shadow-lg max-w-lg text-center">
          <p className="text-sm font-bold uppercase tracking-widest">{error}</p>
          <button onClick={() => setError('')} className="text-xs underline mt-2 opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      )}

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
        defaultData={dossierData}
        userInfo={admin && !dossierData ? { firstName: admin.firstName, lastName: admin.lastName, email: admin.email } : undefined}
      />
    </Layout>
  );
}

