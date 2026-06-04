'use client';

/**
 * SkuPicker — admin/strict-DESIGN.md searchable SKU typeahead.
 *
 * Replaces raw SKU-UUID text inputs in admin store forms (inventory adjust /
 * transfer, purchasing PO line items). The operator types a SKU code, SKU name
 * or product name; results stream from `api.adminSearchSkus` (debounced) into a
 * dropdown. Selecting a row pins the resolved SKU id in the parent's form state
 * via `onSelect({ id, skuCode, name })` and shows the chosen SKU inline (with a
 * clear control to reselect).
 *
 * Strict admin surface: 0px radius, no shadows, 1px hairlines, matte forest
 * focus ring (mirrors the INPUT class used across the inventory/purchasing pages).
 * The results dropdown floats with the DESIGN.md glassmorphism treatment.
 *
 * Controlled by id: the parent owns the selected `value` (sku id) and the
 * display label (`selectedLabel`), so the picker stays a thin, reusable control.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X, Loader2, PackageSearch } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

export interface SkuPickerResult {
  id: string;
  skuCode: string;
  name: string | null;
  productName?: string | null;
}

export interface SkuPickerProps {
  /** Currently selected SKU id (empty string when none). Owned by the parent. */
  value: string;
  /** Display label for the selected SKU (e.g. "ABC-001 — Widget"). */
  selectedLabel?: string | null;
  /** Fired when a SKU is chosen from the results. */
  onSelect: (sku: { id: string; skuCode: string; name: string | null }) => void;
  /** Fired when the selection is cleared. */
  onClear?: () => void;
  placeholder?: string;
  /** Max results to request per query (server clamps to 50). Default 10. */
  limit?: number;
  disabled?: boolean;
  className?: string;
}

// Matches the strict matte input used across the admin store pages.
const INPUT_CLS =
  'w-full border border-hairline bg-white pl-9 pr-9 py-3 text-sm text-ink outline-none focus:border-forest disabled:opacity-50';

export default function SkuPicker({
  value,
  selectedLabel,
  onSelect,
  onClear,
  placeholder = 'Search SKU code, name or product…',
  limit = 10,
  disabled = false,
  className,
}: SkuPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SkuPickerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  // Guards against an out-of-order response overwriting fresher results.
  const reqSeq = useRef(0);

  // ── Debounced search ────────────────────────────────────────────────────────
  useEffect(() => {
    // Nothing to search until the dropdown is open and a (non-selected) query exists.
    if (!open) return;
    const term = query.trim();
    const seq = ++reqSeq.current;
    setError(null);
    // The spinner is set ONLY when the debounce actually fires a request — not
    // synchronously on every keystroke — so it never flashes during the 300ms wait.
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.adminSearchSkus(term, limit);
        if (seq !== reqSeq.current) return; // a newer query superseded this one
        setResults(Array.isArray(data) ? data : []);
      } catch (e: unknown) {
        if (seq !== reqSeq.current) return;
        setError(e instanceof Error ? e.message : 'Failed to search SKUs');
        setResults([]);
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    }, 300);
    // Clearing a pending timer (keystroke or dropdown close) must also drop any
    // loading state so the picker never re-opens showing a stale spinner.
    return () => {
      clearTimeout(t);
      setLoading(false);
    };
  }, [query, limit, open]);

  // ── Close on outside click ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = useCallback(
    (s: SkuPickerResult) => {
      onSelect({ id: s.id, skuCode: s.skuCode, name: s.name });
      setOpen(false);
      setQuery('');
      setResults([]);
    },
    [onSelect],
  );

  const clear = useCallback(() => {
    onClear?.();
    setQuery('');
    setResults([]);
    setOpen(true);
  }, [onClear]);

  // ── Selected state: show the chosen SKU with a clear control ─────────────────
  if (value && !open) {
    return (
      <div className={cn('relative', className)} ref={rootRef}>
        <div className="flex items-center justify-between gap-2 w-full border border-forest/40 bg-forest/5 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm text-ink font-semibold truncate">
              {selectedLabel || value}
            </div>
            <div className="text-[9px] uppercase tracking-widest text-forest/60 font-bold mt-0.5">
              SKU selected
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={clear}
              className="shrink-0 text-ink/40 hover:text-terracotta transition-colors"
              title="Clear selection"
              aria-label="Clear selected SKU"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Search state: input + results dropdown ───────────────────────────────────
  return (
    <div className={cn('relative', className)} ref={rootRef}>
      <Search className="w-4 h-4 text-ink/30 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type="text"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={INPUT_CLS}
        autoComplete="off"
      />
      {loading ? (
        <Loader2 className="w-4 h-4 text-forest absolute right-3 top-1/2 -translate-y-1/2 animate-spin" />
      ) : value ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink transition-colors"
          title="Keep current selection"
          aria-label="Close SKU search"
        >
          <X className="w-4 h-4" />
        </button>
      ) : null}

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-72 overflow-y-auto border border-hairline bg-alabaster/90 backdrop-blur-[20px]">
          {error ? (
            <div className="px-4 py-4 text-xs text-terracotta">{error}</div>
          ) : loading && results.length === 0 ? (
            <div className="px-4 py-6 text-center text-ink/40">
              <Loader2 className="w-5 h-5 mx-auto animate-spin" />
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-center text-ink/40">
              <PackageSearch className="w-6 h-6 mx-auto mb-2 opacity-40" />
              <p className="text-xs italic">
                {query.trim() ? 'No matching SKUs.' : 'Type to search SKUs…'}
              </p>
            </div>
          ) : (
            results.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => choose(s)}
                className="w-full text-left px-4 py-3 border-b border-hairline/50 last:border-b-0 hover:bg-forest/5 transition-colors"
              >
                <div className="text-sm font-bold text-ink">{s.skuCode}</div>
                <div className="text-[11px] text-ink/50 line-clamp-1">
                  {s.name || <span className="italic text-ink/30">No SKU name</span>}
                  {s.productName ? (
                    <span className="text-ink/35"> · {s.productName}</span>
                  ) : null}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
