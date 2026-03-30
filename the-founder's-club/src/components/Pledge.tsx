import { ShieldCheck, Lock, ArrowRight, X } from 'lucide-react';

interface PledgeProps {
  onCommit: () => void;
  onClose: () => void;
}

export default function Pledge({ onCommit, onClose }: PledgeProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-parchment border-b border-hairline sticky top-0 z-50">
        <div className="flex justify-between items-center w-full px-8 py-6 max-w-screen-2xl mx-auto">
          <div className="text-2xl font-serif italic text-forest">The Founder's Club</div>
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
                "I understand that entry into The Founder’s Club is not merely a transaction, but a commitment to a collective of visionaries."
              </p>
              <p>
                "This 10 INR investment serves as a symbol of intent. It is a filter for the dedicated and a barrier to the uninspired."
              </p>
              <p>
                "I acknowledge that this amount is <span className="text-forest font-bold not-italic">fully refundable</span> should my application be declined, or at any point within the first 30 days of membership."
              </p>
            </div>
            <div className="mt-16 pt-16 border-t border-hairline/30">
              <div className="flex items-center gap-6">
                <div className="w-12 h-12 bg-forest/10 flex items-center justify-center text-forest">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-sans text-[10px] uppercase tracking-widest text-ink/60">Secured Protocol</p>
                  <p className="font-serif text-sm italic">Encrypted via RSA-4096 Heritage Systems</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right: Payment Module */}
        <section className="w-full md:w-1/2 p-8 md:p-16 lg:p-24 flex flex-col justify-center bg-parchment">
          <div className="max-w-md mx-auto w-full">
            <div className="mb-12">
              <h2 className="font-serif text-3xl mb-2">Finalize Investment</h2>
              <p className="text-ink/60 text-sm">Review your selection and commit to the network.</p>
            </div>

            <div className="border border-hairline bg-white p-8 mb-12">
              <div className="flex justify-between items-center mb-6">
                <span className="font-sans text-[10px] uppercase tracking-widest text-ink/60">Item</span>
                <span className="font-sans text-[10px] uppercase tracking-widest text-ink/60">Amount</span>
              </div>
              <div className="flex justify-between items-baseline border-b border-hairline/20 pb-4 mb-4">
                <span className="font-serif text-xl">Lifetime Membership Initiation</span>
                <span className="font-sans text-xl font-semibold">10 INR</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-ink/60">Processing Fee</span>
                <span className="text-sm text-ink/60">0 INR</span>
              </div>
              <div className="mt-8 pt-6 border-t border-forest/10 flex justify-between items-baseline">
                <span className="font-sans text-xs uppercase tracking-widest font-bold">Total Commitment</span>
                <span className="text-3xl font-serif text-forest">₹ 10.00</span>
              </div>
            </div>

            <form 
              className="space-y-6"
              onSubmit={(e) => {
                e.preventDefault();
                onCommit();
              }}
            >
              <div>
                <label className="block font-sans text-[10px] uppercase tracking-widest text-terracotta mb-2">
                  Cardholder Identity
                </label>
                <input
                  type="text"
                  placeholder="FULL NAME AS RECOGNIZED"
                  className="w-full bg-transparent border-0 border-b border-ink py-3 focus:ring-0 focus:border-forest placeholder:text-hairline/50 text-sm font-sans tracking-wider uppercase"
                  required
                />
              </div>
              <div>
                <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2">
                  Secure Information
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="CARD NUMBER"
                    className="w-full bg-transparent border-0 border-b border-ink py-3 focus:ring-0 focus:border-forest placeholder:text-hairline/50 text-sm font-sans tracking-wider"
                    required
                  />
                  <Lock className="absolute right-0 bottom-3 w-4 h-4 text-hairline" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2">Expiry</label>
                  <input
                    type="text"
                    placeholder="MM / YY"
                    className="w-full bg-transparent border-0 border-b border-ink py-3 focus:ring-0 focus:border-forest placeholder:text-hairline/50 text-sm font-sans tracking-wider"
                    required
                  />
                </div>
                <div>
                  <label className="block font-sans text-[10px] uppercase tracking-widest text-ink/60 mb-2">Security Code</label>
                  <input
                    type="password"
                    placeholder="CVC"
                    className="w-full bg-transparent border-0 border-b border-ink py-3 focus:ring-0 focus:border-forest placeholder:text-hairline/50 text-sm font-sans tracking-wider"
                    required
                  />
                </div>
              </div>
              <div className="pt-8">
                <button
                  type="submit"
                  className="w-full bg-terracotta text-white py-6 font-sans text-xs uppercase tracking-[0.3em] hover:bg-terracotta/90 transition-colors duration-300 flex items-center justify-center gap-3 active:scale-[0.98]"
                >
                  Commit 10 INR
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
            <div className="mt-8 text-center">
              <p className="text-[10px] font-sans uppercase tracking-widest text-ink/60">
                Transactions are governed by the Founder's Charter.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
