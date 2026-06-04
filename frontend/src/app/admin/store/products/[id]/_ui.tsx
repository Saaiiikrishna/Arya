'use client';

import { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Strict-DESIGN.md form primitives shared across the product-editor tabs.
 * 0px radius, hairline borders, forest focus, uppercase labels — no shadows.
 */

export function Label({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <label className="block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold">
      {children}
      {required && <span className="text-terracotta"> *</span>}
    </label>
  );
}

export const inputCls =
  'w-full border border-hairline px-4 py-3 text-sm focus:outline-none focus:border-forest bg-white';
export const inputClsSm =
  'w-full border border-hairline px-3 py-2 text-sm focus:outline-none focus:border-forest bg-white';

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-center gap-2 border border-terracotta/40 bg-terracotta/5 px-3 py-2 text-xs text-terracotta">
      <AlertCircle className="w-4 h-4 shrink-0" />
      {message}
    </div>
  );
}

export function PrimaryBtn({
  children,
  onClick,
  disabled,
  type = 'button',
  form,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  form?: string;
}) {
  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled}
      className="px-6 py-3 bg-saffron text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-saffron-deep disabled:opacity-50 transition-colors"
    >
      {children}
    </button>
  );
}

export function SecondaryBtn({
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="px-6 py-3 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment disabled:opacity-50 transition-colors"
    >
      {children}
    </button>
  );
}

export function GhostBtn({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 disabled:opacity-50 transition-colors"
    >
      {children}
    </button>
  );
}

export function SectionCard({
  title,
  action,
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border border-hairline bg-white p-6">
      {(title || action) && (
        <div className="flex items-center justify-between mb-5">
          {title && <h3 className="font-serif text-lg font-bold">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/** Convert a rupee string/number to integer paise; null on empty. */
export function rupeesToPaise(v: string | number | null | undefined): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

/** Convert integer paise to a rupee string suitable for a number input. */
export function paiseToRupees(p: number | null | undefined): string {
  if (p === null || p === undefined) return '';
  return String(p / 100);
}
