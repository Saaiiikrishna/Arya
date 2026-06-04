'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { MessageCircle, CheckCircle2, Loader2 } from 'lucide-react';

/**
 * Server-side WhatsApp verification. The only client path that can flip an
 * applicant's `whatsappVerified` flag — and only by proving control of the
 * number via a one-time code. Renders nothing for non-applicant accounts
 * (the profile fetch 404s) or until the profile has loaded.
 */
export default function WhatsappVerify() {
  const [profile, setProfile] = useState<any>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [step, setStep] = useState<'idle' | 'sent'>('idle');
  const [otp, setOtp] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    api
      .getMyProfile()
      .then((p) => setProfile(p))
      .catch(() => setUnavailable(true));
  }, []);

  if (unavailable || !profile) return null;

  const phone = profile.whatsappPhone || profile.phone;
  const verified = !!profile.whatsappVerified;

  const sendCode = async () => {
    setError('');
    setInfo('');
    setSending(true);
    try {
      const res = await api.sendWhatsappVerifyOtp();
      if (res.alreadyVerified) {
        setProfile({ ...profile, whatsappVerified: true });
        return;
      }
      setStep('sent');
      setInfo('A 6-digit code was sent to your WhatsApp. It expires in 5 minutes.');
    } catch (e: any) {
      setError(e?.message || 'Could not send the verification code.');
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    setError('');
    setInfo('');
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit code.');
      return;
    }
    setVerifying(true);
    try {
      await api.verifyWhatsappOtp(otp);
      setProfile({ ...profile, whatsappVerified: true });
      setStep('idle');
      setOtp('');
    } catch (e: any) {
      setError(e?.message || 'Verification failed. Check the code and try again.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="border border-hairline bg-parchment/30 p-6">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-forest" />
          <span className="text-[10px] uppercase tracking-widest text-ink/50 font-bold">
            WhatsApp Verification
          </span>
        </div>
        {verified && (
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-forest">
            <CheckCircle2 className="w-3.5 h-3.5" /> Verified
          </span>
        )}
      </div>

      {verified ? (
        <p className="text-[12px] text-ink/50">
          {phone ? <span className="font-serif text-ink">{phone}</span> : 'Your number'} is verified —
          you&apos;ll receive programme updates on WhatsApp.
        </p>
      ) : !phone ? (
        <p className="text-[12px] text-ink/50">
          Add a WhatsApp number to your application to enable verification.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-[12px] text-ink/50">
            Verify <span className="font-serif text-ink">{phone}</span> to receive cohort updates,
            interview details, and announcements on WhatsApp.
          </p>

          {step === 'sent' && (
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="6-digit code"
                className="flex-1 px-3 py-2 border border-hairline bg-white text-[14px] tracking-[0.3em] text-ink focus:border-forest focus:outline-none"
              />
              <button
                onClick={verify}
                disabled={verifying}
                className="px-5 py-2 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {verifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                Verify
              </button>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={sendCode}
              disabled={sending}
              className="px-5 py-2 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageCircle className="w-3 h-3" />}
              {step === 'sent' ? 'Resend code' : 'Send verification code'}
            </button>
          </div>

          {info && <p className="text-[11px] text-forest">{info}</p>}
          {error && <p className="text-[11px] text-terracotta">{error}</p>}
        </div>
      )}
    </div>
  );
}
