"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MessageSquare, Send, List, Clock, CheckCircle, XCircle, ChevronRight } from 'lucide-react';

type Tab = 'broadcast' | 'templates' | 'log' | 'send-one';

const CATEGORY_COLORS: Record<string, string> = {
  AUTHENTICATION: 'text-forest border-forest',
  UTILITY: 'text-ink/60 border-ink/20',
  MARKETING: 'text-terracotta border-terracotta',
};

export default function AdminWhatsappPage() {
  const router = useRouter();
  const { role, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>('broadcast');

  // Broadcast state
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [batchIdFilter, setBatchIdFilter] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<{ attempted: number; succeeded: number; failed: number } | null>(null);

  // Templates state
  const [templates, setTemplates] = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Send log state
  const [sendLog, setSendLog] = useState<any[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  // Send-one state
  const [sendOnePhone, setSendOnePhone] = useState('');
  const [sendOneTemplate, setSendOneTemplate] = useState('');
  const [sendOneParams, setSendOneParams] = useState('');
  const [sendingOne, setSendingOne] = useState(false);
  const [sendOneResult, setSendOneResult] = useState<boolean | null>(null);

  useEffect(() => {
    if (tab === 'templates' && templates.length === 0) loadTemplates();
    if (tab === 'log') loadLog();
  }, [tab]);

  async function loadTemplates() {
    setTemplatesLoading(true);
    try {
      setTemplates(await api.getWhatsappTemplates());
    } catch (err: any) {
      alert(err.message);
    } finally {
      setTemplatesLoading(false);
    }
  }

  async function loadLog() {
    setLogLoading(true);
    try {
      setSendLog(await api.getWhatsappSendLog(50, 0));
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLogLoading(false);
    }
  }

  async function handleBroadcast() {
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) {
      alert('Title and message are required');
      return;
    }
    if (!confirm(`Send WhatsApp broadcast to all opted-in applicants${batchIdFilter ? ` in batch ${batchIdFilter}` : ''}?`)) return;
    setBroadcasting(true);
    setBroadcastResult(null);
    try {
      const result = await api.whatsappBroadcast({
        title: broadcastTitle,
        message: broadcastMessage,
        batchId: batchIdFilter || undefined,
      });
      setBroadcastResult(result);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBroadcasting(false);
    }
  }

  async function handleSendOne() {
    if (!sendOnePhone.trim() || !sendOneTemplate.trim()) {
      alert('Phone and template name are required');
      return;
    }
    setSendingOne(true);
    setSendOneResult(null);
    try {
      const params = sendOneParams
        .split('\n')
        .map(p => p.trim())
        .filter(Boolean);
      const res = await api.whatsappSendOne({ phone: sendOnePhone, templateName: sendOneTemplate, parameters: params });
      setSendOneResult(res.sent);
    } catch (err: any) {
      alert(err.message);
      setSendOneResult(false);
    } finally {
      setSendingOne(false);
    }
  }

  const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'broadcast', label: 'Broadcast', icon: <Send className="w-3.5 h-3.5" /> },
    { id: 'send-one', label: 'Send One', icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { id: 'templates', label: 'Templates', icon: <List className="w-3.5 h-3.5" /> },
    { id: 'log', label: 'Send Log', icon: <Clock className="w-3.5 h-3.5" /> },
  ];

  if (authLoading) return null;
  if (!role || !['ADMIN', 'SUPER_ADMIN', 'MODERATOR'].includes(role)) {
    router.replace('/login');
    return null;
  }

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-5xl mx-auto min-h-screen">
      <div className="space-y-8">
        <div>
          <h1 className="text-4xl font-serif font-black">WhatsApp</h1>
          <p className="text-ink/50 text-sm uppercase tracking-widest mt-1">Meta Business API — WABA</p>
        </div>

        {/* Tab strip */}
        <div className="flex border-b border-ink/10">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                'flex items-center gap-2 px-5 py-3 text-[11px] uppercase tracking-widest font-bold border-b-2 transition-colors',
                tab === t.id ? 'border-forest text-forest' : 'border-transparent text-ink/40 hover:text-ink',
              )}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ── Broadcast tab ── */}
        {tab === 'broadcast' && (
          <div className="space-y-6">
            <p className="text-xs text-ink/50 uppercase tracking-widest">
              Sends the <code className="lowercase bg-ink/5 px-1">platform_announcement</code> (MARKETING) template to all opted-in applicants.
              Only applicants with <strong>whatsappVerified = true</strong> receive the message.
            </p>

            <div className="space-y-4 border border-ink/10 p-6">
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/60 mb-2">{'Title (template {{1}})'}</label>
                <input
                  type="text"
                  value={broadcastTitle}
                  onChange={e => setBroadcastTitle(e.target.value)}
                  placeholder="e.g. Batch 3 Applications Now Open"
                  className="w-full border-b border-ink/20 bg-transparent py-2 text-sm outline-none placeholder:text-ink/30"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/60 mb-2">{'Message (template {{2}})'}</label>
                <textarea
                  rows={5}
                  value={broadcastMessage}
                  onChange={e => setBroadcastMessage(e.target.value)}
                  placeholder="Write your announcement here. Plain text only — WhatsApp does not support HTML."
                  className="w-full border-b border-ink/20 bg-transparent py-2 text-sm outline-none resize-none placeholder:text-ink/30"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/60 mb-2">Filter — Batch ID (optional)</label>
                <input
                  type="text"
                  value={batchIdFilter}
                  onChange={e => setBatchIdFilter(e.target.value)}
                  placeholder="Leave blank to send to all batches"
                  className="w-full border-b border-ink/20 bg-transparent py-2 text-sm outline-none placeholder:text-ink/30"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-ink/40 uppercase tracking-widest">100ms gap between sends to respect Meta rate limits</span>
                <button
                  onClick={handleBroadcast}
                  disabled={broadcasting}
                  className="flex items-center gap-2 bg-forest text-parchment px-6 py-2 text-[11px] uppercase tracking-widest font-bold disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {broadcasting ? 'Sending…' : 'Send Broadcast'}
                </button>
              </div>
            </div>

            {broadcastResult && (
              <div className="border border-ink/10 p-6 space-y-2">
                <p className="text-xs uppercase tracking-widest font-bold text-ink/60">Broadcast Result</p>
                <div className="flex gap-8 mt-3">
                  <div>
                    <p className="text-3xl font-serif font-black">{broadcastResult.attempted}</p>
                    <p className="text-[11px] uppercase tracking-widest text-ink/40">Attempted</p>
                  </div>
                  <div>
                    <p className="text-3xl font-serif font-black text-forest">{broadcastResult.succeeded}</p>
                    <p className="text-[11px] uppercase tracking-widest text-ink/40">Succeeded</p>
                  </div>
                  <div>
                    <p className="text-3xl font-serif font-black text-terracotta">{broadcastResult.failed}</p>
                    <p className="text-[11px] uppercase tracking-widest text-ink/40">Failed</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Send One tab ── */}
        {tab === 'send-one' && (
          <div className="space-y-6">
            <p className="text-xs text-ink/50 uppercase tracking-widest">
              Send any approved template to a single phone number. Useful for testing or one-off communications.
            </p>

            <div className="border border-ink/10 p-6 space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/60 mb-2">Phone (with country code)</label>
                <input
                  type="text"
                  value={sendOnePhone}
                  onChange={e => setSendOnePhone(e.target.value)}
                  placeholder="919876543210"
                  className="w-full border-b border-ink/20 bg-transparent py-2 text-sm outline-none placeholder:text-ink/30"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/60 mb-2">Template Name</label>
                <input
                  type="text"
                  value={sendOneTemplate}
                  onChange={e => setSendOneTemplate(e.target.value)}
                  placeholder="platform_announcement"
                  className="w-full border-b border-ink/20 bg-transparent py-2 text-sm outline-none placeholder:text-ink/30"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-bold text-ink/60 mb-2">
                  {'Parameters — one per line ({{1}}, {{2}}, …)'}
                </label>
                <textarea
                  rows={4}
                  value={sendOneParams}
                  onChange={e => setSendOneParams(e.target.value)}
                  placeholder={"First param value\nSecond param value"}
                  className="w-full border-b border-ink/20 bg-transparent py-2 text-sm outline-none resize-none placeholder:text-ink/30"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                {sendOneResult !== null && (
                  <span className={clsx('flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-bold', sendOneResult ? 'text-forest' : 'text-terracotta')}>
                    {sendOneResult
                      ? <><CheckCircle className="w-3.5 h-3.5" /> Sent</>
                      : <><XCircle className="w-3.5 h-3.5" /> Failed</>
                    }
                  </span>
                )}
                <button
                  onClick={handleSendOne}
                  disabled={sendingOne}
                  className="ml-auto flex items-center gap-2 bg-forest text-parchment px-6 py-2 text-[11px] uppercase tracking-widest font-bold disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {sendingOne ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Templates tab ── */}
        {tab === 'templates' && (
          <div className="space-y-4">
            <p className="text-xs text-ink/50 uppercase tracking-widest">
              These templates must be created and approved in{' '}
              <strong>Meta Business Manager → WhatsApp → Message Templates</strong> before they will send in production.
            </p>

            {templatesLoading ? (
              <p className="text-ink/40 text-sm py-8 text-center uppercase tracking-widest">Loading…</p>
            ) : (
              <div className="divide-y divide-ink/10 border border-ink/10">
                {templates.map(t => (
                  <div key={t.name} className="p-4 flex items-start gap-4">
                    <span className={clsx('text-[10px] uppercase tracking-widest font-bold border px-2 py-0.5 shrink-0', CATEGORY_COLORS[t.category] ?? 'border-ink/20 text-ink/50')}>
                      {t.category}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm font-bold text-ink">{t.name}</p>
                      <p className="text-xs text-ink/50 mt-0.5">{t.description}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {t.parameters.map((p: string, i: number) => (
                          <span key={i} className="text-[10px] bg-ink/5 px-2 py-0.5 text-ink/60">{p}</span>
                        ))}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-ink/20 shrink-0 mt-1" />
                  </div>
                ))}
              </div>
            )}

            <div className="border border-ink/10 p-5 space-y-2">
              <p className="text-[11px] uppercase tracking-widest font-bold text-ink/60">Setup Checklist</p>
              {[
                'Go to business.facebook.com → Business Settings → WhatsApp Accounts',
                'Under each template, click Create → choose category → paste the body text with {{1}}, {{2}} placeholders',
                'For MARKETING templates, add a footer "Reply STOP to unsubscribe"',
                'Submit for review — approval takes 1–48 hours',
                'Once approved, template status shows APPROVED in Meta dashboard',
                'Set WHATSAPP_API_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN in your backend .env',
                'Point the webhook to https://yourdomain.com/api/whatsapp/webhook in Meta App Dashboard → Webhooks',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-3 text-sm text-ink/70">
                  <span className="text-[11px] font-bold text-ink/30 w-5 shrink-0 pt-0.5">{i + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Send Log tab ── */}
        {tab === 'log' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-xs text-ink/50 uppercase tracking-widest">Last 50 sends</p>
              <button onClick={loadLog} className="text-[11px] uppercase tracking-widest font-bold text-forest hover:underline">Refresh</button>
            </div>

            {logLoading ? (
              <p className="text-ink/40 text-sm py-8 text-center uppercase tracking-widest">Loading…</p>
            ) : sendLog.length === 0 ? (
              <p className="text-ink/30 text-sm py-8 text-center">No sends yet</p>
            ) : (
              <div className="divide-y divide-ink/10 border border-ink/10">
                {sendLog.map((entry: any) => (
                  <div key={entry.id} className="p-4 flex items-start gap-4">
                    {entry.status === 'SENT'
                      ? <CheckCircle className="w-4 h-4 text-forest mt-0.5 shrink-0" />
                      : <XCircle className="w-4 h-4 text-terracotta mt-0.5 shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-ink">{entry.subject}</p>
                      <p className="text-xs text-ink/50 mt-0.5">{entry.body}</p>
                      {entry.applicant && (
                        <p className="text-[11px] text-ink/40 mt-1 uppercase tracking-widest">
                          {entry.applicant.firstName} {entry.applicant.lastName} · {entry.applicant.email}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] text-ink/30 uppercase tracking-widest shrink-0">
                      {entry.sentAt ? new Date(entry.sentAt).toLocaleDateString() : 'Pending'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
