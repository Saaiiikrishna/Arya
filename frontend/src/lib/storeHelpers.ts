/**
 * Shared defensive accessors + constants for the store / commerce surface.
 *
 * The cart-, order-, and tracking-item shapes returned by `storeApi` are
 * deliberately permissive (`Record<string, unknown>` with an open index — see
 * the public return shapes in `storeApi.ts`). Several pages need to pull a
 * named field off those bags with a small fallback chain (the backend has used
 * more than one key over time, e.g. `qty` vs `quantity`). These helpers were
 * duplicated verbatim in cart/page.tsx and orders/[id]/page.tsx; they live here
 * now so a single implementation is shared (CODE SMELL fix).
 */

/** Pull the first non-empty string field off a permissive item shape. */
export function str(
  obj: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/** Pull the first numeric field (coercing numeric strings) off a permissive item shape. */
export function num(
  obj: Record<string, unknown> | null | undefined,
  ...keys: string[]
): number | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

/**
 * sessionStorage key prefix for a guest's one-time order token.
 *
 * Written by /checkout right before opening Razorpay and read back by
 * /orders/[id] when the redirect query string is lost (refresh / bare-URL
 * paste). It MUST be identical on both sides — previously the literal was
 * duplicated in checkout/page.tsx and orders/[id]/page.tsx, so changing one
 * without the other silently broke guest order recovery (CODE SMELL fix).
 */
export const GUEST_ORDER_TOKEN_PREFIX = 'arya_order_token_';

/**
 * True only for `http(s)://` URLs. Used to gate untrusted, backend-supplied URLs
 * (courier tracking links, invoice download links) before they reach an anchor
 * `href` or `window.open()`. React does NOT strip `javascript:` / `data:` hrefs
 * from anchors, and `window.open('javascript:...')` executes — so any URL that
 * could originate from the backend / a MITM response must pass this check first.
 */
export function isSafeHttpUrl(u: string | null | undefined): u is string {
  return !!u && /^https?:\/\//i.test(u);
}
