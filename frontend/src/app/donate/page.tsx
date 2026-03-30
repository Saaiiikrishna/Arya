'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Layout from '@/components/Layout';
import Script from 'next/script';
import Link from 'next/link';

export default function DonatePage() {
  const [stats, setStats] = useState<any>(null);
  const [form, setForm] = useState({ amount: 1000, isAnonymous: false, donorName: '', donorEmail: '' });
  const [paymentStatus, setPaymentStatus] = useState<'IDLE' | 'PROCESSING' | 'SUCCESS' | 'FAILED'>('IDLE');

  useEffect(() => {
    api.getDonationStats().then(setStats).catch(console.error);
  }, []);

  const initiateDonation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.amount < 100) {
      alert("Minimum donation amount is ₹100");
      return;
    }

    setPaymentStatus('PROCESSING');
    try {
      const orderData = await api.createDonationOrder(form);
      
      const options = {
        key: orderData.key,
        amount: orderData.amount,
        currency: orderData.currency,
        name: "Arya Network",
        description: "Network Sponsorship",
        order_id: orderData.orderId,
        handler: function (response: any) {
          setPaymentStatus('SUCCESS');
          // Refresh stats on success
          api.getDonationStats().then(setStats).catch(console.error);
        },
        prefill: {
          name: form.isAnonymous ? "Anonymous Donor" : form.donorName,
          email: form.isAnonymous ? "" : form.donorEmail,
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

    } catch (e: any) {
      console.error(e);
      setPaymentStatus('FAILED');
      alert(e.message || "Could not initialize payment");
    }
  };

  return (
    <Layout activeTab="donate">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      
      <div className="max-w-[1200px] mx-auto py-20 px-6 animate-fade-in">
        <div className="text-center mb-16">
          <h1 className="font-serif text-5xl font-bold mb-4">Support the Ecosystem</h1>
          <p className="text-lg text-ink/70 max-w-2xl mx-auto">
            100% of your contributions go directly into funding infrastructure, tools, and resources for the Arya builder pipeline.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-16 items-start">
          {/* Donation Stats / Info */}
          <div className="flex flex-col gap-8 flex-1">
            <div className="bg-ink text-parchment p-8">
              <h3 className="font-serif text-2xl font-bold mb-6">Impact Metrics</h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <span className="block text-xs uppercase tracking-widest text-parchment/60 mb-2">Total Funding Pool</span>
                  <span className="font-serif text-4xl text-forest">
                    ₹{stats ? (stats.totalDonated / 100).toLocaleString() : '---'}
                  </span>
                </div>
                <div>
                  <span className="block text-xs uppercase tracking-widest text-parchment/60 mb-2">Network Backers</span>
                  <span className="font-serif text-4xl text-terracotta">
                    {stats ? stats.uniqueDonors : '---'}
                  </span>
                </div>
              </div>
            </div>

            <div className="border border-hairline p-8 bg-white">
              <h3 className="font-serif text-xl font-bold mb-4">Why Sponsor?</h3>
              <ul className="space-y-4 text-ink/80 text-sm">
                <li className="flex gap-3">
                  <span className="text-forest">✓</span>
                  <span>Zero management fees. Capital goes to founders.</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-forest">✓</span>
                  <span>Supports AWS/infrastructure credits for emerging ideas.</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-forest">✓</span>
                  <span>Identified donors receive priority access to demo days.</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Checkout Form */}
          <div className="bg-white border border-hairline p-8 lg:p-10 shadow-sm">
            {paymentStatus === 'SUCCESS' ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-full bg-forest/10 flex-center mx-auto mb-6">
                  <span className="text-forest text-2xl">✓</span>
                </div>
                <h2 className="font-serif text-3xl font-bold mb-4">Capital Received</h2>
                <p className="text-ink/70 mb-8">Thank you for accelerating the Arya ecosystem. Your contribution has been verified.</p>
                <button onClick={() => setPaymentStatus('IDLE')} className="btn btn-secondary border border-hairline">
                  Make Another Contribution
                </button>
              </div>
            ) : (
              <form onSubmit={initiateDonation} className="flex flex-col gap-6">
                <div>
                  <label className="block text-xs uppercase tracking-widest font-semibold text-ink/70 mb-3">
                    Select Contribution Amount (INR)
                  </label>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {[1000, 5000, 10000].map(amt => (
                      <button 
                        key={amt} type="button"
                        onClick={() => setForm({...form, amount: amt})}
                        className={`py-3 border ${form.amount === amt ? 'bg-forest text-white border-forest font-bold' : 'border-hairline bg-parchment/30 text-ink/70 hover:border-forest/50'}`}
                      >
                        ₹{amt.toLocaleString()}
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-serif text-ink/50">₹</span>
                    <input 
                      type="number" min="100" required 
                      className="w-full bg-parchment/30 border border-hairline pl-10 pr-4 py-3 font-serif text-xl focus:border-forest outline-none transition-colors"
                      value={form.amount} onChange={e => setForm({...form, amount: parseInt(e.target.value) || 0})}
                    />
                  </div>
                </div>

                <div className="pt-6 border-t border-hairline border-dashed">
                  <label className="flex items-center gap-3 cursor-pointer mb-6">
                    <input 
                      type="checkbox" 
                      className="accent-forest w-4 h-4"
                      checked={form.isAnonymous}
                      onChange={e => setForm({...form, isAnonymous: e.target.checked})}
                    />
                    <span className="text-sm font-semibold uppercase tracking-widest text-ink/80">Make it Anonymous</span>
                  </label>

                  <div className={`grid gap-4 transition-all duration-300 ${form.isAnonymous ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                    <div>
                      <label className="block text-xs uppercase tracking-widest font-semibold text-ink/70 mb-2">Name</label>
                      <input 
                        type="text" 
                        required={!form.isAnonymous}
                        className="w-full bg-parchment/30 border border-hairline px-4 py-3 focus:border-forest outline-none"
                        value={form.donorName} onChange={e => setForm({...form, donorName: e.target.value})}
                      />
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-widest font-semibold text-ink/70 mb-2">Email</label>
                      <input 
                        type="email" 
                        required={!form.isAnonymous}
                        className="w-full bg-parchment/30 border border-hairline px-4 py-3 focus:border-forest outline-none"
                        value={form.donorEmail} onChange={e => setForm({...form, donorEmail: e.target.value})}
                      />
                    </div>
                  </div>
                </div>

                <button 
                  type="submit" 
                  disabled={paymentStatus === 'PROCESSING'}
                  className="w-full btn bg-ink text-white hover:bg-forest py-4 font-bold tracking-widest mt-4"
                >
                  {paymentStatus === 'PROCESSING' ? 'Initializing Checkout...' : 'CONTRIBUTE CAPITAL'}
                </button>
                <div className="text-center">
                  <span className="text-[10px] uppercase text-ink/40 tracking-widest">Secured via Razorpay</span>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
