"use client";

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Trash2, Mail, ShieldCheck } from 'lucide-react';

const CONTACT_EMAIL = 'privacy@aryavartham.com';

function DataDeletionContent() {
  const searchParams = useSearchParams();
  const confirmationCode = searchParams.get('code');

  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    // Send a simple mailto — no backend needed for manual requests
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=Data%20Deletion%20Request&body=Please%20delete%20all%20data%20associated%20with%20my%20account.%0A%0AEmail%3A%20${encodeURIComponent(email)}`;
    setSubmitted(true);
  };

  // Confirmation screen — shown when Meta redirects user here after deletion callback
  if (confirmationCode) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: '#FEF9F0' }}>
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-6">
            <span className="inline-flex items-center justify-center w-16 h-16 rounded-none" style={{ background: '#133022' }}>
              <CheckCircle2 size={32} color="#FEF9F0" />
            </span>
          </div>
          <h1 className="text-2xl font-bold mb-3" style={{ fontFamily: 'Newsreader, serif', color: '#133022' }}>
            Deletion Request Received
          </h1>
          <p className="text-sm mb-6" style={{ color: '#4A5568' }}>
            Your data deletion request has been logged and will be processed within 30 days.
          </p>
          <div className="p-4 border" style={{ borderColor: '#C2C8C2', background: '#FDFBF7' }}>
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#6B7280', letterSpacing: '0.05rem' }}>Confirmation Code</p>
            <p className="text-lg font-mono font-semibold" style={{ color: '#133022' }}>{confirmationCode}</p>
          </div>
          <p className="text-xs mt-4" style={{ color: '#9CA3AF' }}>
            Keep this code for your records. If you have questions, contact{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#133022', textDecoration: 'underline' }}>{CONTACT_EMAIL}</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#FEF9F0' }}>
      {/* Header */}
      <header className="border-b" style={{ borderColor: '#C2C8C2', background: '#FDFBF7' }}>
        <div className="max-w-3xl mx-auto px-6 py-4">
          <span className="text-lg font-semibold" style={{ fontFamily: 'Newsreader, serif', color: '#133022' }}>
            Aryavartham
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        {/* Title */}
        <div className="flex items-start gap-4 mb-10">
          <span className="inline-flex items-center justify-center w-12 h-12 flex-shrink-0" style={{ background: '#133022' }}>
            <Trash2 size={22} color="#FEF9F0" />
          </span>
          <div>
            <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'Newsreader, serif', color: '#133022' }}>
              Data Deletion Request
            </h1>
            <p style={{ color: '#4A5568', lineHeight: '1.65' }}>
              You can request deletion of any personal data Aryavartham holds about you. We will process your request within 30 days and confirm via email.
            </p>
          </div>
        </div>

        {/* What data we hold */}
        <section className="mb-10 p-6 border" style={{ borderColor: '#C2C8C2', background: '#FDFBF7' }}>
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck size={16} color="#133022" />
            <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: '#133022', letterSpacing: '0.05rem' }}>
              Data We May Hold
            </h2>
          </div>
          <ul className="space-y-2 text-sm" style={{ color: '#4A5568' }}>
            <li className="flex gap-2"><span style={{ color: '#133022' }}>—</span> Name, email address, and phone number provided during application</li>
            <li className="flex gap-2"><span style={{ color: '#133022' }}>—</span> Application responses, uploaded documents, and video submissions</li>
            <li className="flex gap-2"><span style={{ color: '#133022' }}>—</span> WhatsApp notification history (message delivery logs)</li>
            <li className="flex gap-2"><span style={{ color: '#133022' }}>—</span> Platform activity: team membership, sprint data, pitch records</li>
            <li className="flex gap-2"><span style={{ color: '#133022' }}>—</span> Payment and pledge transaction records (retained for legal compliance for 7 years)</li>
          </ul>
          <p className="text-xs mt-4" style={{ color: '#9CA3AF' }}>
            Financial records may be retained beyond deletion where required by Indian law (IT Act, GST).
          </p>
        </section>

        {/* Request form */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: 'Newsreader, serif', color: '#133022' }}>
            Submit a Deletion Request
          </h2>
          <p className="text-sm mb-5" style={{ color: '#6B7280' }}>
            Enter the email address associated with your Aryavartham account.
          </p>

          {submitted ? (
            <div className="flex items-center gap-3 p-4 border" style={{ borderColor: '#133022', background: '#FDFBF7' }}>
              <Mail size={18} color="#133022" />
              <p className="text-sm" style={{ color: '#133022' }}>
                Your email client has opened with a pre-filled deletion request to <strong>{CONTACT_EMAIL}</strong>. Please send it to complete your request.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-md">
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 border text-sm outline-none focus:border-current"
                style={{
                  borderColor: error ? '#5B0902' : '#C2C8C2',
                  background: '#FDFBF7',
                  color: '#133022',
                  borderRadius: 0,
                }}
              />
              {error && <p className="text-xs" style={{ color: '#5B0902' }}>{error}</p>}
              <button
                type="submit"
                className="px-6 py-3 text-sm font-semibold uppercase tracking-widest transition-opacity hover:opacity-80"
                style={{
                  background: '#133022',
                  color: '#FEF9F0',
                  borderRadius: 0,
                  letterSpacing: '0.05rem',
                }}
              >
                Request Deletion
              </button>
            </form>
          )}
        </section>

        {/* Alternative */}
        <section className="border-t pt-8" style={{ borderColor: '#C2C8C2' }}>
          <h2 className="text-sm font-semibold uppercase tracking-widest mb-2" style={{ color: '#133022', letterSpacing: '0.05rem' }}>
            Alternative
          </h2>
          <p className="text-sm" style={{ color: '#4A5568' }}>
            You can also email us directly at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#133022', textDecoration: 'underline' }}>
              {CONTACT_EMAIL}
            </a>{' '}
            with the subject line <em>"Data Deletion Request"</em> and your registered email or phone number. We will respond within 3 business days.
          </p>
        </section>
      </main>

      <footer className="border-t mt-12 py-6 text-center" style={{ borderColor: '#C2C8C2' }}>
        <p className="text-xs" style={{ color: '#9CA3AF' }}>
          © {new Date().getFullYear()} Aryavartham · <a href="/privacy" style={{ color: '#133022' }}>Privacy Policy</a>
        </p>
      </footer>
    </div>
  );
}

export default function DataDeletionPage() {
  return (
    <Suspense>
      <DataDeletionContent />
    </Suspense>
  );
}
