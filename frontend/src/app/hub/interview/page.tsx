"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Calendar, Video, CheckCircle, Clock, XCircle, ChevronRight } from 'lucide-react';

const VIDEO_PROMPTS = [
  'In 90 seconds, tell us: what is your idea, and why is it innovative?',
  'What is the one problem you are obsessed with solving, and why now?',
  'Describe a moment when you built something from scratch. What did you learn?',
];

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function InterviewPage() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [booking, setBooking] = useState<any>(null);
  const [video, setVideo] = useState<any>(null);
  const [slots, setSlots] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [bookingSlot, setBookingSlot] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [videoUrls, setVideoUrls] = useState(['', '', '']);
  const [submittingVideo, setSubmittingVideo] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      const [bookingRes, videoRes, hubRes] = await Promise.allSettled([
        api.getMyInterviewBooking(),
        api.getMyVideoSubmission(),
        api.getMyHub(),
      ]);

      if (bookingRes.status === 'fulfilled') setBooking(bookingRes.value);
      if (videoRes.status === 'fulfilled') setVideo(videoRes.value);
      if (hubRes.status === 'fulfilled') {
        const bid = hubRes.value?.applicant?.batchId;
        setBatchId(bid);
        if (bid) {
          const slotsRes = await api.getAvailableInterviewSlots(bid);
          setSlots(slotsRes);
        }
      }
    } catch {
      // partial failure is ok
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) { router.push('/login'); return; }
    fetchAll();
  }, [authLoading, isAuthenticated, router, fetchAll]);

  const handleBook = async (slotId: string) => {
    setBookingSlot(slotId);
    setError('');
    try {
      const res = await api.bookInterviewSlot(slotId);
      setBooking(res);
      setSuccess('Interview slot booked successfully!');
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Booking failed');
    } finally {
      setBookingSlot(null);
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    setError('');
    try {
      await api.cancelInterviewBooking();
      setBooking(null);
      setSuccess('Booking cancelled.');
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Cancellation failed');
    } finally {
      setCancelling(false);
    }
  };

  const handleVideoSubmit = async () => {
    const [url1, url2, url3] = videoUrls;
    if (!url1 && !url2 && !url3) {
      setError('Please provide at least one video URL');
      return;
    }
    setSubmittingVideo(true);
    setError('');
    try {
      const res = await api.submitVideoSubmission({
        videoUrl1: url1 || undefined,
        videoUrl2: url2 || undefined,
        videoUrl3: url3 || undefined,
      });
      setVideo(res);
      setSuccess('Video submission saved!');
    } catch (err: any) {
      setError(err.message || 'Submission failed');
    } finally {
      setSubmittingVideo(false);
    }
  };

  if (authLoading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-parchment">
        <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const decisionColor = (d: string) =>
    d === 'SELECTED' ? 'text-forest bg-forest/10' :
    d === 'REJECTED' ? 'text-terracotta bg-terracotta/10' : 'text-ink/60 bg-ink/5';

  return (
    <div className="min-h-screen flex text-ink bg-parchment font-sans">
      {/* Sidebar */}
      <aside className="w-[250px] border-r border-hairline flex-shrink-0 h-screen sticky top-0 flex flex-col justify-between py-12 px-8">
        <div>
          <div className="mb-16">
            <span className="font-serif text-2xl font-bold tracking-tight">The Founder&apos;s<br />Club.</span>
          </div>
          <nav className="flex flex-col gap-6">
            {[
              { label: 'Overview', href: '/hub' },
              { label: 'Interview', active: true, href: '/hub/interview' },
              { label: 'Referrals & Rewards', href: '/hub/referrals' },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`group flex items-center gap-3 font-medium text-sm tracking-wide uppercase transition-colors ${item.active ? 'text-ink' : 'text-ink/40 hover:text-ink'}`}
              >
                <span className={`w-1 h-1 ${item.active ? 'bg-forest' : 'bg-transparent group-hover:bg-ink'}`} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </div>
      </aside>

      <main className="flex-1 px-16 py-12 overflow-y-auto">
        <div className="max-w-[900px] mx-auto">
          <header className="mb-12">
            <p className="text-sm uppercase tracking-widest text-forest font-semibold mb-2">Stage 0 · Selection</p>
            <h1 className="font-serif text-5xl font-bold">Your Interview</h1>
            <p className="text-ink/50 mt-3 text-lg">
              Two rounds — an async video screening followed by a live panel interview.
            </p>
          </header>

          {(error || success) && (
            <div className={`mb-8 px-6 py-4 border text-sm ${error ? 'border-terracotta/30 bg-terracotta/10 text-terracotta' : 'border-forest/30 bg-forest/10 text-forest'}`}>
              {error || success}
            </div>
          )}

          {/* ── Global REJECTED banner ── */}
          {booking?.decision === 'REJECTED' && (
            <div className="mb-8 bg-white border border-hairline p-8 text-center">
              <XCircle className="w-10 h-10 text-terracotta mx-auto mb-4" />
              <p className="font-serif text-xl font-bold mb-2">Application Unsuccessful</p>
              <p className="text-ink/50 text-sm">Thank you for applying. We hope to see you in a future batch.</p>
            </div>
          )}

          {/* ── Async Video Section ── */}
          <section className="mb-12">
            <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
              <Video className="w-6 h-6 text-forest" />
              Round 1 — Async Video
            </h2>

            {video ? (
              <div className="bg-white border border-hairline p-8">
                <div className="flex items-center gap-3 mb-6">
                  <CheckCircle className="w-5 h-5 text-forest" />
                  <span className="font-bold text-forest uppercase tracking-widest text-xs">Submitted</span>
                  {video.score !== null && video.score !== undefined && (
                    <span className="ml-auto text-sm font-bold text-ink/50">Score: {video.score}/10</span>
                  )}
                </div>
                <div className="space-y-4">
                  {[video.videoUrl1, video.videoUrl2, video.videoUrl3].map((url: string, i: number) => url && (
                    <div key={i} className="flex items-start gap-4 p-4 bg-parchment/50 border border-hairline">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-ink/40 pt-1 w-16 flex-shrink-0">Q{i + 1}</span>
                      <p className="text-xs text-ink/60 flex-1">{VIDEO_PROMPTS[i]}</p>
                      <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-forest underline flex-shrink-0">View</a>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => {
                    setVideoUrls([video.videoUrl1 ?? '', video.videoUrl2 ?? '', video.videoUrl3 ?? '']);
                    setVideo(null);
                  }}
                  className="mt-6 text-xs uppercase tracking-widest text-ink/40 hover:text-ink transition-colors"
                >
                  Update submission
                </button>
              </div>
            ) : (
              <div className="bg-white border border-hairline p-8">
                <p className="text-sm text-ink/60 mb-8 leading-relaxed">
                  Record 3 short videos (60–90 seconds each) answering the prompts below. Upload them to any
                  platform (YouTube, Loom, Google Drive) and paste the shareable links here.
                </p>
                <div className="space-y-6">
                  {VIDEO_PROMPTS.map((prompt, i) => (
                    <div key={i}>
                      <label className="block text-[10px] uppercase tracking-widest text-ink/50 font-bold mb-2">
                        Video {i + 1}
                      </label>
                      <p className="text-sm text-ink mb-3 leading-snug">{prompt}</p>
                      <input
                        type="url"
                        placeholder="Paste video link (YouTube, Loom, Drive…)"
                        value={videoUrls[i]}
                        onChange={(e) => {
                          const next = [...videoUrls];
                          next[i] = e.target.value;
                          setVideoUrls(next);
                        }}
                        className="w-full border border-hairline px-4 py-3 text-sm bg-parchment/30 focus:outline-none focus:border-forest"
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleVideoSubmit}
                  disabled={submittingVideo}
                  className="mt-8 bg-forest text-white px-8 py-4 font-bold uppercase tracking-widest text-sm hover:bg-forest/90 transition-colors disabled:opacity-50"
                >
                  {submittingVideo ? 'Saving…' : 'Submit Video Responses'}
                </button>
              </div>
            )}
          </section>

          {/* ── Live Interview Section ── */}
          <section>
            <h2 className="font-serif text-2xl font-bold mb-6 flex items-center gap-3">
              <Calendar className="w-6 h-6 text-forest" />
              Round 2 — Live Panel Interview
            </h2>

            {booking ? (
              <div className="bg-white border border-hairline p-8">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-ink/40 mb-2 font-bold">Your Slot</p>
                    <p className="font-serif text-2xl font-bold">{formatDateTime(booking.slot.startTime)}</p>
                    <p className="text-ink/50 text-sm mt-1">
                      Ends at {new Date(booking.slot.endTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {booking.decision ? (
                    <span className={`text-xs font-bold uppercase tracking-widest px-3 py-1 ${decisionColor(booking.decision)}`}>
                      {booking.decision}
                    </span>
                  ) : (
                    <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 bg-ink/5 text-ink/50">
                      {booking.status}
                    </span>
                  )}
                </div>

                {booking.slot.notes && (
                  <p className="text-sm text-ink/60 mb-6 p-4 bg-parchment/50 border border-hairline">
                    {booking.slot.notes}
                  </p>
                )}

                {!booking.decision && new Date(booking.slot.startTime).getTime() - Date.now() > 24 * 3_600_000 && (
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="text-xs uppercase tracking-widest text-terracotta hover:underline disabled:opacity-50"
                  >
                    {cancelling ? 'Cancelling…' : 'Cancel this booking'}
                  </button>
                )}
              </div>
            ) : slots.length > 0 ? (
              <div className="space-y-3">
                {slots.map((slot: any) => (
                  <div
                    key={slot.id}
                    className={`bg-white border border-hairline p-6 flex items-center justify-between ${slot.isFull ? 'opacity-50' : ''}`}
                  >
                    <div>
                      <p className="font-bold">{formatDateTime(slot.startTime)}</p>
                      <p className="text-xs text-ink/50 mt-1 flex items-center gap-2">
                        <Clock className="w-3 h-3" />
                        Ends {new Date(slot.endTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        &nbsp;·&nbsp;
                        {slot.availableSeats} seat{slot.availableSeats !== 1 ? 's' : ''} left
                      </p>
                      {slot.notes && <p className="text-xs text-ink/40 mt-2 italic">{slot.notes}</p>}
                    </div>
                    <button
                      onClick={() => !slot.isFull && handleBook(slot.id)}
                      disabled={slot.isFull || !!bookingSlot}
                      className="flex items-center gap-2 px-6 py-3 bg-forest text-white font-bold uppercase tracking-widest text-[10px] hover:bg-forest/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {bookingSlot === slot.id ? 'Booking…' : slot.isFull ? 'Full' : <>Book <ChevronRight className="w-3 h-3" /></>}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white border border-hairline p-12 text-center">
                <Calendar className="w-10 h-10 text-ink/20 mx-auto mb-4" />
                <p className="font-serif text-xl font-bold mb-2">No slots available yet</p>
                <p className="text-ink/50 text-sm">
                  Interview slots will appear here once the admissions team publishes them. Check back soon.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
