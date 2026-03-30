"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import Script from 'next/script';

export default function PledgePage() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();
  const [pledgeReady, setPledgeReady] = useState(false);
  const [orderData, setOrderData] = useState<any>(null);
  const [paymentStatus, setPaymentStatus] = useState<'IDLE' | 'PROCESSING' | 'SUCCESS' | 'FAILED'>('IDLE');

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, loading, router]);

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
          // Razorpay returns razorpay_payment_id, razorpay_order_id, razorpay_signature
          // We can let Webhooks deal with DB updates, but show success here
          setPaymentStatus('SUCCESS');
          setTimeout(() => {
            router.push('/hub');
          }, 3000);
        },
        prefill: {
          name: "Founder",
          email: "",
          contact: ""
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

          {paymentStatus === 'SUCCESS' ? (
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
                <span className="block text-xs uppercase tracking-widest text-ink/50 mb-2">Active Batch Allocation</span>
                <span className="block text-3xl font-serif font-bold text-forest">Standard Fulfillment</span>
                <span className="block text-xs tracking-wide text-ink/40 mt-1">Amount dynamically synced</span>
              </div>

              <button 
                onClick={initiatePayment} 
                className="w-full bg-forest text-parchment p-4 font-bold uppercase tracking-widest text-sm hover:bg-forest/90 transition-colors disabled:opacity-50"
                disabled={paymentStatus === 'PROCESSING'}
              >
                {paymentStatus === 'PROCESSING' ? 'Establishing Connection...' : 'Initiate Secure Checkout'}
              </button>
              
              <p className="text-[10px] uppercase text-ink/30 tracking-widest">Secured via Razorpay Network</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
