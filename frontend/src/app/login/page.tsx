"use client";

import React, { useState, Suspense } from 'react';
import Layout from '@/components/Layout';
import { GoogleLogin } from '@react-oauth/google';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isReviewMode = searchParams.get('mode') === 'razorpay_review';
  
  const [error, setError] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState('');

  const handleSuccess = async (credentialResponse: any) => {
    try {
      const res = await fetch('http://localhost:3001/api/admin/auth/google/callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: credentialResponse.credential }),
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.accessToken) {
          localStorage.setItem('arya_token', data.accessToken);
        }
        window.location.href = '/apply';
      } else {
        setError('Server rejected authentication. Please try again.');
        console.error('Google Auth Failed on Backend');
      }
    } catch (e) {
      setError('Network communication failed. Please check your connection.');
      console.error('Network error during Google Auth', e);
    }
  };

  return (
    <div className="max-w-md w-full border border-hairline bg-white shadow-sm p-12">
      <div className="flex flex-col items-center text-center space-y-6">
        <div className="flex flex-col items-end max-w-max mx-auto">
          <span className="text-4xl font-serif italic font-bold text-forest leading-none">Aryavartham</span>
          <span className="text-sm font-serif italic text-forest mt-1 leading-none text-right w-full pr-1">- The Founder&apos;s Club</span>
        </div>
        
        <hr className="w-16 border-t border-hairline my-6" />

        <h1 className="text-sm uppercase tracking-[0.2em] text-ink/80 font-bold mb-2">Gatekeeper Authentication</h1>
        <p className="text-xs text-ink/60 mb-8 leading-relaxed">
          Verify your organizational identity to access The Founder&apos;s Hub operations center.
        </p>

        {isReviewMode ? (
          <div className="w-full flex justify-center flex-col items-center">
            <input 
              type="email"
              placeholder="Reviewer Email"
              className="w-full p-3 border border-hairline mb-4 font-sans focus:outline-none focus:border-forest text-sm bg-transparent"
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
            />
            <button 
              onClick={async () => {
                try {
                  const res = await fetch('http://localhost:3001/api/admin/auth/test-razorpay', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: testEmail || 'reviewer@razorpay.com' })
                  });
                  if (res.ok) {
                    const data = await res.json();
                    localStorage.setItem('arya_token', data.accessToken);
                    window.location.href = '/apply';
                  } else { setError('Test Bypass Failed'); }
                } catch { setError('Network failure'); }
              }}
              className="w-full bg-forest text-parchment p-3 font-bold uppercase tracking-widest text-xs hover:bg-forest/90 transition-colors"
            >
              SIMULATE APPLICANT
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center w-full min-h-[50px]">
            <GoogleLogin
              onSuccess={handleSuccess}
              onError={() => setError('Google processing interrupted.')}
              theme="outline"
              shape="rectangular"
              width="100%"
              text="continue_with"
              size="large"
            />
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-terracotta/10 border border-terracotta/30 text-terracotta text-[10px] uppercase tracking-wider w-full">
            {error}
          </div>
        )}
        
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Layout showNav={false}>
      <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-parchment font-sans relative">
        <button 
          onClick={() => window.history.back()}
          className="absolute top-8 left-8 text-sm uppercase tracking-widest text-forest/70 hover:text-terracotta font-medium transition-colors"
        >
          ← Back
        </button>
        <Suspense fallback={<div className="animate-pulse text-forest font-serif italic text-xl">Loading...</div>}>
          <LoginContent />
        </Suspense>
      </div>
    </Layout>
  );
}
