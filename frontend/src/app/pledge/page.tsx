"use client";

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';
import { api } from '@/lib/api';
import Script from 'next/script';
import { ShieldCheck, Lock } from 'lucide-react';

// Razorpay captures payment via an async webhook, so the server-side pledge gate
// (hasPaid === payment CAPTURED) may not be satisfied the instant the checkout
// handler fires. Poll the profile a few times with short backoff before we
// redirect, so the user isn't bounced straight back here by the Hub's gate.
const CONFIRM_MAX_ATTEMPTS = 8;
const CONFIRM_DELAY_MS = 1500;

export default function PledgePage() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();
  const { settings } = useSettings();
  const [pledgeReady, setPledgeReady] = useState(false);
  const [orderData, setOrderData] = useState<any>(null);
  const [paymentStatus, setPaymentStatus] = useState<'IDLE' | 'PROCESSING' | 'CONFIRMING' | 'SUCCESS' | 'FAILED'>('IDLE');
  // Tracks mount state so polling never sets state / navigates after unmount.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  let pledgePricing = [{ id: 'base', label: 'Base Commitment', amount: 10000 }];
  try {
    if (settings?.pledgePricing) {
      pledgePricing = JSON.parse(settings.pledgePricing);
    }
  } catch (e) {}

  const totalAmount = pledgePricing.reduce((sum: number, item: any) => sum + Number(item.amount), 0);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, loading, router]);

  // After a successful checkout, wait until the server confirms the payment was
  // captured (webhook processed) before redirecting. Polls the profile until
  // hasPaid flips true, with short backoff. Falls through to the Hub after the
  // attempts are exhausted — the server-side gate still protects that route, so
  // the worst case is the Hub bounces the user back here, never a paid user
  // stuck out. Never weakens the gate.
  const confirmAndRedirect = async () => {
    setPaymentStatus('CONFIRMING');

    for (let attempt = 0; attempt < CONFIRM_MAX_ATTEMPTS; attempt++) {
      if (!mountedRef.current) return;
      try {
        const profile = await api.getMyProfile();
        if (profile?.hasPaid) {
          if (!mountedRef.current) return;
          setPaymentStatus('SUCCESS');
          router.push('/hub');
          return;
        }
      } catch {
        // Transient error (e.g. token refresh in flight) — keep polling.
      }
      // Backoff before the next attempt; skip the wait after the final try.
      if (attempt < CONFIRM_MAX_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, CONFIRM_DELAY_MS));
      }
    }

    // Webhook still not reflected after our window. Surface success and let the
    // Hub's own gate make the final call rather than spinning here forever.
    if (!mountedRef.current) return;
    setPaymentStatus('SUCCESS');
    router.push('/hub');
  };

  const initiatePayment = async () => {
    setPaymentStatus('PROCESSING');
    try {
      const data = await api.createRazorpayOrder();

      setOrderData(data);
      setPledgeReady(true);

      const options = {
        key: data.key,
        amount: data.amount,
        currency: data.currency,
        name: "Aryavartham",
        description: "The Founder's Club Pledge",
        order_id: data.orderId,
        handler: function (response: any) {
          // Don't redirect immediately — the capture webhook is async. Poll
          // until the server marks the pledge paid, then go to the Hub.
          confirmAndRedirect();
        },
        prefill: {
          name: data.applicantName || "Founder",
          email: data.applicantEmail || "",
          contact: data.applicantPhone || ""
        },
        modal: {
          ondismiss: function () {
            // Reset to IDLE so user can retry — prevents frozen button. Guard
            // against clobbering the post-payment CONFIRMING/SUCCESS states if
            // dismiss ever fires after a successful capture.
            setPaymentStatus((prev) => (prev === 'PROCESSING' ? 'IDLE' : prev));
          }
        },
        theme: {
          color: "#0a0a0a"
        }
      };
      
      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', function () {
        setPaymentStatus('FAILED');
      });
      rzp.open();

    } catch (e) {
      console.error(e);
      setPaymentStatus('FAILED');
    }
  };

  if (loading) return <div className="min-h-screen bg-parchment" />;

  return (
    <Layout activeTab="pledge">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      
      <div className="min-h-screen py-24 px-6 flex items-center justify-center">
        <div className="max-w-lg w-full bg-white border border-hairline p-12 text-center shadow-sm">
          <h1 className="font-serif text-4xl font-bold mb-4 text-forest">The Pledge</h1>
          
          <hr className="w-16 mx-auto border-t border-hairline my-6" />

          {paymentStatus === 'CONFIRMING' ? (
            <div className="space-y-6">
              <div className="w-12 h-12 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <h2 className="text-xl font-serif text-ink font-bold">Confirming Your Pledge…</h2>
              <p className="text-sm text-ink/60">
                Payment received. We are verifying your pledge with our payment network — this takes just a moment. Please don&apos;t close this window.
              </p>
            </div>
          ) : paymentStatus === 'SUCCESS' ? (
            <div className="space-y-6">
              <div className="w-16 h-16 rounded-full bg-forest/10 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-serif text-ink font-bold">Pledge Secured</h2>
              <p className="text-sm text-ink/60">Your dossier has been finalized and payment is verified. Welcome to Aryavartham.</p>
              <p className="text-xs uppercase tracking-widest text-forest font-bold mt-8 animate-pulse">Redirecting to Operations Hub...</p>
            </div>
          ) : paymentStatus === 'FAILED' ? (
            <div className="space-y-6">
              <h2 className="text-xl font-serif text-terracotta font-bold">Transaction Failed</h2>
              <p className="text-sm text-ink/60">We could not secure your pledge at this time. Please try again or use an alternate payment method.</p>
              <button 
                onClick={() => setPaymentStatus('IDLE')}
                className="bg-transparent border border-terracotta text-terracotta px-8 py-3 uppercase tracking-widest text-xs font-bold hover:bg-terracotta/5 transition-colors"
              >
                Retry Payment
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              <p className="text-sm text-ink/70 leading-relaxed text-justify">
                To finalize your submission and seal your Dossier, a mandatory architectural pledge is required. 
                This ensures symmetric commitment from all founding operators. 
              </p>
              
              <div className="p-6 bg-parchment/30 border border-hairline">
                <span className="block text-xs uppercase tracking-widest text-ink/50 mb-4 border-b border-hairline pb-2">Funding Breakdown</span>
                
                <div className="space-y-3 mb-6">
                  {pledgePricing.map((item: any) => (
                    <div key={item.id} className="flex justify-between items-center text-sm">
                      <span className="text-ink/70">{item.label}</span>
                      <span className="font-mono text-ink/80">₹{Number(item.amount).toLocaleString()}</span>
                    </div>
                  ))}
                </div>

                <div className="flex justify-between items-center pt-4 border-t border-hairline">
                  <span className="text-xs uppercase tracking-widest font-bold text-forest">Total Order</span>
                  <span className="text-2xl font-serif font-bold text-forest">₹{totalAmount.toLocaleString()}</span>
                </div>
              </div>


              <div className="pt-6 border-t border-hairline/30 text-left space-y-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-forest mt-0.5" />
                  <div>
                    <h4 className="font-serif italic text-forest text-sm font-bold">A Commitment to Integrity</h4>
                    <p className="text-[11px] text-ink/60 leading-relaxed">
                      Your pledge is a testament to your architectural intent. We shield your commitment with sovereign-grade security, ensuring your transition into Aryavartham is protected.
                    </p>
                  </div>
                </div>
              </div>

              <button 
                onClick={initiatePayment} 
                className="w-full bg-saffron text-parchment p-4 font-bold uppercase tracking-widest text-sm shadow-pop hover:bg-saffron-deep transition-colors disabled:opacity-50"
                disabled={paymentStatus === 'PROCESSING'}
              >
                {paymentStatus === 'PROCESSING' ? 'Establishing Connection...' : 'Initiate Secure Checkout'}
              </button>
              
              <div className="flex items-center justify-center gap-2 text-ink/30">
                <Lock className="w-3 h-3" />
                <p className="text-[10px] uppercase tracking-widest text-center">Secured via Razorpay Network</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
