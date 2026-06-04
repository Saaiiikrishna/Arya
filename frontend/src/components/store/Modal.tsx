'use client';

import { ReactNode, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Footer action row (buttons etc). */
  footer?: ReactNode;
  /**
   * Rounded marketing variant for public surfaces. Default false → strict 0px
   * matte admin dialog (DESIGN.md §1–6).
   */
  mkt?: boolean;
  /** Max-width class for the dialog panel. Default: 'max-w-lg'. */
  size?: string;
  /** Hide the default close (X) button. Default: false. */
  hideClose?: boolean;
  /** Disable closing on backdrop click / ESC (e.g. while submitting). */
  dismissible?: boolean;
  className?: string;
}

/**
 * Accessible modal dialog rendered through a portal with a blurred glass overlay.
 *
 * - Closes on ESC and backdrop click (unless `dismissible={false}`).
 * - Locks body scroll while open and restores focus to the previously-focused
 *   element on close.
 * - Admin (default): 0px corners, matte alabaster surface, hairline border.
 * - `mkt`: rounded `mkt-card` glass surface for the public storefront.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  mkt = false,
  size = 'max-w-lg',
  hideClose = false,
  dismissible = true,
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Capture the opener element BEFORE focus moves into the panel. This runs in a
  // layout effect (before paint, before the focus effect below) so the captured
  // element is the trigger that opened the dialog — not panelRef itself, which a
  // later `panelRef.current?.focus()` would otherwise become the active element.
  useLayoutEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose();
    };
    document.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog for keyboard users.
    panelRef.current?.focus();

    // Snapshot the element to restore so cleanup never restores focus to the
    // panel (which would be the case if we read previouslyFocused lazily).
    const toRestore = previouslyFocused.current;

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      toRestore?.focus?.();
    };
  }, [open, dismissible, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      {/* Backdrop — blurred glass overlay. */}
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[20px]"
        onClick={() => dismissible && onClose()}
        aria-hidden
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full outline-none',
          size,
          mkt
            ? 'mkt-card overflow-hidden p-0'
            : 'border border-hairline bg-alabaster',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || !hideClose) && (
          <div
            className={cn(
              'flex items-center justify-between gap-4 border-b border-hairline px-6 py-4',
              mkt && 'border-hairline/70',
            )}
          >
            {title ? (
              <h2
                id={titleId}
                className={cn(
                  'font-serif text-lg text-forest',
                  mkt ? 'font-medium' : 'font-medium',
                )}
              >
                {title}
              </h2>
            ) : (
              <span />
            )}
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="text-ink/50 transition-colors hover:text-terracotta"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        <div className="px-6 py-5">{children}</div>

        {footer && (
          <div
            className={cn(
              'flex items-center justify-end gap-3 border-t border-hairline px-6 py-4',
              mkt && 'border-hairline/70',
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
