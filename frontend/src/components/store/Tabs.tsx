'use client';

import { ReactNode, useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem {
  key: string;
  label: ReactNode;
  content: ReactNode;
  /** Optionally disable a tab. */
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  /** Controlled active tab key. */
  activeKey: string;
  onChange: (key: string) => void;
  /** Rounded marketing styling (public surfaces). Default: false (strict/matte). */
  mkt?: boolean;
  className?: string;
  /** Class for the tab-list (header) row. */
  listClassName?: string;
  /** Class for the panel wrapper. */
  panelClassName?: string;
}

/**
 * Controlled tab strip + panel. Fully prop-driven: the parent owns `activeKey`
 * and updates it via `onChange`. Renders only the active tab's content.
 *
 * Matte variant uses 0px borders + a forest underline (DESIGN.md). The `mkt`
 * variant uses a rounded pill highlight for public marketing surfaces.
 */
export default function Tabs({
  tabs,
  activeKey,
  onChange,
  mkt = false,
  className,
  listClassName,
  panelClassName,
}: TabsProps) {
  const baseId = useId();
  const matched = tabs.find((t) => t.key === activeKey);
  // Fallback to the first tab when `activeKey` is stale (e.g. its tab was
  // removed). We render the fallback immediately AND notify the parent so its
  // controlled `activeKey` does not stay permanently desynchronised from what is
  // displayed.
  const active = matched ?? tabs[0];

  useEffect(() => {
    if (!matched && active && active.key !== activeKey) {
      onChange(active.key);
    }
  }, [matched, active, activeKey, onChange]);

  // Roving tabindex + arrow-key navigation per the ARIA tabs authoring pattern.
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const focusTab = (key: string) => {
    onChange(key);
    // Focus after the controlled re-render commits.
    requestAnimationFrame(() => tabRefs.current[key]?.focus());
  };

  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const enabled = tabs.filter((t) => !t.disabled);
    if (enabled.length === 0) return;
    const currentIdx = enabled.findIndex((t) => t.key === active?.key);
    let nextIdx = currentIdx;
    if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = enabled.length - 1;
    if (nextIdx !== currentIdx) {
      e.preventDefault();
      focusTab(enabled[nextIdx].key);
    }
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-orientation="horizontal"
        className={cn(
          mkt
            ? 'inline-flex gap-1 rounded-full border border-hairline bg-white/60 p-1 backdrop-blur'
            : 'flex gap-6 border-b border-hairline',
          listClassName,
        )}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === active?.key;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[tab.key] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${tab.key}`}
              disabled={tab.disabled}
              tabIndex={isActive ? 0 : -1}
              onKeyDown={onTabKeyDown}
              onClick={() => !tab.disabled && onChange(tab.key)}
              className={cn(
                'font-sans text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors',
                tab.disabled && 'cursor-not-allowed opacity-40',
                mkt
                  ? cn(
                      'rounded-full px-4 py-2',
                      isActive
                        ? 'bg-forest text-parchment'
                        : 'text-ink/60 hover:text-saffron-deep',
                    )
                  : cn(
                      '-mb-px border-b-2 pb-3 pt-1',
                      isActive
                        ? 'border-forest text-forest'
                        : 'border-transparent text-ink/55 hover:text-terracotta-warm',
                    ),
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {active && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${active.key}`}
          aria-labelledby={`${baseId}-tab-${active.key}`}
          className={cn(mkt ? 'pt-6' : 'pt-5', panelClassName)}
        >
          {active.content}
        </div>
      )}
    </div>
  );
}
