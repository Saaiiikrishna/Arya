/**
 * Resolve a stored media reference into a browser-loadable URL.
 *
 * The store/articles backend returns RAW S3 keys on its public read surfaces
 * (`Article.coverS3Key`, `ArticleMedia.s3Key`, etc.) rather than already-resolved
 * CDN/presigned URLs. The frontend therefore needs a single place that turns a
 * key into a `<img src>`-able URL. This is that place.
 *
 * Resolution order for a value:
 *   1. Falsy            → null (caller renders an empty/placeholder state).
 *   2. Already a URL    → returned verbatim (http(s):// or protocol-relative //,
 *                         and data:/blob: for previews). The backend MAY start
 *                         returning resolved URLs later; this stays correct.
 *   3. A bare S3 key    → prefixed with the configured public media base.
 *
 * The public media base is read from `NEXT_PUBLIC_MEDIA_BASE` when set (a CDN /
 * CloudFront origin, e.g. `https://cdn.aryavartham.com`). When it is NOT set we
 * fall back to the canonical virtual-hosted S3 origin for the project bucket
 * (`arya-documents` in `ap-south-1`, per the infra constraints) so images still
 * load in environments where the CDN var has not been wired yet. Configure
 * `NEXT_PUBLIC_MEDIA_BASE` in production to serve through the CDN.
 */

const RAW_MEDIA_BASE = process.env.NEXT_PUBLIC_MEDIA_BASE;

// Canonical fallback origin: virtual-hosted S3 URL for the project bucket.
const FALLBACK_MEDIA_BASE = 'https://arya-documents.s3.ap-south-1.amazonaws.com';

/** Trim a single trailing slash so we can always join with exactly one. */
function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

const MEDIA_BASE = trimTrailingSlash(
  (RAW_MEDIA_BASE && RAW_MEDIA_BASE.trim()) || FALLBACK_MEDIA_BASE,
);

/** True if the value already looks like a usable URL (no further prefixing). */
function isAbsoluteUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) ||
    value.startsWith('//') ||
    value.startsWith('data:') ||
    value.startsWith('blob:')
  );
}

/**
 * Resolve a single key-or-URL into a loadable URL, or null when absent.
 * Leading slashes on a bare key are stripped so the join never doubles up.
 */
export function resolveMediaUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (isAbsoluteUrl(trimmed)) return trimmed;
  const key = trimmed.replace(/^\/+/, '');
  return `${MEDIA_BASE}/${encodeURI(key)}`;
}

/**
 * Pick the first present media reference from a list of candidate fields and
 * resolve it. Useful when a payload may carry either a resolved URL field
 * (`coverUrl`) or a raw key field (`coverS3Key`), depending on the endpoint.
 */
export function resolveFirstMediaUrl(
  ...values: Array<string | null | undefined>
): string | null {
  for (const v of values) {
    const resolved = resolveMediaUrl(v);
    if (resolved) return resolved;
  }
  return null;
}
