'use client';

import { ReactNode, useMemo } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import { Info, AlertTriangle, CheckCircle2, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/cn';
import CodeBlock from './CodeBlock';
import MediaGallery, { GalleryMedia } from './MediaGallery';

/**
 * Shared renderer for admin-defined / user-submitted structured content.
 *
 * Used by BOTH the product detail page (each tab's `sections`) and the public
 * article page (the article `body.blocks`). The two surfaces use the same five
 * block types, discriminated by a `type` string, so a single renderer keeps the
 * sanitisation + structural mapping in ONE audited place.
 *
 * SECURITY (non-negotiable): the only block that can contain HTML is RICH_TEXT,
 * and its `.html` is run through isomorphic-dompurify BEFORE it ever reaches
 * `dangerouslySetInnerHTML`. No other block path touches raw HTML — SPEC_TABLE,
 * CODE, CALLOUT and MEDIA are rendered structurally as text/markup we construct,
 * so untrusted strings are escaped by React. NEVER add a code path that feeds a
 * backend string into `dangerouslySetInnerHTML` without routing it through the
 * `sanitize()` helper below.
 *
 * The block shapes mirror the backend `ProductTabSectionType` payloads
 * (catalog `tabs.dto.ts`) and the article body contract:
 *   RICH_TEXT  { html }
 *   SPEC_TABLE { rows: [{ k, v }] | [{ key, value }] }
 *   CODE       { code, language?, title? }
 *   CALLOUT    { body, variant? }            (info | success | warning | tip)
 *   MEDIA      { items: [{ url, type?, caption?, altText?, poster? }] }
 *
 * Each block is permissive: a `title` may appear on any block (rendered as a
 * sub-heading), and an unknown / malformed block is skipped rather than thrown,
 * so one bad admin entry never blanks the whole page.
 */

// ── Block model ─────────────────────────────────────────────────────────────

export type BlockType = 'RICH_TEXT' | 'SPEC_TABLE' | 'CODE' | 'CALLOUT' | 'MEDIA';

/**
 * A single content block. Deliberately permissive: the backend stores the
 * payload under `content` (product tab sections) but article bodies may inline
 * the fields directly on the block — we read both. All payload fields are
 * optional and validated at render time.
 */
export interface ContentBlock {
  type?: string | null;
  title?: string | null;
  /** Product tab sections nest the payload under `content`. */
  content?: Record<string, unknown> | null;
  /** Article blocks may inline payload fields on the block itself. */
  [k: string]: unknown;
}

export interface BlockRendererProps {
  /** Ordered list of content blocks / sections to render. */
  blocks: ContentBlock[] | null | undefined;
  className?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// SECURITY: force every surviving anchor that opens a new tab to carry
// rel="noopener noreferrer". DOMPurify does NOT inject this automatically, so an
// author-supplied `<a target="_blank">` would otherwise expose `window.opener`
// and enable reverse-tabnabbing of the parent store page. Registered once at
// module load (idempotent — DOMPurify de-dupes identical hook callbacks is not
// guaranteed, so we guard with a module flag).
let anchorHookRegistered = false;
function ensureAnchorHook(): void {
  if (anchorHookRegistered) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('target')) {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  anchorHookRegistered = true;
}

/** Sanitise an untrusted HTML string for safe rendering. */
function sanitize(html: string): string {
  // Default DOMPurify config strips <script>, event handlers, javascript: URIs,
  // and other XSS vectors while keeping ordinary rich-text markup. We additionally
  // force any surviving <a target="_blank"> to open safely (see ensureAnchorHook).
  ensureAnchorHook();
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style'],
    FORBID_ATTR: ['style'],
  });
}

/** Read a block's payload, whether it lives under `content` or inline. */
function payloadOf(block: ContentBlock): Record<string, unknown> {
  if (block.content && typeof block.content === 'object') {
    return block.content as Record<string, unknown>;
  }
  return block as Record<string, unknown>;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

interface SpecRow {
  k: string;
  v: string;
}

/** Normalise spec-table rows that may use {k,v} or {key,value} keys. */
function normaliseRows(raw: unknown): SpecRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SpecRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const k = asString(r.k) ?? asString(r.key) ?? asString(r.label);
    const v = asString(r.v) ?? asString(r.value);
    if (k !== null || v !== null) out.push({ k: k ?? '', v: v ?? '' });
  }
  return out;
}

/** Normalise MEDIA items into the GalleryMedia shape, dropping URL-less rows. */
function normaliseMedia(raw: unknown): GalleryMedia[] {
  if (!Array.isArray(raw)) return [];
  const out: GalleryMedia[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const url = asString(m.url);
    if (!url) continue;
    const type = m.type === 'VIDEO' ? 'VIDEO' : 'IMAGE';
    out.push({
      url,
      type,
      caption: asString(m.caption),
      altText: asString(m.altText) ?? asString(m.alt),
      poster: asString(m.poster),
    });
  }
  return out;
}

// CALLOUT variant → icon + tonal styling. Unknown variants fall back to 'info'.
type CalloutVariant = 'info' | 'success' | 'warning' | 'tip';

const CALLOUT_STYLES: Record<
  CalloutVariant,
  { icon: typeof Info; box: string; icon_cls: string }
> = {
  info: {
    icon: Info,
    box: 'border-forest/25 bg-forest/[0.04]',
    icon_cls: 'text-forest',
  },
  success: {
    icon: CheckCircle2,
    box: 'border-success/30 bg-success/[0.06]',
    icon_cls: 'text-success',
  },
  warning: {
    icon: AlertTriangle,
    box: 'border-terracotta/30 bg-terracotta/[0.05]',
    icon_cls: 'text-terracotta',
  },
  tip: {
    icon: Lightbulb,
    box: 'border-saffron/35 bg-saffron-glow/20',
    icon_cls: 'text-saffron-deep',
  },
};

function calloutVariant(v: unknown): CalloutVariant {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (s === 'success') return 'success';
  if (s === 'warning' || s === 'danger' || s === 'error') return 'warning';
  if (s === 'tip' || s === 'note') return 'tip';
  return 'info';
}

// ── Per-block renderers ─────────────────────────────────────────────────────

function BlockTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-serif text-lg text-forest leading-snug">{children}</h3>
  );
}

function renderBlock(block: ContentBlock, key: string): ReactNode {
  const type = (typeof block.type === 'string' ? block.type : '').toUpperCase();
  const payload = payloadOf(block);
  const title = asString(block.title);

  switch (type) {
    case 'RICH_TEXT': {
      const html = asString(payload.html);
      if (!html) return null;
      return (
        <section key={key} className="flex flex-col gap-3">
          {title && <BlockTitle>{title}</BlockTitle>}
          <div
            className="mkt-prose font-sans text-[15px] leading-relaxed text-ink/80"
            // SECURITY: sanitised via DOMPurify (sanitize() above) — the ONLY HTML
            // path in this renderer. Do not duplicate this elsewhere.
            dangerouslySetInnerHTML={{ __html: sanitize(html) }}
          />
        </section>
      );
    }

    case 'SPEC_TABLE': {
      const rows = normaliseRows(payload.rows);
      if (rows.length === 0) return null;
      return (
        <section key={key} className="flex flex-col gap-3">
          {title && <BlockTitle>{title}</BlockTitle>}
          <div className="overflow-hidden rounded-xl border border-hairline">
            <table className="w-full border-collapse text-left">
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-hairline/70 last:border-0 even:bg-parchment-dark/30"
                  >
                    <th
                      scope="row"
                      className="w-2/5 px-4 py-3 align-top font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-forest"
                    >
                      {row.k}
                    </th>
                    <td className="px-4 py-3 align-top font-sans text-sm text-ink/80">
                      {row.v}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    }

    case 'CODE': {
      const code = asString(payload.code);
      if (!code) return null;
      return (
        <section key={key} className="flex flex-col gap-3">
          {title && <BlockTitle>{title}</BlockTitle>}
          <CodeBlock
            code={code}
            language={asString(payload.language) ?? undefined}
            title={asString(payload.title) ?? undefined}
            className="rounded-xl"
          />
        </section>
      );
    }

    case 'CALLOUT': {
      const body = asString(payload.body) ?? asString(payload.text);
      if (!body) return null;
      const variant = calloutVariant(payload.variant);
      const { icon: Icon, box, icon_cls } = CALLOUT_STYLES[variant];
      return (
        <section
          key={key}
          className={cn('flex gap-3 rounded-xl border p-4', box)}
        >
          <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', icon_cls)} aria-hidden />
          <div className="flex flex-col gap-1">
            {title && (
              <span className="font-sans text-sm font-semibold text-forest">
                {title}
              </span>
            )}
            <p className="font-sans text-sm leading-relaxed text-ink/80">{body}</p>
          </div>
        </section>
      );
    }

    case 'MEDIA': {
      const media = normaliseMedia(payload.items);
      if (media.length === 0) return null;
      return (
        <section key={key} className="flex flex-col gap-3">
          {title && <BlockTitle>{title}</BlockTitle>}
          <MediaGallery media={media} mkt aspect="aspect-video" />
        </section>
      );
    }

    default:
      // Unknown / malformed block — skip silently so one bad entry never blanks
      // the page.
      return null;
  }
}

// ── Public component ────────────────────────────────────────────────────────

export function BlockRenderer({ blocks, className }: BlockRendererProps) {
  const rendered = useMemo(() => {
    if (!Array.isArray(blocks)) return [];
    return blocks
      .map((block, i) => renderBlock(block, `block-${i}`))
      .filter(Boolean);
  }, [blocks]);

  if (rendered.length === 0) {
    return (
      <p className={cn('font-sans text-sm italic text-ink/40', className)}>
        Nothing here yet.
      </p>
    );
  }

  return <div className={cn('flex flex-col gap-8', className)}>{rendered}</div>;
}

export default BlockRenderer;
