'use client';

import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { MessageCircle, Send, CheckCircle2, XCircle } from 'lucide-react';

interface TemplateParam {
  index: number;
  label: string;
}

interface WhatsappTemplate {
  name: string;
  category: string;
  description: string;
  params: TemplateParam[];
}

interface SendResult {
  success: boolean;
  to: string;
  template: string;
}

const CATEGORY_STYLES: Record<string, string> = {
  AUTHENTICATION: 'text-info bg-info/10 border-info/25',
  UTILITY: 'text-forest bg-forest/10 border-forest/20',
  MARKETING: 'text-terracotta-warm bg-terracotta-warm/10 border-terracotta-warm/25',
};

export default function WhatsappConsolePage() {
  const [templates, setTemplates] = useState<WhatsappTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedName, setSelectedName] = useState('');
  const [to, setTo] = useState('');
  const [languageCode, setLanguageCode] = useState('en_US');
  // Parameter values keyed by the template param index (1-based, per the registry).
  const [paramValues, setParamValues] = useState<Record<number, string>>({});

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getWhatsappTemplates()
      .then((res) => setTemplates(res.templates || []))
      .catch((err: any) => setLoadError(err.message || 'Failed to load templates'))
      .finally(() => setLoading(false));
  }, []);

  const selected = useMemo(
    () => templates.find((t) => t.name === selectedName) || null,
    [templates, selectedName],
  );

  // Group templates by category for the picker, preserving registry order.
  const grouped = useMemo(() => {
    const map = new Map<string, WhatsappTemplate[]>();
    for (const t of templates) {
      const list = map.get(t.category) || [];
      list.push(t);
      map.set(t.category, list);
    }
    return Array.from(map.entries());
  }, [templates]);

  const handleSelect = (name: string) => {
    setSelectedName(name);
    setParamValues({});
    setResult(null);
    setSendError(null);
  };

  const updateParam = (index: number, value: string) => {
    setParamValues((prev) => ({ ...prev, [index]: value }));
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSending(true);
    setResult(null);
    setSendError(null);

    try {
      // Build the Meta body component: parameters ordered by ascending index,
      // matching the shape the backend forwards to the WhatsApp Graph API.
      const orderedParams = [...selected.params].sort((a, b) => a.index - b.index);
      const components =
        orderedParams.length > 0
          ? [
              {
                type: 'body',
                parameters: orderedParams.map((p) => ({
                  type: 'text',
                  text: paramValues[p.index] ?? '',
                })),
              },
            ]
          : undefined;

      const res = await api.sendWhatsappMessage({
        to: to.trim(),
        templateName: selected.name,
        components,
        languageCode: languageCode.trim() || undefined,
      });
      setResult(res);
    } catch (err: any) {
      setSendError(err.message || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-ink">
        <div className="w-12 h-12 bg-forest/10 flex items-center justify-center border border-forest/20 mb-6 animate-pulse">
          <span className="font-serif text-xl font-bold text-forest">...</span>
        </div>
        <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Template Registry...</p>
      </div>
    );
  }

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none flex items-center gap-4">
            <MessageCircle className="w-10 h-10" />
            WhatsApp Console
          </h1>
        </div>
        <div className="text-left md:text-right">
          <p className="text-3xl font-serif text-terracotta-warm mb-1">{templates.length}</p>
          <p className="text-sm text-ink/40 uppercase tracking-widest">Approved Templates</p>
        </div>
      </header>

      {loadError ? (
        <div className="border border-terracotta/30 bg-terracotta/5 p-8 text-center">
          <p className="text-sm uppercase tracking-widest font-semibold text-terracotta">{loadError}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* ─── Template Picker ─────────────────────────────── */}
          <aside className="lg:col-span-5 border border-hairline bg-white p-6 self-start">
            <h2 className="font-serif text-2xl font-bold mb-1">Template Registry</h2>
            <p className="text-xs uppercase tracking-widest text-ink/50 mb-6">
              Select a Meta-approved template to dispatch
            </p>
            <div className="space-y-6 max-h-[640px] overflow-y-auto pr-1">
              {grouped.map(([category, list]) => (
                <div key={category}>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-ink/40 mb-3 pb-2 border-b border-hairline">
                    {category}
                  </p>
                  <div className="space-y-2">
                    {list.map((t) => (
                      <button
                        key={t.name}
                        onClick={() => handleSelect(t.name)}
                        className={`w-full text-left p-4 border transition-colors ${
                          selectedName === t.name
                            ? 'border-saffron bg-saffron/5'
                            : 'border-hairline hover:border-forest/30 hover:bg-parchment/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span className="font-mono text-sm font-bold">{t.name}</span>
                          <span className="text-[9px] uppercase tracking-widest font-bold text-ink/40 flex-shrink-0">
                            {t.params.length} {t.params.length === 1 ? 'param' : 'params'}
                          </span>
                        </div>
                        <span className="text-xs text-ink/60 leading-relaxed">{t.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* ─── Compose & Send ──────────────────────────────── */}
          <section className="lg:col-span-7 border border-hairline bg-white p-8 self-start">
            {!selected ? (
              <div className="flex flex-col items-center justify-center py-24 border border-dashed border-ink/20 bg-parchment/50 text-center">
                <MessageCircle className="w-10 h-10 text-ink/30 mb-4" />
                <p className="text-ink/60 uppercase tracking-widest text-xs font-semibold">
                  Select a template to compose a message
                </p>
              </div>
            ) : (
              <form onSubmit={handleSend} className="flex flex-col gap-6">
                <div className="flex items-center justify-between gap-4 pb-4 border-b border-hairline">
                  <div>
                    <h2 className="font-serif text-2xl font-bold">{selected.name}</h2>
                    <p className="text-xs text-ink/60 mt-1">{selected.description}</p>
                  </div>
                  <span
                    className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 border flex-shrink-0 ${
                      CATEGORY_STYLES[selected.category] || 'text-ink/50 bg-ink/5 border-ink/15'
                    }`}
                  >
                    {selected.category}
                  </span>
                </div>

                {/* Recipient */}
                <div>
                  <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">
                    Recipient Phone *
                  </label>
                  <input
                    type="tel"
                    required
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                  />
                  <p className="text-[10px] uppercase tracking-widest text-ink/40 mt-2">
                    Include country code. Non-digit characters are stripped server-side.
                  </p>
                </div>

                {/* Template parameters */}
                {selected.params.length > 0 ? (
                  <div className="space-y-4">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-forest">
                      Template Parameters
                    </p>
                    {[...selected.params]
                      .sort((a, b) => a.index - b.index)
                      .map((p) => (
                        <div key={p.index}>
                          <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">
                            {'{{'}{p.index}{'}}'} — {p.label}
                          </label>
                          <input
                            type="text"
                            value={paramValues[p.index] ?? ''}
                            onChange={(e) => updateParam(p.index, e.target.value)}
                            placeholder={p.label}
                            className="w-full bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                          />
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-xs text-ink/40 italic border border-dashed border-ink/15 bg-parchment/40 p-4">
                    This template has no body parameters — it will be sent as-is.
                  </p>
                )}

                {/* Language code */}
                <div>
                  <label className="block text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">
                    Language Code
                  </label>
                  <input
                    type="text"
                    value={languageCode}
                    onChange={(e) => setLanguageCode(e.target.value)}
                    placeholder="en_US"
                    className="w-full md:w-48 bg-parchment/50 border-b border-ink/20 px-4 py-3 font-sans focus:outline-none focus:border-forest transition-colors"
                  />
                </div>

                {/* Send result */}
                {result && (
                  <div
                    className={`flex items-start gap-3 p-4 border ${
                      result.success
                        ? 'border-success/30 bg-success/5 text-success'
                        : 'border-terracotta/30 bg-terracotta/5 text-terracotta'
                    }`}
                  >
                    {result.success ? (
                      <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="text-sm">
                      <p className="font-semibold uppercase tracking-widest text-xs">
                        {result.success ? 'Message Dispatched' : 'Send Reported Failure'}
                      </p>
                      <p className="text-ink/60 mt-1">
                        Template <span className="font-mono">{result.template}</span> → {result.to}
                      </p>
                      {!result.success && (
                        <p className="text-ink/50 mt-1 text-xs">
                          The recipient may have opted out (STOP), or the WhatsApp provider rejected the send.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {sendError && (
                  <div className="flex items-start gap-3 p-4 border border-terracotta/30 bg-terracotta/5 text-terracotta">
                    <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <p className="text-sm">{sendError}</p>
                  </div>
                )}

                <div className="flex justify-end pt-4 border-t border-hairline">
                  <button
                    type="submit"
                    disabled={sending}
                    className="flex items-center gap-2 bg-saffron hover:bg-saffron-deep text-parchment px-8 py-3 text-xs uppercase tracking-widest font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="w-4 h-4" />
                    {sending ? 'Dispatching...' : 'Send Message'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
