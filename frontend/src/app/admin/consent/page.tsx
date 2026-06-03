'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

// Setting keys follow the existing camelCase convention (logoMode, pledgePricing).
// The consent funnel video + affidavit template are stored as plain URL strings;
// settings hold strings only, so the affidavit is referenced by a hosted-document
// URL (mirroring how the public consent flow passes a consentDocUrl string).
const VIDEO_KEY = 'consentVideoUrl';
const AFFIDAVIT_KEY = 'affidavitTemplateUrl';

type Feedback = { type: 'success' | 'error'; message: string } | null;

export default function ConsentPage() {
  const [videoUrl, setVideoUrl] = useState('');
  const [affidavitUrl, setAffidavitUrl] = useState('');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [savingVideo, setSavingVideo] = useState(false);
  const [savingAffidavit, setSavingAffidavit] = useState(false);

  const [videoFeedback, setVideoFeedback] = useState<Feedback>(null);
  const [affidavitFeedback, setAffidavitFeedback] = useState<Feedback>(null);

  // Load existing values
  useEffect(() => {
    api
      .getSettings()
      .then((settings) => {
        setVideoUrl(settings[VIDEO_KEY] || '');
        setAffidavitUrl(settings[AFFIDAVIT_KEY] || '');
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  const saveVideo = async () => {
    setSavingVideo(true);
    setVideoFeedback(null);
    try {
      await api.updateSetting(VIDEO_KEY, videoUrl.trim());
      setVideoFeedback({ type: 'success', message: 'Video reference persisted.' });
    } catch (err: any) {
      setVideoFeedback({ type: 'error', message: err?.message || 'Failed to save video reference.' });
    } finally {
      setSavingVideo(false);
    }
  };

  const saveAffidavit = async () => {
    setSavingAffidavit(true);
    setAffidavitFeedback(null);
    try {
      await api.updateSetting(AFFIDAVIT_KEY, affidavitUrl.trim());
      setAffidavitFeedback({ type: 'success', message: 'Affidavit template persisted.' });
    } catch (err: any) {
      setAffidavitFeedback({ type: 'error', message: err?.message || 'Failed to save affidavit template.' });
    } finally {
      setSavingAffidavit(false);
    }
  };

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen relative">
      <header className="border-b border-hairline pb-8 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none">Affidavit Protocol</h1>
        </div>
        <div className="text-left md:text-right">
          <p className="text-sm text-ink/40 uppercase tracking-widest mb-1">Define mandatory execution funnels</p>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 bg-forest/10 flex items-center justify-center border border-forest/20 animate-pulse">
            <span className="font-serif text-sm text-forest">...</span>
          </div>
        </div>
      ) : (
        <>
          {loadError && (
            <div className="border border-terracotta/40 bg-terracotta/5 text-terracotta px-6 py-4 mb-8 text-xs uppercase tracking-widest font-semibold">
              Failed to load existing configuration. You can still set new values below.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Video Card */}
            <div className="border border-hairline bg-white p-8 group hover:border-forest transition-colors flex flex-col">
              <h3 className="font-serif text-2xl font-bold mb-4 flex items-center gap-3">
                <span className="text-2xl">📹</span> Initialization Broadcast
              </h3>
              <p className="text-xs uppercase tracking-widest text-ink/60 mb-8 leading-relaxed font-semibold">
                Upload or link a mandated video broadcast that applicants must consume prior to affidavit signatures.
              </p>
              <div className="mb-6 flex-1">
                <label htmlFor="consent-video-url" className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Video URI</label>
                <input
                  id="consent-video-url"
                  type="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                  placeholder="https://youtube.com/watch?v=..."
                />
              </div>
              {videoFeedback && (
                <p
                  className={`text-xs uppercase tracking-widest font-semibold mb-4 ${
                    videoFeedback.type === 'success' ? 'text-forest' : 'text-terracotta'
                  }`}
                >
                  {videoFeedback.message}
                </p>
              )}
              <button
                onClick={saveVideo}
                disabled={savingVideo}
                className="bg-ink hover:opacity-90 text-white px-8 py-3 text-xs uppercase tracking-widest font-semibold transition-opacity self-start disabled:opacity-50"
              >
                {savingVideo ? 'Persisting...' : 'Persist Reference'}
              </button>
            </div>

            {/* Agreement Card */}
            <div className="border border-hairline bg-white p-8 group hover:border-forest transition-colors flex flex-col">
              <h3 className="font-serif text-2xl font-bold mb-4 flex items-center gap-3">
                <span className="text-2xl">📄</span> Binding Affidavit
              </h3>
              <p className="text-xs uppercase tracking-widest text-ink/60 mb-8 leading-relaxed font-semibold">
                Define the target covenant document required for standard digital execution via the e-sign workflow.
              </p>
              <div className="mb-6 flex-1">
                <label htmlFor="affidavit-template-url" className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Template Document URI</label>
                <input
                  id="affidavit-template-url"
                  type="url"
                  value={affidavitUrl}
                  onChange={(e) => setAffidavitUrl(e.target.value)}
                  className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                  placeholder="https://.../affidavit-template.pdf"
                />
              </div>
              {affidavitFeedback && (
                <p
                  className={`text-xs uppercase tracking-widest font-semibold mb-4 ${
                    affidavitFeedback.type === 'success' ? 'text-forest' : 'text-terracotta'
                  }`}
                >
                  {affidavitFeedback.message}
                </p>
              )}
              <button
                onClick={saveAffidavit}
                disabled={savingAffidavit}
                className="bg-saffron hover:bg-saffron-deep text-parchment px-8 py-3 text-xs uppercase tracking-widest font-semibold transition-colors self-start disabled:opacity-50"
              >
                {savingAffidavit ? 'Transmitting...' : 'Transmit Payload'}
              </button>
            </div>
          </div>
        </>
      )}

      <div className="border border-hairline bg-ink text-parchment p-8 mt-12">
        <h3 className="font-serif text-2xl font-bold mb-8">
          Standard Execution Funnel
        </h3>
        <div className="flex flex-col md:flex-row gap-6 items-start md:items-center flex-wrap">
          {['Consume Broadcast', 'Parse Covenant', 'Affix Primary Consent', 'Transmit Signature', 'Notarization Complete'].map((step, i) => (
            <div key={i} className="flex items-center gap-4 group">
              <div className="w-10 h-10 border border-parchment/30 bg-white/5 flex items-center justify-center font-serif text-xl font-bold group-hover:bg-terracotta-warm group-hover:text-white group-hover:border-terracotta-warm transition-colors">
                {i + 1}
              </div>
              <span className="text-xs uppercase tracking-widest font-semibold">{step}</span>
              {i < 4 && <span className="text-parchment/40 hidden md:inline-block ml-2 group-hover:translate-x-1 transition-transform">→</span>}
            </div>
          ))}
        </div>
        <p className="text-[10px] uppercase tracking-widest text-parchment/40 mt-8 border-t border-parchment/10 pt-4">
          The pipeline dictates strictly ordered linear traversal. Docusign integration operates externally via callback execution hooks.
        </p>
      </div>
    </div>
  );
}
