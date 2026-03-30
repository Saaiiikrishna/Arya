'use client';

import { useEffect } from 'react';
import { initTracker } from '@/lib/tracker';

/**
 * Client component that initializes the page view tracker.
 * Renders nothing — pure side-effect component.
 */
export default function TrackerInit() {
  useEffect(() => {
    initTracker();
  }, []);

  return null;
}
