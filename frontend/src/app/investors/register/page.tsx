'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import Layout from '@/components/Layout';
import Link from 'next/link';

export default function InvestorRegistration() {
  const [form, setForm] = useState({ name: '', email: '', company: '', linkedinUrl: '' });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      await api.registerInvestor(form);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout activeTab="investors">
      <div className="max-w-2xl mx-auto py-20 px-6 animate-fade-in">
        <div className="mb-12">
          <Link href="/investors" className="text-sm text-ink/60 hover:text-forest uppercase tracking-widest font-semibold mb-4 block inline-flex gap-2 items-center">
            ← Back to Showcase
          </Link>
          <h1 className="font-serif text-5xl font-bold mb-4">Capital Allocation</h1>
          <p className="text-lg text-ink/70 max-w-xl">
            Register for access to the Arya Network's vetted startup pipeline. We match capital with the execution capacity of our alumni.
          </p>
        </div>

        {success ? (
          <div className="bg-forest/10 border border-forest/20 p-8 text-center">
            <h2 className="font-serif text-2xl font-bold text-forest mb-2">Registration Received</h2>
            <p className="text-ink/80 mb-6">Your application is under review by our operations team. You will receive an email once approved.</p>
            <Link href="/investors" className="btn btn-secondary border border-hairline bg-white">
              Return to Showcase
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white border border-hairline p-8 shadow-sm">
            {error && (
              <div className="bg-terracotta/10 text-terracotta border border-terracotta/20 p-4 mb-6 text-sm font-semibold">
                {error}
              </div>
            )}
            
            <div className="grid gap-6">
              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/70 mb-2">
                  Full Name
                </label>
                <input 
                  type="text" required 
                  className="w-full bg-parchment/30 border border-hairline px-4 py-3 focus:border-forest outline-none transition-colors"
                  value={form.name} onChange={e => setForm({...form, name: e.target.value})} 
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/70 mb-2">
                  Professional Email
                </label>
                <input 
                  type="email" required 
                  className="w-full bg-parchment/30 border border-hairline px-4 py-3 focus:border-forest outline-none transition-colors"
                  value={form.email} onChange={e => setForm({...form, email: e.target.value})} 
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/70 mb-2">
                  Firm / Company
                </label>
                <input 
                  type="text" required 
                  className="w-full bg-parchment/30 border border-hairline px-4 py-3 focus:border-forest outline-none transition-colors"
                  value={form.company} onChange={e => setForm({...form, company: e.target.value})} 
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest font-semibold text-ink/70 mb-2">
                  LinkedIn Profile URL
                </label>
                <input 
                  type="url" required 
                  className="w-full bg-parchment/30 border border-hairline px-4 py-3 focus:border-forest outline-none transition-colors"
                  value={form.linkedinUrl} onChange={e => setForm({...form, linkedinUrl: e.target.value})} 
                />
                <p className="text-[10px] text-ink/50 mt-2 uppercase tracking-widest">
                  Required for identity verification
                </p>
              </div>

              <div className="pt-4 border-t border-hairline border-dashed">
                <button type="submit" disabled={loading} className="w-full btn bg-ink text-white hover:bg-forest py-4 font-bold tracking-widest">
                  {loading ? 'Submitting...' : 'REQUEST ACCESS'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </Layout>
  );
}
