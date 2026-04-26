"use client";

import { ShieldCheck, ArrowRight, X, AlertTriangle } from 'lucide-react';

interface PledgeProps {
  onCommit: () => void;
  onClose: () => void;
}

export default function Pledge({ onCommit, onClose }: PledgeProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-parchment border-b border-hairline sticky top-0 z-50">
        <div className="flex justify-between items-center w-full px-8 py-6 max-w-screen-2xl mx-auto">
          <div className="flex flex-col">
            <span className="text-3xl font-serif italic font-bold text-forest leading-none">Aryavartham</span>
            <span className="text-sm font-serif italic text-forest mt-1 leading-none text-right">- The Founder's Club</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-sans uppercase tracking-widest text-ink/60">Step 02 / 02</span>
            <button onClick={onClose} className="text-forest hover:text-terracotta transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-grow flex flex-col md:flex-row overflow-hidden">
        {/* Left: The Pledge Terms */}
        <section className="w-full md:w-1/2 p-8 md:p-16 lg:p-24 flex flex-col justify-center border-b md:border-b-0 md:border-r border-hairline bg-alabaster">
          <div className="max-w-xl mx-auto md:mx-0">
            <span className="text-terracotta font-sans text-[10px] uppercase tracking-[0.2em] mb-8 block">
              Member Covenant
            </span>
            <h1 className="text-5xl md:text-6xl font-serif text-forest mb-12 leading-tight">The Pledge.</h1>
            <div className="space-y-8 font-serif text-xl text-ink/80 leading-relaxed italic">
              <p>
                &quot;I understand that entry into The Founder&apos;s Club is not merely a transaction, but a commitment to a collective of visionaries.&quot;
              </p>
              <p>
                &quot;This one-time processing fee covers the cost of screening, profiling, and matching me with a team of like-minded builders.&quot;
              </p>
              <p>
                &quot;I acknowledge that this is a <span className="text-terracotta font-bold not-italic">non-refundable processing fee</span> that enables the infrastructure required to evaluate and place every applicant.&quot;
              </p>
            </div>
            <div className="mt-16 pt-16 border-t border-hairline/30">
              <div className="flex items-center gap-6">
                <div className="w-12 h-12 bg-forest/10 flex items-center justify-center text-forest">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-sans text-[10px] uppercase tracking-widest text-ink/60">Secured Payment</p>
                  <p className="font-serif text-sm italic">Processed securely via Razorpay</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right: Payment Module */}
        <section className="w-full md:w-1/2 p-8 md:p-16 lg:p-24 flex flex-col justify-center bg-parchment">
          <div className="max-w-md mx-auto w-full">
            <div className="mb-12">
              <h2 className="font-serif text-3xl mb-2">Complete Registration</h2>
              <p className="text-ink/60 text-sm">Review the processing fee and proceed to payment.</p>
            </div>

            <div className="border border-hairline bg-white p-8 mb-8">
              <div className="flex justify-between items-center mb-6">
                <span className="font-sans text-[10px] uppercase tracking-widest text-ink/60">Item</span>
                <span className="font-sans text-[10px] uppercase tracking-widest text-ink/60">Amount</span>
              </div>
              <div className="flex justify-between items-baseline border-b border-hairline/20 pb-4 mb-4">
                <div>
                  <span className="font-serif text-xl block">Registration Processing Fee</span>
                  <span className="text-[10px] text-ink/50 uppercase tracking-widest">Profile screening, profiling & team matching</span>
                </div>
                <span className="font-sans text-xl font-semibold whitespace-nowrap ml-4">₹ 1,299</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-ink/60">GST & Processing</span>
                <span className="text-sm text-ink/60">Included</span>
              </div>
              <div className="mt-8 pt-6 border-t border-forest/10 flex justify-between items-baseline">
                <span className="font-sans text-xs uppercase tracking-widest font-bold">Total</span>
                <span className="text-3xl font-serif text-forest">₹ 1,299</span>
              </div>
            </div>

            {/* No Refund Notice */}
            <div className="border-2 border-terracotta/30 bg-terracotta/5 p-5 mb-8 flex items-start gap-4">
              <AlertTriangle className="w-5 h-5 text-terracotta shrink-0 mt-0.5" />
              <div>
                <p className="font-sans text-xs uppercase tracking-widest font-bold text-terracotta mb-1">
                  No Refunds Policy
                </p>
                <p className="text-sm text-ink/70 leading-relaxed">
                  This is a one-time, non-refundable processing fee collected for screening your profile, profiling your skills and experience, and matching you with a suitable team. By proceeding, you acknowledge and accept that <strong className="text-ink">no refunds will be issued</strong> under any circumstances. Please refer to our <a href="/terms#refund" className="text-forest underline italic">Refund Policy</a> for full details.
                </p>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={onCommit}
                className="w-full bg-forest text-white py-6 font-sans text-xs uppercase tracking-[0.3em] hover:bg-forest/90 transition-colors duration-300 flex items-center justify-center gap-3 active:scale-[0.98]"
              >
                Proceed to Payment
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-6 text-center space-y-2">
              <p className="text-[10px] font-sans uppercase tracking-widest text-ink/40">
                You will be redirected to Razorpay secure checkout
              </p>
              <p className="text-[10px] font-sans uppercase tracking-widest text-ink/40">
                By proceeding, you agree to our <a href="/terms" className="text-forest underline">Terms &amp; Conditions</a>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
