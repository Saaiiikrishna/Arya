import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class names with Tailwind conflict resolution.
 * `cn('px-2', cond && 'px-4')` → later Tailwind utility wins.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
