'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface CodeBlockProps {
  code: string;
  /** Language label shown in the header (e.g. "bash", "arduino"). */
  language?: string;
  /** Optional filename / title shown in the header. */
  title?: string;
  /** Show line numbers. Default: false. */
  showLineNumbers?: boolean;
  className?: string;
}

/**
 * Monospace code block with a copy-to-clipboard button — used by DIY guides to
 * present commands / firmware snippets. Forest-on-dark terminal styling; the copy
 * button flips to a check for ~1.6s after a successful copy.
 *
 * Kept on the matte side (subtle rounding only) so it sits comfortably inside
 * either the public DIY surface or an admin preview.
 */
export default function CodeBlock({
  code,
  language,
  title,
  showLineNumbers = false,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be blocked (insecure context); silently no-op.
    }
  };

  const lines = code.replace(/\n$/, '').split('\n');

  return (
    <div
      className={cn(
        'overflow-hidden border border-forest-deep/40 bg-forest-deep text-parchment',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-forest px-4 py-2">
        <span className="font-sans text-[11px] uppercase tracking-[0.08em] text-parchment/70">
          {title || language || 'Code'}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="inline-flex items-center gap-1.5 font-sans text-[11px] uppercase tracking-[0.06em] text-parchment/70 transition-colors hover:text-parchment"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-marigold" aria-hidden />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Copy
            </>
          )}
        </button>
      </div>

      <pre className="overflow-x-auto px-4 py-3.5 text-[13px] leading-relaxed">
        <code className="font-mono">
          {showLineNumbers
            ? lines.map((line, i) => (
                <span key={i} className="grid grid-cols-[2.5rem_1fr]">
                  <span className="select-none text-parchment/30">{i + 1}</span>
                  <span>{line || ' '}</span>
                </span>
              ))
            : code}
        </code>
      </pre>
    </div>
  );
}
