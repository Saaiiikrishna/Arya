"use client";

import React, { useState, useRef, useEffect, Suspense } from 'react';
import Layout from '@/components/Layout';
import { GoogleLogin } from '@react-oauth/google';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import { useAuth } from '@/lib/auth';

const TEST_EMAIL = 'test@arya.com';

function LoginContent() {
  const router = useRouter();
  const { settings } = useSettings();
  const { isAuthenticated, admin, loading: authLoading, role } = useAuth();
  const logoMode = settings?.logoMode || 'text';
  
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'choose' | 'otp-email' | 'otp-verify'>('choose');
  const [otpEmail, setOtpEmail] = useState('');
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  // Redirect authenticated users — prevent re-login
  useEffect(() => {
    if (!authLoading && isAuthenticated && admin) {
      if (role === 'APPLICANT') {
        router.push('/apply');
      } else {
        router.push('/admin/dashboard');
      }
    }
  }, [authLoading, isAuthenticated, admin, role, router]);

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-parchment">
        <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Show redirect message if authenticated
  if (isAuthenticated && admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-parchment p-8">
        <div className="bg-white border border-hairline p-12 max-w-md w-full text-center shadow-sm">
          <h2 className="font-serif text-2xl font-bold mb-4 text-forest">Active Session</h2>
          <p className="text-ink/60 mb-6 text-sm">
            You are logged in as <strong>{admin.email}</strong>.
          </p>
          <p className="text-xs uppercase tracking-widest text-forest font-bold animate-pulse">Redirecting...</p>
        </div>
      </div>
    );
  }
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [otpLoading, setOtpLoading] = useState(false);
  const [testOtpCode, setTestOtpCode] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleGoogleSuccess = async (credentialResponse: any) => {
    try {
      const data = await api.googleLogin(credentialResponse.credential);
      if (data.accessToken) {
        localStorage.setItem('arya_token', data.accessToken);
      }
      window.location.href = '/apply';
    } catch (e) {
      setError('Authentication failed. Please try again.');
      console.error('Google Auth Error', e);
    }
  };

  const handleSendOtp = async () => {
    if (!otpEmail || !otpEmail.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    setError(null);
    setOtpLoading(true);
    setTestOtpCode(null);
    try {
      const result = await api.sendOtp(otpEmail);
      setAuthMode('otp-verify');

      // For test account, show OTP on screen
      if (otpEmail.toLowerCase().trim() === TEST_EMAIL && (result as any).otp) {
        setTestOtpCode((result as any).otp);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to send OTP');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleOtpInputChange = (index: number, value: string) => {
    if (value.length > 1) value = value.slice(-1);
    if (value && !/^\d$/.test(value)) return;
    
    const newDigits = [...otpDigits];
    newDigits[index] = value;
    setOtpDigits(newDigits);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all filled
    if (newDigits.every(d => d !== '') && value) {
      handleVerifyOtp(newDigits.join(''));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const digits = pasted.split('');
      setOtpDigits(digits);
      handleVerifyOtp(pasted);
    }
  };

  const handleVerifyOtp = async (code: string) => {
    setError(null);
    setOtpLoading(true);
    try {
      const data = await api.verifyOtp(otpEmail, code);
      if (data.accessToken) {
        localStorage.setItem('arya_token', data.accessToken);
      }
      window.location.href = '/apply';
    } catch (e: any) {
      setError(e.message || 'Invalid OTP');
      setOtpDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setError(null);
    setOtpLoading(true);
    setTestOtpCode(null);
    try {
      const result = await api.sendOtp(otpEmail);
      setOtpDigits(['', '', '', '', '', '']);
      if (otpEmail.toLowerCase().trim() === TEST_EMAIL && (result as any).otp) {
        setTestOtpCode((result as any).otp);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to resend OTP');
    } finally {
      setOtpLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-parchment font-sans relative">
      <div className="max-w-md w-full">
        {/* Back button above auth card */}
        <button 
          onClick={() => window.history.back()}
          className="text-sm uppercase tracking-widest text-forest/70 hover:text-terracotta font-medium transition-colors mb-6 block"
        >
          ← Back
        </button>
        
        <div className="border border-hairline bg-white shadow-sm p-12">
          <div className="flex flex-col items-center text-center space-y-6">
            {/* Logo – respects site settings toggle */}
            {mounted && logoMode === 'text' ? (
              <div className="flex flex-col items-end max-w-max mx-auto">
                <span className="text-4xl font-serif italic font-bold text-forest leading-none">Aryavartham</span>
                <span className="text-sm font-serif italic text-forest mt-1 leading-none text-right w-full pr-1">- The Founder&apos;s Club</span>
              </div>
            ) : (
              <img src="/logo-full.svg" alt="Aryavartham" className="h-16 object-contain" />
            )}
            
            <hr className="w-16 border-t border-hairline my-6" />

            <h1 className="text-sm uppercase tracking-[0.2em] text-ink/80 font-bold mb-2">Gatekeeper Authentication</h1>
            <p className="text-xs text-ink/60 mb-8 leading-relaxed">
              Verify your identity to access The Founder&apos;s Hub operations center.
            </p>

            {authMode === 'choose' && (
              <div className="w-full space-y-6">
                {/* OTP Login Button */}
                <button
                  onClick={() => setAuthMode('otp-email')}
                  className="w-full bg-forest text-parchment p-3.5 font-bold uppercase tracking-widest text-xs hover:bg-forest/90 transition-colors flex items-center justify-center gap-3"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  Continue with Email OTP
                </button>

                <div className="flex items-center gap-4">
                  <div className="flex-1 h-px bg-hairline"></div>
                  <span className="text-[10px] uppercase tracking-widest text-ink/40 font-semibold">Or</span>
                  <div className="flex-1 h-px bg-hairline"></div>
                </div>
                
                {/* Google Login */}
                <div className="flex flex-col items-center w-full min-h-[50px]">
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={() => setError('Google processing interrupted.')}
                    theme="outline"
                    shape="rectangular"
                    text="continue_with"
                    size="large"
                  />
                </div>
              </div>
            )}

            {authMode === 'otp-email' && (
              <div className="w-full space-y-6">
                <div className="text-left">
                  <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-semibold">Email Address</label>
                  <input
                    type="email"
                    placeholder="aryan@example.com"
                    className="w-full bg-transparent border-b-2 border-ink/20 px-1 py-3 font-sans text-lg focus:outline-none focus:border-forest transition-colors"
                    value={otpEmail}
                    onChange={e => { setOtpEmail(e.target.value); setError(null); }}
                    onKeyDown={e => e.key === 'Enter' && handleSendOtp()}
                    autoFocus
                  />
                </div>
                <button
                  onClick={handleSendOtp}
                  disabled={otpLoading}
                  className="w-full bg-forest text-parchment p-3.5 font-bold uppercase tracking-widest text-xs hover:bg-forest/90 transition-colors disabled:opacity-50"
                >
                  {otpLoading ? 'Sending...' : 'Send Verification Code'}
                </button>
                <button
                  onClick={() => { setAuthMode('choose'); setError(null); }}
                  className="text-xs text-ink/50 hover:text-forest transition-colors uppercase tracking-widest"
                >
                  ← Back to options
                </button>
              </div>
            )}

            {authMode === 'otp-verify' && (
              <div className="w-full space-y-6">
                <div>
                  <p className="text-xs text-ink/60 mb-1">Code sent to</p>
                  <p className="font-serif text-lg text-forest font-bold">{otpEmail}</p>
                </div>

                {/* Show OTP code on screen for test account only */}
                {testOtpCode && (
                  <div className="bg-amber-50 border border-amber-200 p-4">
                    <p className="text-[10px] uppercase tracking-widest text-amber-600 font-bold mb-1">Test Account — OTP Code</p>
                    <p className="font-mono text-2xl font-bold text-amber-800 tracking-[6px]">{testOtpCode}</p>
                  </div>
                )}

                <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
                  {otpDigits.map((digit, i) => (
                    <input
                      key={i}
                      ref={el => { inputRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={e => handleOtpInputChange(i, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(i, e)}
                      className="w-12 h-14 text-center text-2xl font-mono font-bold border-2 border-ink/20 focus:border-forest focus:outline-none transition-colors bg-transparent"
                      autoFocus={i === 0}
                    />
                  ))}
                </div>

                {otpLoading && (
                  <p className="text-xs text-forest uppercase tracking-widest animate-pulse">Verifying...</p>
                )}

                <div className="flex flex-col items-center gap-3 pt-2">
                  <button
                    onClick={handleResendOtp}
                    disabled={otpLoading}
                    className="text-xs text-ink/50 hover:text-forest transition-colors uppercase tracking-widest disabled:opacity-50"
                  >
                    Resend Code
                  </button>
                  <button
                    onClick={() => { setAuthMode('otp-email'); setError(null); setOtpDigits(['', '', '', '', '', '']); setTestOtpCode(null); }}
                    className="text-xs text-ink/50 hover:text-forest transition-colors uppercase tracking-widest"
                  >
                    ← Change Email
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 p-3 bg-terracotta/10 border border-terracotta/30 text-terracotta text-[10px] uppercase tracking-wider w-full">
                {error}
              </div>
            )}
            
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Layout showNav={false}>
      <Suspense fallback={<div className="animate-pulse text-forest font-serif italic text-xl min-h-screen flex items-center justify-center">Loading...</div>}>
        <LoginContent />
      </Suspense>
    </Layout>
  );
}
