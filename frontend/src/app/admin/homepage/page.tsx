'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  DEFAULT_SECTIONS,
  SECTION_TYPE_LABELS,
  SECTION_TYPE_DESCRIPTIONS,
  createDefaultData,
  generateSectionId,
  type Section,
  type SectionType,
} from '@/lib/homepage-sections';

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

const ALL_TYPES = Object.keys(SECTION_TYPE_LABELS) as SectionType[];

function Label({ children }: { children: ReactNode }) {
  return (
    <label className="block font-sans text-[10px] uppercase tracking-widest text-forest font-semibold mb-1">
      {children}
    </label>
  );
}

function Field({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1 mb-5">{children}</div>;
}

const inputCls =
  'border border-hairline px-3 py-2 text-sm bg-white focus:outline-none focus:border-forest w-full font-sans text-ink';
const textareaCls =
  'border border-hairline px-3 py-2 text-sm bg-white focus:outline-none focus:border-forest w-full font-sans text-ink resize-y min-h-[80px]';

// ─── Media upload helper ───────────────────────────────────────────────────────

async function uploadMedia(file: File): Promise<string> {
  const { uploadUrl, publicUrl } = await api.getAdminMediaUploadUrl(file.name, file.type);
  await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  return publicUrl;
}

// ─── Section-specific editors ─────────────────────────────────────────────────

function MediaField({ value, onChange, label = 'Media URL' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErr('');
    try {
      const url = await uploadMedia(file);
      onChange(url);
    } catch {
      setErr('Upload failed. You can paste a URL instead.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Field>
      <Label>{label}</Label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://... or leave blank" className={inputCls} />
      <div className="flex items-center gap-3 mt-1">
        <label className="cursor-pointer text-[10px] uppercase tracking-widest text-forest font-semibold border border-forest px-3 py-1 hover:bg-forest/5 transition-colors">
          {uploading ? 'Uploading…' : 'Upload File'}
          <input type="file" accept="image/*,video/*" className="hidden" onChange={handleFile} disabled={uploading} />
        </label>
        <span className="text-[10px] text-ink/40">Supports JPG, PNG, WebP, MP4, WebM</span>
      </div>
      {err && <span className="text-[10px] text-terracotta">{err}</span>}
    </Field>
  );
}

// ── Hero Editor ──────────────────────────────────────────────────────────────
function HeroEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const u = (k: string, v: string) => onChange({ ...data, [k]: v });
  return (
    <div>
      <div className="grid grid-cols-2 gap-4">
        <Field><Label>Headline Prefix</Label><input className={inputCls} value={data.headline_prefix || ''} onChange={(e) => u('headline_prefix', e.target.value)} placeholder="Build a Startup in" /></Field>
        <Field><Label>Headline Accent (shown in saffron italic)</Label><input className={inputCls} value={data.headline_accent || ''} onChange={(e) => u('headline_accent', e.target.value)} placeholder="180 Days." /></Field>
      </div>
      <Field><Label>Tagline (italic serif, shown below headline)</Label><input className={inputCls} value={data.tagline || ''} onChange={(e) => u('tagline', e.target.value)} /></Field>
      <Field><Label>Body</Label><textarea className={textareaCls} value={data.body || ''} onChange={(e) => u('body', e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field><Label>Primary CTA Label</Label><input className={inputCls} value={data.cta_primary_label || ''} onChange={(e) => u('cta_primary_label', e.target.value)} /></Field>
        <Field><Label>Secondary CTA Label</Label><input className={inputCls} value={data.cta_secondary_label || ''} onChange={(e) => u('cta_secondary_label', e.target.value)} /></Field>
      </div>
      <Field><Label>Secondary CTA Anchor (element id to scroll to)</Label><input className={inputCls} value={data.cta_secondary_anchor || ''} onChange={(e) => u('cta_secondary_anchor', e.target.value)} /></Field>
    </div>
  );
}

// ── How It Works Editor ──────────────────────────────────────────────────────
function HowItWorksEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const steps: any[] = data.steps || [];
  const updateStep = (id: string, key: string, val: string) =>
    onChange({ ...data, steps: steps.map((s) => (s.id === id ? { ...s, [key]: val } : s)) });
  const addStep = () => {
    const num = String(steps.length + 1).padStart(2, '0');
    onChange({ ...data, steps: [...steps, { id: generateSectionId(), step: num, title: 'New Step', desc: '', longDesc: '', mediaUrl: '', mediaType: 'image' }] });
  };
  const removeStep = (id: string) => onChange({ ...data, steps: steps.filter((s) => s.id !== id) });
  const moveStep = (id: string, dir: 'up' | 'down') => {
    const idx = steps.findIndex((s) => s.id === id);
    if (dir === 'up' && idx === 0) return;
    if (dir === 'down' && idx === steps.length - 1) return;
    const newSteps = [...steps];
    const target = dir === 'up' ? idx - 1 : idx + 1;
    [newSteps[idx], newSteps[target]] = [newSteps[target], newSteps[idx]];
    onChange({ ...data, steps: newSteps });
  };

  return (
    <div>
      <Field><Label>Section Title</Label><input className={inputCls} value={data.title || ''} onChange={(e) => onChange({ ...data, title: e.target.value })} /></Field>
      <div className="space-y-6 mt-4">
        {steps.map((step, idx) => (
          <div key={step.id} className="border border-hairline p-5 bg-alabaster relative">
            <div className="absolute top-3 right-3 flex gap-1">
              <button onClick={() => moveStep(step.id, 'up')} disabled={idx === 0} className="w-6 h-6 border border-hairline bg-white text-xs flex items-center justify-center disabled:opacity-30 hover:bg-forest/5">↑</button>
              <button onClick={() => moveStep(step.id, 'down')} disabled={idx === steps.length - 1} className="w-6 h-6 border border-hairline bg-white text-xs flex items-center justify-center disabled:opacity-30 hover:bg-forest/5">↓</button>
              <button onClick={() => removeStep(step.id)} className="w-6 h-6 border border-terracotta/30 bg-white text-terracotta text-xs flex items-center justify-center hover:bg-terracotta/5">×</button>
            </div>
            <p className="font-sans text-[10px] uppercase tracking-widest text-forest font-bold mb-4">Step {idx + 1}</p>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Field><Label>Number Badge</Label><input className={inputCls} value={step.step} onChange={(e) => updateStep(step.id, 'step', e.target.value)} /></Field>
              <div className="col-span-2"><Field><Label>Title</Label><input className={inputCls} value={step.title} onChange={(e) => updateStep(step.id, 'title', e.target.value)} /></Field></div>
            </div>
            <Field><Label>Short Description (timeline label)</Label><input className={inputCls} value={step.desc} onChange={(e) => updateStep(step.id, 'desc', e.target.value)} /></Field>
            <Field><Label>Long Description (shown on card)</Label><textarea className={textareaCls} value={step.longDesc} onChange={(e) => updateStep(step.id, 'longDesc', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <MediaField label="Card Image/Video URL" value={step.mediaUrl || ''} onChange={(v) => updateStep(step.id, 'mediaUrl', v)} />
              <Field>
                <Label>Media Type</Label>
                <select className={inputCls} value={step.mediaType || 'image'} onChange={(e) => updateStep(step.id, 'mediaType', e.target.value)}>
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                </select>
              </Field>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addStep} className="mt-4 w-full py-3 border-2 border-dashed border-forest/20 text-sm font-semibold text-forest hover:border-forest/40 hover:bg-forest/5 transition-all">
        + Add Step
      </button>
    </div>
  );
}

// ── Promise Editor ───────────────────────────────────────────────────────────
function PromiseEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const items: any[] = data.items || [];
  const addItem = () => onChange({ ...data, items: [...items, { id: generateSectionId(), title: 'New Promise', text: '' }] });
  const removeItem = (id: string) => onChange({ ...data, items: items.filter((i) => i.id !== id) });
  const updateItem = (id: string, key: string, val: string) =>
    onChange({ ...data, items: items.map((i) => (i.id === id ? { ...i, [key]: val } : i)) });

  return (
    <div>
      <div className="grid grid-cols-2 gap-4">
        <Field><Label>Heading</Label><input className={inputCls} value={data.heading || ''} onChange={(e) => onChange({ ...data, heading: e.target.value })} /></Field>
        <Field><Label>Subheading</Label><input className={inputCls} value={data.subheading || ''} onChange={(e) => onChange({ ...data, subheading: e.target.value })} /></Field>
      </div>
      <div className="space-y-4 mt-2">
        {items.map((item, idx) => (
          <div key={item.id} className="border border-hairline p-4 bg-alabaster relative">
            <button onClick={() => removeItem(item.id)} className="absolute top-3 right-3 w-6 h-6 border border-terracotta/30 bg-white text-terracotta text-xs flex items-center justify-center hover:bg-terracotta/5">×</button>
            <p className="font-sans text-[10px] uppercase tracking-widest text-forest font-bold mb-3">Item {idx + 1}</p>
            <Field><Label>Title</Label><input className={inputCls} value={item.title} onChange={(e) => updateItem(item.id, 'title', e.target.value)} /></Field>
            <Field><Label>Text</Label><textarea className={textareaCls} value={item.text} onChange={(e) => updateItem(item.id, 'text', e.target.value)} /></Field>
          </div>
        ))}
      </div>
      <button onClick={addItem} className="mt-4 w-full py-3 border-2 border-dashed border-forest/20 text-sm font-semibold text-forest hover:border-forest/40 hover:bg-forest/5 transition-all">
        + Add Item
      </button>
    </div>
  );
}

// ── Quote Editor ─────────────────────────────────────────────────────────────
function QuoteEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  return (
    <div>
      <Field><Label>Quote (without quotes)</Label><textarea className={textareaCls} value={data.quote || ''} onChange={(e) => onChange({ ...data, quote: e.target.value })} /></Field>
      <Field><Label>Attribution (optional)</Label><input className={inputCls} value={data.attribution || ''} onChange={(e) => onChange({ ...data, attribution: e.target.value })} /></Field>
    </div>
  );
}

// ── Builder Model Editor ─────────────────────────────────────────────────────
function BuilderModelEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const items: any[] = data.items || [];
  const addItem = () => onChange({ ...data, items: [...items, { id: generateSectionId(), stat: 'N', label: 'Label', description: '' }] });
  const removeItem = (id: string) => onChange({ ...data, items: items.filter((i) => i.id !== id) });
  const updateItem = (id: string, key: string, val: string) =>
    onChange({ ...data, items: items.map((i) => (i.id === id ? { ...i, [key]: val } : i)) });

  return (
    <div>
      <div className="grid grid-cols-2 gap-4">
        <Field><Label>Headline</Label><input className={inputCls} value={data.headline || ''} onChange={(e) => onChange({ ...data, headline: e.target.value })} /></Field>
        <Field><Label>Subheadline</Label><input className={inputCls} value={data.subheadline || ''} onChange={(e) => onChange({ ...data, subheadline: e.target.value })} /></Field>
      </div>
      <div className="space-y-3 mt-2">
        {items.map((item, idx) => (
          <div key={item.id} className="border border-hairline p-4 bg-alabaster relative">
            <button onClick={() => removeItem(item.id)} className="absolute top-3 right-3 w-6 h-6 border border-terracotta/30 bg-white text-terracotta text-xs flex items-center justify-center hover:bg-terracotta/5">×</button>
            <p className="font-sans text-[10px] uppercase tracking-widest text-forest font-bold mb-3">Item {idx + 1}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field><Label>Stat / Number</Label><input className={inputCls} value={item.stat} onChange={(e) => updateItem(item.id, 'stat', e.target.value)} /></Field>
              <Field><Label>Label</Label><input className={inputCls} value={item.label} onChange={(e) => updateItem(item.id, 'label', e.target.value)} /></Field>
            </div>
            <Field><Label>Description</Label><textarea className={textareaCls} style={{ minHeight: 60 }} value={item.description} onChange={(e) => updateItem(item.id, 'description', e.target.value)} /></Field>
          </div>
        ))}
      </div>
      <button onClick={addItem} className="mt-4 w-full py-3 border-2 border-dashed border-forest/20 text-sm font-semibold text-forest hover:border-forest/40 hover:bg-forest/5 transition-all">+ Add Item</button>
      <Field><Label>Closing Quote (optional)</Label><input className={inputCls} value={data.closing_quote || ''} onChange={(e) => onChange({ ...data, closing_quote: e.target.value })} /></Field>
    </div>
  );
}

// ── Stats Bar Editor ─────────────────────────────────────────────────────────
function StatsBarEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const items: any[] = data.items || [];
  const addItem = () => onChange({ ...data, items: [...items, { id: generateSectionId(), value: '0', label: 'Stat Label' }] });
  const removeItem = (id: string) => onChange({ ...data, items: items.filter((i) => i.id !== id) });
  const updateItem = (id: string, key: string, val: string) =>
    onChange({ ...data, items: items.map((i) => (i.id === id ? { ...i, [key]: val } : i)) });

  return (
    <div>
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={item.id} className="flex items-center gap-3 border border-hairline p-3 bg-alabaster">
            <span className="font-sans text-[10px] text-ink/40 w-5 shrink-0">{idx + 1}</span>
            <input className={`${inputCls} w-28`} placeholder="Value" value={item.value} onChange={(e) => updateItem(item.id, 'value', e.target.value)} />
            <input className={`${inputCls} flex-1`} placeholder="Label" value={item.label} onChange={(e) => updateItem(item.id, 'label', e.target.value)} />
            <button onClick={() => removeItem(item.id)} className="w-6 h-6 border border-terracotta/30 bg-white text-terracotta text-xs flex items-center justify-center hover:bg-terracotta/5 shrink-0">×</button>
          </div>
        ))}
      </div>
      <button onClick={addItem} className="mt-4 w-full py-3 border-2 border-dashed border-forest/20 text-sm font-semibold text-forest hover:border-forest/40 hover:bg-forest/5 transition-all">+ Add Stat</button>
    </div>
  );
}

// ── Philosophy Editor ────────────────────────────────────────────────────────
function PhilosophyEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  return (
    <div>
      <Field><Label>Verse / Sanskrit text</Label><textarea className={textareaCls} value={data.verse || ''} onChange={(e) => onChange({ ...data, verse: e.target.value })} /></Field>
      <MediaField label="Image URL" value={data.imageUrl || ''} onChange={(v) => onChange({ ...data, imageUrl: v })} />
      <Field><Label>Heading</Label><input className={inputCls} value={data.heading || ''} onChange={(e) => onChange({ ...data, heading: e.target.value })} /></Field>
      <Field><Label>Body</Label><textarea className={textareaCls} value={data.body || ''} onChange={(e) => onChange({ ...data, body: e.target.value })} /></Field>
      <Field><Label>Closing Line (optional)</Label><input className={inputCls} value={data.closing || ''} onChange={(e) => onChange({ ...data, closing: e.target.value })} /></Field>
    </div>
  );
}

// ── CTA Editor ───────────────────────────────────────────────────────────────
function CtaEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  return (
    <div>
      <Field><Label>Headline</Label><textarea className={textareaCls} value={data.headline || ''} onChange={(e) => onChange({ ...data, headline: e.target.value })} /></Field>
      <Field><Label>Button Label</Label><input className={inputCls} value={data.cta_label || ''} onChange={(e) => onChange({ ...data, cta_label: e.target.value })} /></Field>
    </div>
  );
}

// ── Card Carousel Editor ─────────────────────────────────────────────────────
function CardCarouselEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const cards: any[] = data.cards || [];
  const addCard = () => onChange({ ...data, cards: [...cards, { id: generateSectionId(), title: 'New Card', description: '', mediaUrl: '', mediaType: 'image', tag: '' }] });
  const removeCard = (id: string) => onChange({ ...data, cards: cards.filter((c) => c.id !== id) });
  const updateCard = (id: string, key: string, val: string) =>
    onChange({ ...data, cards: cards.map((c) => (c.id === id ? { ...c, [key]: val } : c)) });

  return (
    <div>
      <Field><Label>Section Title</Label><input className={inputCls} value={data.title || ''} onChange={(e) => onChange({ ...data, title: e.target.value })} /></Field>
      <div className="space-y-4 mt-2">
        {cards.map((card, idx) => (
          <div key={card.id} className="border border-hairline p-4 bg-alabaster relative">
            <button onClick={() => removeCard(card.id)} className="absolute top-3 right-3 w-6 h-6 border border-terracotta/30 bg-white text-terracotta text-xs flex items-center justify-center hover:bg-terracotta/5">×</button>
            <p className="font-sans text-[10px] uppercase tracking-widest text-forest font-bold mb-3">Card {idx + 1}</p>
            <Field><Label>Title</Label><input className={inputCls} value={card.title} onChange={(e) => updateCard(card.id, 'title', e.target.value)} /></Field>
            <Field><Label>Description</Label><textarea className={textareaCls} value={card.description} onChange={(e) => updateCard(card.id, 'description', e.target.value)} /></Field>
            <Field><Label>Tag (optional badge)</Label><input className={inputCls} value={card.tag || ''} onChange={(e) => updateCard(card.id, 'tag', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <MediaField label="Media URL" value={card.mediaUrl || ''} onChange={(v) => updateCard(card.id, 'mediaUrl', v)} />
              <Field>
                <Label>Media Type</Label>
                <select className={inputCls} value={card.mediaType || 'image'} onChange={(e) => updateCard(card.id, 'mediaType', e.target.value)}>
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                </select>
              </Field>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addCard} className="mt-4 w-full py-3 border-2 border-dashed border-forest/20 text-sm font-semibold text-forest hover:border-forest/40 hover:bg-forest/5 transition-all">+ Add Card</button>
    </div>
  );
}

// ── Rich Text Editor ─────────────────────────────────────────────────────────
function RichTextEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  return (
    <div>
      <Field>
        <Label>Content</Label>
        <textarea className={textareaCls} style={{ minHeight: 120 }} value={data.content || ''} onChange={(e) => onChange({ ...data, content: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <Label>Alignment</Label>
          <select className={inputCls} value={data.alignment || 'center'} onChange={(e) => onChange({ ...data, alignment: e.target.value })}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </Field>
        <Field>
          <Label>Background</Label>
          <select className={inputCls} value={data.background || 'parchment'} onChange={(e) => onChange({ ...data, background: e.target.value })}>
            <option value="parchment">Parchment (light)</option>
            <option value="alabaster">Alabaster (off-white)</option>
            <option value="forest">Forest (dark green)</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

// ── Steps Editor ─────────────────────────────────────────────────────────────
function StepsEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const steps: any[] = data.steps || [];
  const addStep = () => {
    const num = String(steps.length + 1).padStart(2, '0');
    onChange({ ...data, steps: [...steps, { id: generateSectionId(), number: num, title: 'New Step', description: '' }] });
  };
  const removeStep = (id: string) => onChange({ ...data, steps: steps.filter((s) => s.id !== id) });
  const updateStep = (id: string, key: string, val: string) =>
    onChange({ ...data, steps: steps.map((s) => (s.id === id ? { ...s, [key]: val } : s)) });

  return (
    <div>
      <Field><Label>Section Title</Label><input className={inputCls} value={data.title || ''} onChange={(e) => onChange({ ...data, title: e.target.value })} /></Field>
      <div className="space-y-3 mt-2">
        {steps.map((step, idx) => (
          <div key={step.id} className="border border-hairline p-4 bg-alabaster relative">
            <button onClick={() => removeStep(step.id)} className="absolute top-3 right-3 w-6 h-6 border border-terracotta/30 bg-white text-terracotta text-xs flex items-center justify-center hover:bg-terracotta/5">×</button>
            <div className="grid grid-cols-4 gap-3">
              <Field><Label>Number</Label><input className={inputCls} value={step.number} onChange={(e) => updateStep(step.id, 'number', e.target.value)} /></Field>
              <div className="col-span-3"><Field><Label>Title</Label><input className={inputCls} value={step.title} onChange={(e) => updateStep(step.id, 'title', e.target.value)} /></Field></div>
            </div>
            <Field><Label>Description</Label><textarea className={textareaCls} value={step.description} onChange={(e) => updateStep(step.id, 'description', e.target.value)} /></Field>
          </div>
        ))}
      </div>
      <button onClick={addStep} className="mt-4 w-full py-3 border-2 border-dashed border-forest/20 text-sm font-semibold text-forest hover:border-forest/40 hover:bg-forest/5 transition-all">+ Add Step</button>
    </div>
  );
}

// ─── Section editor dispatcher ────────────────────────────────────────────────

function SectionEditor({ section, onChange }: { section: Section; onChange: (d: any) => void }) {
  switch (section.type) {
    case 'hero': return <HeroEditor data={section.data} onChange={onChange} />;
    case 'how_it_works': return <HowItWorksEditor data={section.data} onChange={onChange} />;
    case 'promise': return <PromiseEditor data={section.data} onChange={onChange} />;
    case 'quote': return <QuoteEditor data={section.data} onChange={onChange} />;
    case 'builder_model': return <BuilderModelEditor data={section.data} onChange={onChange} />;
    case 'stats_bar': return <StatsBarEditor data={section.data} onChange={onChange} />;
    case 'philosophy': return <PhilosophyEditor data={section.data} onChange={onChange} />;
    case 'cta': return <CtaEditor data={section.data} onChange={onChange} />;
    case 'card_carousel': return <CardCarouselEditor data={section.data} onChange={onChange} />;
    case 'rich_text': return <RichTextEditor data={section.data} onChange={onChange} />;
    case 'steps': return <StepsEditor data={section.data} onChange={onChange} />;
    default: return <p className="text-sm text-ink/50 italic">No editor available for this section type.</p>;
  }
}

// ─── Add Section Modal ────────────────────────────────────────────────────────

function AddSectionModal({ onAdd, onClose }: { onAdd: (type: SectionType) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm">
      <div className="bg-parchment border border-hairline w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="border-b border-hairline px-8 py-6 flex justify-between items-center sticky top-0 bg-parchment z-10">
          <h2 className="font-serif text-2xl font-bold">Add Section</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-terracotta transition-colors text-2xl leading-none">×</button>
        </div>
        <div className="p-8 grid grid-cols-1 gap-3">
          {ALL_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => { onAdd(type); onClose(); }}
              className="text-left border border-hairline p-4 bg-white hover:border-forest hover:bg-forest/5 transition-all group"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-serif text-lg font-bold text-forest group-hover:text-terracotta transition-colors mb-1">
                    {SECTION_TYPE_LABELS[type]}
                  </p>
                  <p className="font-sans text-xs text-ink/60 leading-relaxed">{SECTION_TYPE_DESCRIPTIONS[type]}</p>
                </div>
                <span className="font-sans text-[10px] uppercase tracking-widest text-ink/30 border border-hairline px-2 py-1 shrink-0">{type}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminHomepagePage() {
  const router = useRouter();
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Load existing sections from settings
  useEffect(() => {
    api.getSettings()
      .then((s) => {
        if (s.homepageSections) {
          try {
            const parsed = JSON.parse(s.homepageSections) as Section[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              setSections(parsed);
              return;
            }
          } catch { /* fall through */ }
        }
        setSections(DEFAULT_SECTIONS);
      })
      .catch(() => setSections(DEFAULT_SECTIONS))
      .finally(() => setLoading(false));
  }, []);

  const sorted = [...sections].sort((a, b) => a.order - b.order);

  const saveAll = useCallback(async () => {
    setSaving(true);
    try {
      await api.updateSettings({ homepageSections: JSON.stringify(sections) });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ } finally { setSaving(false); }
  }, [sections]);

  const resetToDefault = () => {
    if (!confirm('Reset homepage to default content? This cannot be undone.')) return;
    setSections(DEFAULT_SECTIONS);
  };

  const moveSection = (id: string, dir: 'up' | 'down') => {
    const sortedList = [...sections].sort((a, b) => a.order - b.order);
    const idx = sortedList.findIndex((s) => s.id === id);
    if (dir === 'up' && idx === 0) return;
    if (dir === 'down' && idx === sortedList.length - 1) return;
    const target = dir === 'up' ? idx - 1 : idx + 1;
    const newSorted = [...sortedList];
    [newSorted[idx], newSorted[target]] = [newSorted[target], newSorted[idx]];
    setSections(newSorted.map((s, i) => ({ ...s, order: i })));
  };

  const toggleVisible = (id: string) =>
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)));

  const deleteSection = (id: string) => {
    if (!confirm('Delete this section?')) return;
    setSections((prev) => prev.filter((s) => s.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const addSection = (type: SectionType) => {
    const maxOrder = sections.reduce((m, s) => Math.max(m, s.order), -1);
    const newSection: Section = {
      id: generateSectionId(),
      type,
      order: maxOrder + 1,
      visible: true,
      data: createDefaultData(type),
    };
    setSections((prev) => [...prev, newSection]);
    setExpandedId(newSection.id);
  };

  const updateSectionData = (id: string, newData: any) =>
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, data: newData } : s)));

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 bg-forest/10 border border-forest/20 animate-pulse" />
        <p className="text-[10px] uppercase tracking-widest text-ink/40 mt-4">Loading CMS data…</p>
      </div>
    );
  }

  return (
    <div className="text-ink px-8 py-12 max-w-[900px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-10 relative">
        <button
          onClick={() => router.push('/admin/dashboard')}
          className="absolute right-0 top-0 text-ink/40 hover:text-forest transition-colors font-sans text-[10px] uppercase tracking-widest cursor-pointer"
        >
          ← Dashboard
        </button>
        <p className="text-sm uppercase tracking-widest text-forest font-medium mb-3">Administration</p>
        <h1 className="font-serif text-5xl font-bold leading-none mb-2">Homepage CMS</h1>
        <p className="font-sans text-xs text-ink/50 uppercase tracking-widest">
          Create, edit, reorder, and hide sections. Save changes to publish.
        </p>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-4 mb-10">
        <button
          onClick={saveAll}
          disabled={saving}
          className="bg-forest text-parchment px-8 py-3 text-xs uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
        </button>
        <button
          onClick={() => setShowAddModal(true)}
          className="border border-forest text-forest px-8 py-3 text-xs uppercase tracking-widest font-bold hover:bg-forest/5 transition-colors"
        >
          + Add Section
        </button>
        <button
          onClick={resetToDefault}
          className="border border-hairline text-ink/50 px-6 py-3 text-xs uppercase tracking-widest hover:border-terracotta hover:text-terracotta transition-colors ml-auto"
        >
          Reset to Default
        </button>
      </div>

      {/* Section list */}
      <div className="space-y-2">
        {sorted.length === 0 && (
          <div className="py-20 border-2 border-dashed border-hairline text-center">
            <p className="font-sans text-sm text-ink/40">No sections yet. Click &ldquo;Add Section&rdquo; to get started.</p>
          </div>
        )}

        {sorted.map((section, idx) => {
          const isExpanded = expandedId === section.id;
          return (
            <div key={section.id} className={`border transition-all ${isExpanded ? 'border-forest' : 'border-hairline'} bg-white`}>
              {/* Section header row */}
              <div className="flex items-center gap-3 px-5 py-4">
                {/* Reorder */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => moveSection(section.id, 'up')} disabled={idx === 0} className="w-5 h-5 border border-hairline text-[9px] flex items-center justify-center disabled:opacity-20 hover:bg-forest/5 transition-colors">▲</button>
                  <button onClick={() => moveSection(section.id, 'down')} disabled={idx === sorted.length - 1} className="w-5 h-5 border border-hairline text-[9px] flex items-center justify-center disabled:opacity-20 hover:bg-forest/5 transition-colors">▼</button>
                </div>

                {/* Type badge */}
                <span className="font-sans text-[9px] uppercase tracking-widest bg-forest/10 text-forest px-2 py-1 shrink-0 border border-forest/20">
                  {section.type}
                </span>

                {/* Label */}
                <div className="flex-1 min-w-0">
                  <p className="font-serif text-base font-bold text-forest truncate">{SECTION_TYPE_LABELS[section.type]}</p>
                  <p className="font-sans text-[10px] text-ink/40 uppercase tracking-widest">Order {section.order}</p>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Visibility */}
                  <button
                    onClick={() => toggleVisible(section.id)}
                    title={section.visible ? 'Hide section' : 'Show section'}
                    className={`px-3 py-1 text-[10px] uppercase tracking-widest border transition-colors font-semibold ${section.visible ? 'border-forest text-forest hover:bg-forest/5' : 'border-ink/20 text-ink/30 hover:border-forest/30 hover:text-forest/50'}`}
                  >
                    {section.visible ? 'Visible' : 'Hidden'}
                  </button>

                  {/* Edit toggle */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : section.id)}
                    className={`px-3 py-1 text-[10px] uppercase tracking-widest border transition-colors font-semibold cursor-pointer ${isExpanded ? 'bg-forest text-parchment border-forest' : 'border-forest text-forest hover:bg-forest/5'}`}
                  >
                    {isExpanded ? 'Close' : 'Edit'}
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => deleteSection(section.id)}
                    className="w-8 h-8 border border-terracotta/20 text-terracotta flex items-center justify-center hover:bg-terracotta/5 transition-colors text-sm"
                    title="Delete section"
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Expanded editor */}
              {isExpanded && (
                <div className="border-t border-hairline px-5 py-6 bg-alabaster/50">
                  <div className="mb-4 pb-4 border-b border-hairline">
                    <p className="font-sans text-[10px] uppercase tracking-widest text-ink/50">
                      {SECTION_TYPE_DESCRIPTIONS[section.type]}
                    </p>
                  </div>
                  <SectionEditor
                    section={section}
                    onChange={(newData) => updateSectionData(section.id, newData)}
                  />
                  <div className="mt-6 pt-4 border-t border-hairline flex justify-end">
                    <button
                      onClick={() => setExpandedId(null)}
                      className="border border-hairline text-ink/50 px-5 py-2 text-xs uppercase tracking-widest hover:border-forest hover:text-forest transition-colors"
                    >
                      Collapse
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom save */}
      {sections.length > 0 && (
        <div className="mt-10 pt-8 border-t border-hairline flex items-center gap-4">
          <button
            onClick={saveAll}
            disabled={saving}
            className="bg-forest text-parchment px-8 py-3 text-xs uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
          {saved && <span className="font-sans text-xs text-forest uppercase tracking-widest">Homepage updated successfully.</span>}
        </div>
      )}

      {/* Add section modal */}
      {showAddModal && (
        <AddSectionModal onAdd={addSection} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}
