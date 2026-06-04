'use client';

/**
 * Author article submission.
 *
 * Identity: accepts EITHER a logged-in store customer (useStoreAuth) OR a
 * logged-in platform applicant (useAuth). The backend ArticleAuthorGuard accepts
 * both an APPLICANT and a CUSTOMER token; storeApi.submitArticle sends whichever
 * customer token is in memory, and the platform applicant identity rides the
 * admin api client. We surface a sign-in prompt only when NEITHER is present.
 *
 * Flow (driven by the backend contract):
 *   1. COMPOSE — title, excerpt, category, tags, and a simple block body editor
 *      (RICH_TEXT / CODE / CALLOUT / SPEC_TABLE). Body is serialised to the
 *      `{ blocks: [...] }` shape the shared BlockRenderer consumes.
 *   2. CREATE — storeApi.submitArticle creates the article (status SUBMITTED) and
 *      returns its id. Media presign/confirm require an existing article id, so
 *      media is attached AFTER creation.
 *   3. MEDIA — inline images/video via MediaUploader (caps 15 img / 3 video)
 *      against the returned id. We do NOT set a cover here: the backend only
 *      permits an author cover PATCH (`PATCH /articles/:id` with `coverS3Key`)
 *      while the article is in REJECTED status — a PATCH on a freshly SUBMITTED
 *      article is refused — so the cover is chosen by a moderator during review.
 *      (See the in-code note in the MEDIA section below for the full rationale.)
 *   4. DONE — pending-review success screen.
 *
 * Public marketing surface → `.mkt` premium layer inside Layout
 * (activeTab='articles').
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  PenLine,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Type as TypeIcon,
  Code2,
  Megaphone,
  Table2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  LogIn,
  ImagePlus,
} from 'lucide-react';
import Layout from '@/components/Layout';
import { MediaUploader, type MediaType } from '@/components/store';
import { useStoreAuth } from '@/lib/storeAuth';
import { useAuth } from '@/lib/auth';
import { storeApi, type ArticleDetail } from '@/lib/storeApi';
import { ApiError } from '@/lib/api';

// ── Block editor model ───────────────────────────────────────────────────────
//
// Each editor block carries a local `_id` (stripped before submit) plus the
// fields BlockRenderer reads INLINE on the block (html / code / body / rows).

type EditorBlockType = 'RICH_TEXT' | 'CODE' | 'CALLOUT' | 'SPEC_TABLE';

interface SpecRowDraft {
  /** Stable local key so React reconciles rows by identity, not array index. */
  _id: string;
  k: string;
  v: string;
}

interface EditorBlock {
  _id: string;
  type: EditorBlockType;
  title?: string;
  // RICH_TEXT
  html?: string;
  // CODE
  code?: string;
  language?: string;
  // CALLOUT
  body?: string;
  variant?: 'info' | 'success' | 'warning' | 'tip';
  // SPEC_TABLE
  rows?: SpecRowDraft[];
}

const BLOCK_META: Record<
  EditorBlockType,
  { label: string; icon: typeof TypeIcon; hint: string }
> = {
  RICH_TEXT: { label: 'Text', icon: TypeIcon, hint: 'A paragraph. Basic HTML (bold, links, lists) is allowed and sanitised.' },
  CODE: { label: 'Code', icon: Code2, hint: 'A monospace code snippet with an optional language.' },
  CALLOUT: { label: 'Callout', icon: Megaphone, hint: 'A highlighted note (info, tip, success, or warning).' },
  SPEC_TABLE: { label: 'Spec table', icon: Table2, hint: 'A two-column key/value table.' },
};

function newBlockId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `b-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeBlock(type: EditorBlockType): EditorBlock {
  const base: EditorBlock = { _id: newBlockId(), type };
  if (type === 'SPEC_TABLE') base.rows = [{ _id: newBlockId(), k: '', v: '' }];
  if (type === 'CALLOUT') base.variant = 'info';
  return base;
}

/** Strip local-only fields + empty values into the BlockRenderer block shape. */
function serialiseBlock(b: EditorBlock): Record<string, unknown> | null {
  const out: Record<string, unknown> = { type: b.type };
  if (b.title?.trim()) out.title = b.title.trim();
  switch (b.type) {
    case 'RICH_TEXT': {
      const html = b.html?.trim();
      if (!html) return null;
      out.html = html;
      return out;
    }
    case 'CODE': {
      const code = b.code?.replace(/\s+$/, '');
      if (!code) return null;
      out.code = code;
      if (b.language?.trim()) out.language = b.language.trim();
      return out;
    }
    case 'CALLOUT': {
      const body = b.body?.trim();
      if (!body) return null;
      out.body = body;
      out.variant = b.variant ?? 'info';
      return out;
    }
    case 'SPEC_TABLE': {
      const rows = (b.rows ?? [])
        .map((r) => ({ k: r.k.trim(), v: r.v.trim() }))
        .filter((r) => r.k || r.v);
      if (rows.length === 0) return null;
      out.rows = rows;
      return out;
    }
    default:
      return null;
  }
}

// DESIGN: intentional mkt-* exception. These are PUBLIC marketing form fields
// living inside the `.mkt` premium wrapper (DESIGN.md §7), so the rounded glass
// treatment is in-scope and matches the rounded search field on the journal index
// (`/articles`). The 0px-radius rule applies to the admin/app surfaces, not the
// `.mkt`-scoped marketing layer.
const FIELD_CLS =
  'w-full rounded-xl border border-hairline bg-white/70 px-4 py-3 font-sans text-sm text-ink placeholder:text-ink/40 outline-none backdrop-blur transition-colors focus:border-saffron';
const LABEL_CLS =
  'font-sans text-[11px] font-bold uppercase tracking-[0.1em] text-forest/80';

/**
 * Stable outer chrome (Layout + `.mkt` background) for every phase of the submit
 * flow. Defined at module scope — NOT as a function inside the component — so React
 * reconciles it across renders instead of remounting the children on every
 * keystroke (which would blur the active input and reset uncontrolled state).
 */
function ArticleShell({ children }: { children: React.ReactNode }) {
  return (
    <Layout activeTab="articles">
      <div className="mkt relative overflow-hidden bg-parchment min-h-[calc(100vh-80px)]">
        <div
          aria-hidden
          className="mkt-float mkt-glow-pulse pointer-events-none absolute -top-28 -right-24 w-[32rem] h-[32rem] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(244,163,0,0.18), transparent 62%)' }}
        />
        <div className="relative z-10 mx-auto max-w-3xl px-6 py-14 md:px-8 md:py-20">
          {children}
        </div>
      </div>
    </Layout>
  );
}

export default function ArticleSubmitPage() {
  const router = useRouter();
  const { isAuthed: storeAuthed, loading: storeLoading } = useStoreAuth();
  const { isAuthenticated: platformAuthed, loading: platformLoading } = useAuth();

  // Show the "checking session" spinner while EITHER provider is still hydrating.
  // (An AND here would clear the gate the moment the FIRST provider settled and
  // briefly flash the "Sign in to publish" wall at an already-logged-in user.)
  const authLoading = storeLoading || platformLoading;
  const isAuthed = storeAuthed || platformAuthed;

  // ── Phase state ───────────────────────────────────────────────────────────
  type Phase = 'compose' | 'media' | 'done';
  const [phase, setPhase] = useState<Phase>('compose');

  // ── Compose fields ────────────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [category, setCategory] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [blocks, setBlocks] = useState<EditorBlock[]>([makeBlock('RICH_TEXT')]);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Created article (after phase 1).
  const [created, setCreated] = useState<ArticleDetail | null>(null);

  const tags = useMemo(
    () =>
      tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 25),
    [tagsInput],
  );

  // ── Block editor mutations ────────────────────────────────────────────────

  const patchBlock = (id: string, patch: Partial<EditorBlock>) =>
    setBlocks((prev) => prev.map((b) => (b._id === id ? { ...b, ...patch } : b)));

  const addBlock = (type: EditorBlockType) =>
    setBlocks((prev) => [...prev, makeBlock(type)]);

  const removeBlock = (id: string) =>
    setBlocks((prev) => prev.filter((b) => b._id !== id));

  const moveBlock = (id: string, dir: -1 | 1) =>
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b._id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });

  // SPEC_TABLE row helpers
  const addRow = (blockId: string) =>
    setBlocks((prev) =>
      prev.map((b) =>
        b._id === blockId
          ? { ...b, rows: [...(b.rows ?? []), { _id: newBlockId(), k: '', v: '' }] }
          : b,
      ),
    );
  const patchRow = (blockId: string, rowIdx: number, patch: Partial<SpecRowDraft>) =>
    setBlocks((prev) =>
      prev.map((b) =>
        b._id === blockId
          ? {
              ...b,
              rows: (b.rows ?? []).map((r, i) => (i === rowIdx ? { ...r, ...patch } : r)),
            }
          : b,
      ),
    );
  const removeRow = (blockId: string, rowIdx: number) =>
    setBlocks((prev) =>
      prev.map((b) =>
        b._id === blockId
          ? { ...b, rows: (b.rows ?? []).filter((_, i) => i !== rowIdx) }
          : b,
      ),
    );

  // ── Submit (phase 1 → create) ─────────────────────────────────────────────

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (title.trim().length < 3) {
      setFormError('Give your article a title (at least 3 characters).');
      return;
    }
    const serialised = blocks
      .map(serialiseBlock)
      .filter((b): b is Record<string, unknown> => b !== null);
    if (serialised.length === 0) {
      setFormError('Add at least one content block with text before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      const allTags = category.trim() ? [category.trim(), ...tags] : tags;
      const article = await storeApi.submitArticle({
        title: title.trim(),
        body: { blocks: serialised },
        excerpt: excerpt.trim() || undefined,
        tags: Array.from(new Set(allTags.map((t) => t.trim()).filter(Boolean))),
      });
      setCreated(article);
      setPhase('media');
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'Something went wrong submitting your article. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── Media presign / confirm bound to the created article ──────────────────

  const presign = async (type: MediaType, file: File) => {
    if (!created) throw new Error('Article not created yet');
    const res = await storeApi.presignArticleMedia(created.id, {
      type,
      fileName: file.name,
      mimeType: file.type,
    });
    return { uploadUrl: res.uploadUrl, mediaId: res.mediaId };
  };

  const confirm = async (mediaId: string, _type: MediaType, file: File) => {
    if (!created) throw new Error('Article not created yet');
    return storeApi.confirmArticleMedia(created.id, mediaId, { fileSize: file.size });
  };

  // NOTE: we deliberately do NOT attempt to set the first uploaded image as the
  // article cover here. The article is already SUBMITTED at this point, and the
  // backend only permits an author cover PATCH (`PATCH /articles/:id` with a
  // `coverS3Key`) while the article is in REJECTED status — a PATCH on a SUBMITTED
  // article is refused. Additionally, `confirmArticleMedia` returns `unknown` (its
  // shape is not documented to include an `s3Key`), so there is no reliable key to
  // PATCH with. The cover is therefore chosen by a moderator during review; we make
  // that explicit to the author in the media step rather than silently failing.

  // ── Render ────────────────────────────────────────────────────────────────

  // Auth gate (after hydration settles).
  if (authLoading) {
    return (
      <ArticleShell>
        <div className="flex flex-col items-center justify-center gap-3 py-28 text-ink/50">
          <Loader2 className="h-7 w-7 animate-spin text-saffron" aria-hidden />
          <span className="font-sans text-sm">Checking your session…</span>
        </div>
      </ArticleShell>
    );
  }

  if (!isAuthed) {
    return (
      <ArticleShell>
      {/* DESIGN: intentional mkt-* exception — static sign-in panel inside `.mkt`
          (DESIGN.md §7), not an interactive mkt-card. */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto flex max-w-md flex-col items-center gap-5 rounded-2xl border border-hairline bg-white/50 px-8 py-16 text-center backdrop-blur"
      >
        <div className="mkt-pill">
          <PenLine className="h-3.5 w-3.5 text-saffron-deep" />
          <span className="font-sans text-[10px] uppercase tracking-[0.22em] font-bold text-forest/80">
            Authors only
          </span>
        </div>
        <h1 className="font-serif text-3xl text-forest">Sign in to publish</h1>
        <p className="font-sans text-sm text-ink/65">
          You need an account to write for the journal. Sign in (or create one) and
          your draft will be submitted for review.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => router.push('/login')} className="mkt-btn !py-2.5 !px-5">
            <LogIn className="h-4 w-4" />
            <span>Sign in</span>
          </button>
          <button type="button" onClick={() => router.push('/articles')} className="mkt-btn-ghost !py-2.5 !px-5">
            <span>Back to the journal</span>
          </button>
        </div>
      </motion.div>
      </ArticleShell>
    );
  }

  // ── DONE ──────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <ArticleShell>
      {/* DESIGN: intentional mkt-* exception — static success panel inside `.mkt`
          (DESIGN.md §7), not an interactive mkt-card. */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto flex max-w-md flex-col items-center gap-5 rounded-2xl border border-success/30 bg-success/[0.05] px-8 py-16 text-center"
      >
        <CheckCircle2 className="h-12 w-12 text-success" aria-hidden />
        <h1 className="font-serif text-3xl text-forest">Submitted for review</h1>
        <p className="font-sans text-sm text-ink/70">
          Thank you. Your article{created?.title ? ` "${created.title}"` : ''} is now
          in the moderation queue. We will email you when it is published or if any
          changes are needed.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={() => router.push('/articles')} className="mkt-btn !py-2.5 !px-5">
            <span>Back to the journal</span>
          </button>
        </div>
      </motion.div>
      </ArticleShell>
    );
  }

  // ── MEDIA (phase 2) ─────────────────────────────────────────────────────────
  if (phase === 'media' && created) {
    return (
      <ArticleShell>
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-8"
      >
        <div>
          <div className="mkt-pill mb-5">
            <ImagePlus className="h-3.5 w-3.5 text-saffron-deep" />
            <span className="font-sans text-[10px] uppercase tracking-[0.22em] font-bold text-forest/80">
              Step 2 of 2 · Media
            </span>
          </div>
          <h1 className="font-serif text-4xl text-forest leading-tight">
            Add a cover &amp; images
          </h1>
          <p className="mt-4 font-sans text-sm text-ink/65">
            Your article{created.title ? ` "${created.title}"` : ''} has been created.
            Add up to 15 images and 3 videos. A cover image is chosen by our
            editors when your article is reviewed.
          </p>
        </div>

        <div className="rounded-2xl border border-hairline bg-white/50 p-6 backdrop-blur">
          <MediaUploader
            presign={presign}
            confirm={confirm}
            caps={{ maxImages: 15, maxVideos: 3 }}
            mkt
          />
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-hairline bg-white/60 px-4 py-3 font-sans text-sm text-ink/65">
          <AlertCircle className="h-4 w-4 text-saffron-deep" aria-hidden />
          Your images are attached. The cover will be selected during review.
        </div>

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-sans text-xs text-ink/50">
            Media is optional — you can finish without adding any.
          </p>
          <button
            type="button"
            onClick={() => setPhase('done')}
            className="mkt-btn !py-3 !px-7"
          >
            <span>Finish &amp; submit</span>
          </button>
        </div>
      </motion.div>
      </ArticleShell>
    );
  }

  // ── COMPOSE (phase 1) ───────────────────────────────────────────────────────
  return (
    <ArticleShell>
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="mkt-pill mb-5">
        <PenLine className="h-3.5 w-3.5 text-saffron-deep" />
        <span className="font-sans text-[10px] uppercase tracking-[0.22em] font-bold text-forest/80">
          Step 1 of 2 · Write
        </span>
      </div>
      <h1 className="font-serif-display font-bold text-5xl text-forest leading-[0.95] tracking-[-0.025em]">
        Write an article
      </h1>
      <p className="mt-4 font-sans text-ink/65 text-base leading-relaxed">
        Share a build log, teardown, or lesson. Submissions are reviewed before
        they go live.
      </p>

      <form onSubmit={onCreate} className="mt-10 flex flex-col gap-7">
        {/* Title */}
        <div className="flex flex-col gap-2">
          <label htmlFor="title" className={LABEL_CLS}>Title</label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="How I built a soil-moisture sensor for ₹200"
            maxLength={300}
            className={FIELD_CLS}
            required
          />
        </div>

        {/* Excerpt */}
        <div className="flex flex-col gap-2">
          <label htmlFor="excerpt" className={LABEL_CLS}>Excerpt</label>
          <textarea
            id="excerpt"
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="A one- or two-line summary shown on the journal index."
            maxLength={600}
            rows={2}
            className={`${FIELD_CLS} resize-y`}
          />
          <span className="font-sans text-[11px] text-ink/40">{excerpt.length}/600</span>
        </div>

        {/* Category + tags */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="category" className={LABEL_CLS}>Category</label>
            <input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Electronics"
              maxLength={60}
              className={FIELD_CLS}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="tags" className={LABEL_CLS}>Tags</label>
            <input
              id="tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="comma, separated, tags"
              className={FIELD_CLS}
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-saffron-glow/30 px-2.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.06em] text-saffron-deep"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Body block editor */}
        <div className="flex flex-col gap-3">
          <span className={LABEL_CLS}>Body</span>

          <div className="flex flex-col gap-4">
            {blocks.map((b, idx) => {
              const Meta = BLOCK_META[b.type];
              return (
                <div
                  key={b._id}
                  className="rounded-2xl border border-hairline bg-white/55 p-4 backdrop-blur"
                >
                  {/* Block header */}
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 font-sans text-[11px] font-bold uppercase tracking-[0.08em] text-forest/75">
                      <Meta.icon className="h-3.5 w-3.5 text-saffron-deep" aria-hidden />
                      {Meta.label}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveBlock(b._id, -1)}
                        disabled={idx === 0}
                        aria-label="Move block up"
                        className="rounded-full p-1.5 text-ink/45 transition-colors hover:text-forest disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveBlock(b._id, 1)}
                        disabled={idx === blocks.length - 1}
                        aria-label="Move block down"
                        className="rounded-full p-1.5 text-ink/45 transition-colors hover:text-forest disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBlock(b._id)}
                        disabled={blocks.length === 1}
                        aria-label="Remove block"
                        className="rounded-full p-1.5 text-ink/45 transition-colors hover:text-terracotta disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Optional sub-heading for any block */}
                  <input
                    value={b.title ?? ''}
                    onChange={(e) => patchBlock(b._id, { title: e.target.value })}
                    placeholder="Optional heading"
                    className={`${FIELD_CLS} mb-3`}
                  />

                  {/* Block body by type */}
                  {b.type === 'RICH_TEXT' && (
                    <textarea
                      value={b.html ?? ''}
                      onChange={(e) => patchBlock(b._id, { html: e.target.value })}
                      placeholder="Write your paragraph. Basic HTML like <strong>, <em>, <a>, <ul>/<li> is allowed and sanitised."
                      rows={5}
                      className={`${FIELD_CLS} resize-y font-sans`}
                    />
                  )}

                  {b.type === 'CODE' && (
                    <div className="flex flex-col gap-2">
                      <input
                        value={b.language ?? ''}
                        onChange={(e) => patchBlock(b._id, { language: e.target.value })}
                        placeholder="Language (e.g. arduino, bash)"
                        className={FIELD_CLS}
                      />
                      <textarea
                        value={b.code ?? ''}
                        onChange={(e) => patchBlock(b._id, { code: e.target.value })}
                        placeholder="Paste your code snippet here…"
                        rows={6}
                        spellCheck={false}
                        className={`${FIELD_CLS} resize-y font-mono text-[13px]`}
                      />
                    </div>
                  )}

                  {b.type === 'CALLOUT' && (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        {(['info', 'tip', 'success', 'warning'] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => patchBlock(b._id, { variant: v })}
                            aria-pressed={b.variant === v}
                            className={
                              b.variant === v
                                ? 'rounded-full bg-forest px-3 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-parchment'
                                : 'rounded-full border border-hairline bg-white/60 px-3 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-ink/60 transition-colors hover:border-saffron hover:text-saffron-deep'
                            }
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                      <textarea
                        value={b.body ?? ''}
                        onChange={(e) => patchBlock(b._id, { body: e.target.value })}
                        placeholder="Callout text…"
                        rows={3}
                        className={`${FIELD_CLS} resize-y`}
                      />
                    </div>
                  )}

                  {b.type === 'SPEC_TABLE' && (
                    <div className="flex flex-col gap-2">
                      {(b.rows ?? []).map((row, ri) => (
                        <div key={row._id} className="flex items-center gap-2">
                          <input
                            value={row.k}
                            onChange={(e) => patchRow(b._id, ri, { k: e.target.value })}
                            placeholder="Label"
                            className={`${FIELD_CLS} flex-1`}
                          />
                          <input
                            value={row.v}
                            onChange={(e) => patchRow(b._id, ri, { v: e.target.value })}
                            placeholder="Value"
                            className={`${FIELD_CLS} flex-1`}
                          />
                          <button
                            type="button"
                            onClick={() => removeRow(b._id, ri)}
                            disabled={(b.rows ?? []).length === 1}
                            aria-label="Remove row"
                            className="rounded-full p-2 text-ink/40 transition-colors hover:text-terracotta disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addRow(b._id)}
                        className="self-start inline-flex items-center gap-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-saffron-deep transition-colors hover:text-saffron"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add row
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add-block toolbar */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="font-sans text-[11px] uppercase tracking-[0.06em] text-ink/45">
              Add block:
            </span>
            {(Object.keys(BLOCK_META) as EditorBlockType[]).map((t) => {
              const Meta = BLOCK_META[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => addBlock(t)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-white/60 px-3 py-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-ink/65 backdrop-blur transition-colors hover:border-saffron hover:text-saffron-deep"
                >
                  <Meta.icon className="h-3.5 w-3.5" aria-hidden />
                  {Meta.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Error */}
        {formError && (
          <div className="flex items-center gap-2 rounded-xl border border-terracotta/40 bg-terracotta/[0.05] px-4 py-3 font-sans text-sm text-terracotta">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            {formError}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => router.push('/articles')}
            className="mkt-btn-ghost !py-3 !px-6"
          >
            <span>Cancel</span>
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="mkt-btn !py-3 !px-7 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Submitting…</span>
              </>
            ) : (
              <>
                <span>Submit &amp; add media</span>
              </>
            )}
          </button>
        </div>
      </form>
    </motion.div>
    </ArticleShell>
  );
}
