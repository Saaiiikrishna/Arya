'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import {
  Label, inputCls, inputClsSm, ErrorBanner, PrimaryBtn, SectionCard, GhostBtn,
} from './_ui';
import type { TabProps, ProductTab as ProductTabModel, ProductTabSection } from './types';
import {
  Plus, Trash2, ChevronUp, ChevronDown, X, FileText, Table, Code2, Megaphone, Image as ImageIcon, Save,
  type LucideIcon,
} from 'lucide-react';

/** Monotonic counter for stable local keys (tabs + sections) across reorders. */
let _tbSeq = 0;
const nextLocalId = () => `t${++_tbSeq}`;

/**
 * Dynamic product content-tabs builder.
 *
 * The whole tab/section tree is edited locally and persisted with a single
 * PUT upsert (`adminUpsertProductTabs`) — the backend REPLACES the tree wholesale.
 * Section `content` is built per-type to match catalog/dto/tabs.dto exactly:
 *   RICH_TEXT  { html }
 *   SPEC_TABLE { rows: [{ k, v }] }
 *   MEDIA      { items: [{ url(https), type?, caption? }] }
 *   CODE       { code, language? }
 *   CALLOUT    { body, variant? }
 */

type SectionType = 'RICH_TEXT' | 'SPEC_TABLE' | 'MEDIA' | 'CODE' | 'CALLOUT';

interface EditorSection {
  _localId: string;
  type: SectionType;
  title: string;
  // RICH_TEXT
  html: string;
  // CODE
  code: string;
  language: string;
  // CALLOUT
  body: string;
  variant: string;
  // SPEC_TABLE
  rows: { k: string; v: string }[];
  // MEDIA
  items: { url: string; type: string; caption: string }[];
}

interface EditorTab {
  _localId: string;
  title: string;
  isActive: boolean;
  sections: EditorSection[];
}

const SECTION_META: Record<SectionType, { label: string; icon: LucideIcon }> = {
  RICH_TEXT: { label: 'Rich Text', icon: FileText },
  SPEC_TABLE: { label: 'Spec Table', icon: Table },
  CODE: { label: 'Code', icon: Code2 },
  CALLOUT: { label: 'Callout', icon: Megaphone },
  MEDIA: { label: 'Media', icon: ImageIcon },
};

function emptySection(type: SectionType): EditorSection {
  return {
    _localId: nextLocalId(),
    type,
    title: '',
    html: '',
    code: '',
    language: '',
    body: '',
    variant: 'info',
    rows: [],
    items: [],
  };
}

/** Map a stored product.tabs tree into the local editor model. */
function fromProduct(tabs: ProductTabModel[] | undefined): EditorTab[] {
  return (tabs ?? []).map((t) => ({
    _localId: nextLocalId(),
    title: t.title ?? '',
    isActive: t.isActive !== false,
    sections: (t.sections ?? []).map((s: ProductTabSection) => {
      const c: Record<string, unknown> = s.content ?? {};
      return {
        _localId: nextLocalId(),
        type: (s.type as SectionType) ?? 'RICH_TEXT',
        title: s.title ?? '',
        html: typeof c.html === 'string' ? c.html : '',
        code: typeof c.code === 'string' ? c.code : '',
        language: typeof c.language === 'string' ? c.language : '',
        body: typeof c.body === 'string' ? c.body : '',
        variant: typeof c.variant === 'string' ? c.variant : 'info',
        rows: Array.isArray(c.rows)
          ? (c.rows as Array<{ k?: unknown; v?: unknown }>).map((r) => ({
              k: String(r?.k ?? ''),
              v: String(r?.v ?? ''),
            }))
          : [],
        items: Array.isArray(c.items)
          ? (c.items as Array<{ url?: unknown; type?: unknown; caption?: unknown }>).map((it) => ({
              url: String(it?.url ?? ''),
              type: String(it?.type ?? 'IMAGE'),
              caption: String(it?.caption ?? ''),
            }))
          : [],
      };
    }),
  }));
}

/** Build the per-type content JSON the backend DTO validates. */
function buildContent(s: EditorSection): Record<string, unknown> {
  switch (s.type) {
    case 'RICH_TEXT':
      return { html: s.html };
    case 'CODE':
      return { code: s.code, ...(s.language.trim() ? { language: s.language.trim() } : {}) };
    case 'CALLOUT':
      return { body: s.body, ...(s.variant.trim() ? { variant: s.variant.trim() } : {}) };
    case 'SPEC_TABLE':
      return { rows: s.rows.filter((r) => r.k.trim() || r.v.trim()).map((r) => ({ k: r.k, v: r.v })) };
    case 'MEDIA':
      return {
        items: s.items
          .filter((it) => it.url.trim())
          .map((it) => ({
            url: it.url.trim(),
            ...(it.type.trim() ? { type: it.type.trim() } : {}),
            ...(it.caption.trim() ? { caption: it.caption.trim() } : {}),
          })),
      };
    default:
      return {};
  }
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function TabsBuilderTab({ product, onChanged }: TabProps) {
  const [tabs, setTabs] = useState<EditorTab[]>(() => fromProduct(product.tabs));
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [addType, setAddType] = useState<SectionType>('RICH_TEXT');

  const setTabs2 = (next: EditorTab[]) => {
    setTabs(next);
    if (activeIdx >= next.length) setActiveIdx(Math.max(0, next.length - 1));
  };

  const addTab = () => {
    const next = [
      ...tabs,
      { _localId: nextLocalId(), title: `Tab ${tabs.length + 1}`, isActive: true, sections: [] },
    ];
    setTabs(next);
    setActiveIdx(next.length - 1);
  };

  const removeTab = (i: number) => {
    if (!confirm('Delete this tab and all its sections? This is saved only when you click Save Tabs.')) return;
    setTabs2(tabs.filter((_, idx) => idx !== i));
  };

  const patchTab = (i: number, patch: Partial<EditorTab>) => {
    setTabs(tabs.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  };

  const patchSection = (ti: number, si: number, patch: Partial<EditorSection>) => {
    setTabs(
      tabs.map((t, idx) =>
        idx === ti
          ? { ...t, sections: t.sections.map((s, sIdx) => (sIdx === si ? { ...s, ...patch } : s)) }
          : t,
      ),
    );
  };

  const addSection = (ti: number) => {
    setTabs(
      tabs.map((t, idx) =>
        idx === ti ? { ...t, sections: [...t.sections, emptySection(addType)] } : t,
      ),
    );
  };

  const removeSection = (ti: number, si: number) => {
    setTabs(
      tabs.map((t, idx) =>
        idx === ti ? { ...t, sections: t.sections.filter((_, sIdx) => sIdx !== si) } : t,
      ),
    );
  };

  const moveSection = (ti: number, si: number, dir: -1 | 1) => {
    setTabs(
      tabs.map((t, idx) =>
        idx === ti ? { ...t, sections: move(t.sections, si, si + dir) } : t,
      ),
    );
  };

  const validate = (): string | null => {
    for (const [ti, t] of tabs.entries()) {
      if (!t.title.trim()) return `Tab ${ti + 1} needs a title.`;
      for (const [si, s] of t.sections.entries()) {
        const where = `Tab "${t.title}" · section ${si + 1}`;
        if (s.type === 'RICH_TEXT' && !s.html.trim()) return `${where}: rich-text body is required.`;
        if (s.type === 'CODE' && !s.code.trim()) return `${where}: code is required.`;
        if (s.type === 'CALLOUT' && !s.body.trim()) return `${where}: callout body is required.`;
        if (s.type === 'SPEC_TABLE' && s.rows.filter((r) => r.k.trim()).length === 0)
          return `${where}: add at least one spec row.`;
        if (s.type === 'MEDIA') {
          const valid = s.items.filter((it) => it.url.trim());
          if (valid.length === 0) return `${where}: add at least one media item.`;
          for (const it of valid) {
            if (!/^https:\/\//i.test(it.url.trim()))
              return `${where}: media URLs must start with https://`;
          }
        }
      }
    }
    return null;
  };

  const save = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError(null);
    setSavedMsg(false);
    try {
      const payload = {
        tabs: tabs.map((t, ti) => ({
          title: t.title.trim(),
          sortOrder: ti,
          isActive: t.isActive,
          sections: t.sections.map((s, si) => ({
            type: s.type,
            ...(s.title.trim() ? { title: s.title.trim() } : {}),
            content: buildContent(s),
            sortOrder: si,
          })),
        })),
      };
      await api.adminUpsertProductTabs(product.id, payload);
      await onChanged();
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2500);
    } catch (e) {
      setError((e as Error)?.message || 'Failed to save tabs');
    } finally {
      setSaving(false);
    }
  };

  const active = tabs[activeIdx];

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />

      {/* Tab strip */}
      <div className="flex items-center gap-2 flex-wrap border-b border-hairline pb-3">
        {tabs.map((t, i) => (
          <div key={t._localId} className="flex items-center">
            <button
              onClick={() => setActiveIdx(i)}
              className={`px-4 py-2 text-[10px] uppercase tracking-widest font-bold border transition-colors ${
                i === activeIdx
                  ? 'border-forest bg-forest text-parchment'
                  : 'border-hairline bg-white text-ink/60 hover:border-forest/30'
              }`}
            >
              {t.title || `Tab ${i + 1}`}
              {!t.isActive && <span className="ml-1 opacity-60">(hidden)</span>}
            </button>
          </div>
        ))}
        <button
          onClick={addTab}
          className="px-4 py-2 text-[10px] uppercase tracking-widest font-bold border border-dashed border-hairline text-forest hover:border-forest transition-colors inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add Tab
        </button>
      </div>

      {tabs.length === 0 ? (
        <p className="text-ink/40 text-sm font-serif italic py-8 text-center border border-hairline bg-white">
          No content tabs. Add a tab to build the product description, specs, and guides.
        </p>
      ) : active ? (
        <SectionCard>
          {/* Tab header controls */}
          <div className="flex items-end gap-4 mb-6 pb-6 border-b border-hairline">
            <div className="flex-1">
              <Label required>Tab Title</Label>
              <input
                type="text"
                className={inputCls}
                value={active.title}
                onChange={(e) => patchTab(activeIdx, { title: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-4 pb-3">
              <label className="flex items-center gap-2 text-sm text-ink/70 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={active.isActive}
                  onChange={(e) => patchTab(activeIdx, { isActive: e.target.checked })}
                  className="accent-saffron"
                />
                Visible
              </label>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setTabs2(move(tabs, activeIdx, activeIdx - 1));
                    setActiveIdx(Math.max(0, activeIdx - 1));
                  }}
                  disabled={activeIdx === 0}
                  className="p-2 border border-hairline text-ink/50 hover:text-forest hover:border-forest disabled:opacity-30 transition-colors"
                  aria-label="Move tab left"
                >
                  <ChevronUp className="w-4 h-4 -rotate-90" />
                </button>
                <button
                  onClick={() => {
                    setTabs2(move(tabs, activeIdx, activeIdx + 1));
                    setActiveIdx(Math.min(tabs.length - 1, activeIdx + 1));
                  }}
                  disabled={activeIdx === tabs.length - 1}
                  className="p-2 border border-hairline text-ink/50 hover:text-forest hover:border-forest disabled:opacity-30 transition-colors"
                  aria-label="Move tab right"
                >
                  <ChevronDown className="w-4 h-4 -rotate-90" />
                </button>
              </div>
              <button
                onClick={() => removeTab(activeIdx)}
                className="p-2 border border-terracotta/40 text-terracotta hover:bg-terracotta hover:text-white transition-colors"
                aria-label="Delete tab"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Sections */}
          <div className="space-y-5">
            {active.sections.length === 0 ? (
              <p className="text-ink/40 text-sm font-serif italic py-4 text-center">No sections in this tab yet.</p>
            ) : (
              active.sections.map((s, si) => {
                const Meta = SECTION_META[s.type];
                const Icon = Meta.icon;
                return (
                  <div key={s._localId} className="border border-hairline">
                    <div className="flex items-center justify-between bg-alabaster px-4 py-2.5 border-b border-hairline">
                      <span className="text-[10px] uppercase tracking-widest font-bold text-ink/60 inline-flex items-center gap-2">
                        <Icon className="w-3.5 h-3.5 text-forest/60" /> {Meta.label}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => moveSection(activeIdx, si, -1)}
                          disabled={si === 0}
                          className="p-1.5 text-ink/40 hover:text-forest disabled:opacity-30 transition-colors"
                          aria-label="Move section up"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => moveSection(activeIdx, si, 1)}
                          disabled={si === active.sections.length - 1}
                          className="p-1.5 text-ink/40 hover:text-forest disabled:opacity-30 transition-colors"
                          aria-label="Move section down"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => removeSection(activeIdx, si)}
                          className="p-1.5 text-ink/40 hover:text-terracotta transition-colors"
                          aria-label="Delete section"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="p-4 space-y-4">
                      <div>
                        <Label>Section Heading (optional)</Label>
                        <input
                          type="text"
                          className={inputClsSm}
                          value={s.title}
                          onChange={(e) => patchSection(activeIdx, si, { title: e.target.value })}
                        />
                      </div>

                      {s.type === 'RICH_TEXT' && (
                        <div>
                          <Label>HTML Body</Label>
                          <textarea
                            rows={6}
                            className={`${inputCls} resize-y font-mono text-xs`}
                            value={s.html}
                            onChange={(e) => patchSection(activeIdx, si, { html: e.target.value })}
                            placeholder="<p>Rich text. HTML is sanitized server-side.</p>"
                          />
                        </div>
                      )}

                      {s.type === 'CODE' && (
                        <>
                          <div>
                            <Label>Language</Label>
                            <input
                              type="text"
                              className={`${inputClsSm} max-w-xs`}
                              value={s.language}
                              onChange={(e) => patchSection(activeIdx, si, { language: e.target.value })}
                              placeholder="cpp, python, bash…"
                            />
                          </div>
                          <div>
                            <Label>Code</Label>
                            <textarea
                              rows={8}
                              className={`${inputCls} resize-y font-mono text-xs`}
                              value={s.code}
                              onChange={(e) => patchSection(activeIdx, si, { code: e.target.value })}
                            />
                          </div>
                        </>
                      )}

                      {s.type === 'CALLOUT' && (
                        <>
                          <div>
                            <Label>Variant</Label>
                            <select
                              className={`${inputClsSm} max-w-xs`}
                              value={s.variant}
                              onChange={(e) => patchSection(activeIdx, si, { variant: e.target.value })}
                            >
                              {['info', 'success', 'warning', 'danger', 'note'].map((v) => (
                                <option key={v} value={v}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label>Body</Label>
                            <textarea
                              rows={3}
                              className={`${inputCls} resize-y`}
                              value={s.body}
                              onChange={(e) => patchSection(activeIdx, si, { body: e.target.value })}
                            />
                          </div>
                        </>
                      )}

                      {s.type === 'SPEC_TABLE' && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <Label>Specification Rows</Label>
                            <button
                              type="button"
                              onClick={() =>
                                patchSection(activeIdx, si, { rows: [...s.rows, { k: '', v: '' }] })
                              }
                              className="text-[9px] uppercase tracking-widest text-forest font-bold hover:underline inline-flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" /> Add Row
                            </button>
                          </div>
                          <div className="space-y-2">
                            {s.rows.map((r, ri) => (
                              <div key={ri} className="flex items-center gap-2">
                                <input
                                  type="text"
                                  placeholder="Spec name"
                                  className={`${inputClsSm} flex-1`}
                                  value={r.k}
                                  onChange={(e) => {
                                    const rows = [...s.rows];
                                    rows[ri] = { ...rows[ri], k: e.target.value };
                                    patchSection(activeIdx, si, { rows });
                                  }}
                                />
                                <input
                                  type="text"
                                  placeholder="Value"
                                  className={`${inputClsSm} flex-1`}
                                  value={r.v}
                                  onChange={(e) => {
                                    const rows = [...s.rows];
                                    rows[ri] = { ...rows[ri], v: e.target.value };
                                    patchSection(activeIdx, si, { rows });
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    patchSection(activeIdx, si, {
                                      rows: s.rows.filter((_, idx) => idx !== ri),
                                    })
                                  }
                                  className="text-ink/40 hover:text-terracotta transition-colors p-1"
                                  aria-label="Remove row"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {s.type === 'MEDIA' && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <Label>Media Items (https URLs)</Label>
                            <button
                              type="button"
                              onClick={() =>
                                patchSection(activeIdx, si, {
                                  items: [...s.items, { url: '', type: 'IMAGE', caption: '' }],
                                })
                              }
                              className="text-[9px] uppercase tracking-widest text-forest font-bold hover:underline inline-flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" /> Add Item
                            </button>
                          </div>
                          <div className="space-y-3">
                            {s.items.map((it, ii) => (
                              <div key={ii} className="flex items-start gap-2 border border-hairline/60 p-2 bg-alabaster/40">
                                <div className="flex-1 space-y-2">
                                  <input
                                    type="url"
                                    placeholder="https://cdn.example.com/img.png"
                                    className={inputClsSm}
                                    value={it.url}
                                    onChange={(e) => {
                                      const items = [...s.items];
                                      items[ii] = { ...items[ii], url: e.target.value };
                                      patchSection(activeIdx, si, { items });
                                    }}
                                  />
                                  <div className="flex items-center gap-2">
                                    <select
                                      className={`${inputClsSm} w-32`}
                                      value={it.type}
                                      onChange={(e) => {
                                        const items = [...s.items];
                                        items[ii] = { ...items[ii], type: e.target.value };
                                        patchSection(activeIdx, si, { items });
                                      }}
                                    >
                                      <option value="IMAGE">IMAGE</option>
                                      <option value="VIDEO">VIDEO</option>
                                    </select>
                                    <input
                                      type="text"
                                      placeholder="Caption (optional)"
                                      className={`${inputClsSm} flex-1`}
                                      value={it.caption}
                                      onChange={(e) => {
                                        const items = [...s.items];
                                        items[ii] = { ...items[ii], caption: e.target.value };
                                        patchSection(activeIdx, si, { items });
                                      }}
                                    />
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    patchSection(activeIdx, si, {
                                      items: s.items.filter((_, idx) => idx !== ii),
                                    })
                                  }
                                  className="text-ink/40 hover:text-terracotta transition-colors p-1"
                                  aria-label="Remove item"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Add section row */}
          <div className="flex items-center gap-2 mt-6 pt-6 border-t border-hairline">
            <select
              className={`${inputClsSm} w-44`}
              value={addType}
              onChange={(e) => setAddType(e.target.value as SectionType)}
            >
              {(Object.keys(SECTION_META) as SectionType[]).map((t) => (
                <option key={t} value={t}>
                  {SECTION_META[t].label}
                </option>
              ))}
            </select>
            <GhostBtn onClick={() => addSection(activeIdx)}>
              <span className="inline-flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Section
              </span>
            </GhostBtn>
          </div>
        </SectionCard>
      ) : null}

      {/* Save bar */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {savedMsg && (
          <span className="text-[10px] uppercase tracking-widest text-success font-bold">Tabs saved</span>
        )}
        <PrimaryBtn onClick={save} disabled={saving}>
          <span className="flex items-center gap-2">
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : 'Save Tabs'}
          </span>
        </PrimaryBtn>
      </div>
    </div>
  );
}
