'use client';

import { api } from './api';

/**
 * Lightweight page-view tracker.
 * Fires once per route change (debounced). Stores a sessionId in sessionStorage.
 * Silently fails — never blocks the UI.
 */

let initialized = false;

function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  let sid = sessionStorage.getItem('arya_session_id');
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem('arya_session_id', sid);
  }
  return sid;
}

function getApplicantInfo(): {
  applicantId?: string;
  applicantEmail?: string;
  applicantName?: string;
} {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('arya_admin');
    if (raw) {
      const admin = JSON.parse(raw);
      return {
        applicantId: admin.id,
        applicantEmail: admin.email,
        applicantName: `${admin.firstName || ''} ${admin.lastName || ''}`.trim() || undefined,
      };
    }
  } catch {
    // ignore
  }
  return {};
}

let lastTrackedPath = '';

export function trackCurrentPage() {
  if (typeof window === 'undefined') return;

  const path = window.location.pathname;

  // Debounce: don't re-track the same path
  if (path === lastTrackedPath) return;
  lastTrackedPath = path;

  const sessionId = getSessionId();
  const userInfo = getApplicantInfo();

  api.trackPageView({
    sessionId,
    path,
    referrer: document.referrer || undefined,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    language: navigator.language,
    ...userInfo,
  }).catch(() => {
    // Silently fail — tracking should never break the app
  });
}

/**
 * Initialize the tracker: listens for route changes.
 * Should be called once in the root layout.
 */
export function initTracker() {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  // Track initial page load
  trackCurrentPage();

  // Listen for client-side navigation (Next.js pushState)
  const originalPushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    originalPushState(...args);
    setTimeout(trackCurrentPage, 100);
  };

  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = (...args) => {
    originalReplaceState(...args);
    setTimeout(trackCurrentPage, 100);
  };

  window.addEventListener('popstate', () => {
    setTimeout(trackCurrentPage, 100);
  });
}
