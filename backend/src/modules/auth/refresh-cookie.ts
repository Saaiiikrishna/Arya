import { ForbiddenException } from '@nestjs/common';
import type { Request, Response, CookieOptions } from 'express';
import type { ConfigService } from '@nestjs/config';

/**
 * Server-side refresh-token transport (Issue #3).
 *
 * The refresh token is delivered to browsers as an HttpOnly cookie so a stored
 * XSS payload cannot read it (it is invisible to `document.cookie`). The login/
 * refresh endpoints SET it; refresh/logout READ it; logout CLEARS it.
 *
 * Cross-origin note: the SPA (e.g. aryavartham.com / *.azurecontainerapps.io)
 * and the API are served from different hosts, so for the browser to send this
 * cookie on a cross-site XHR it must be `SameSite=None; Secure` in production.
 * In development (http://localhost) `Secure`+`None` cookies are dropped, so we
 * fall back to `SameSite=Lax` without `Secure`. CORS already runs with an
 * explicit origin allow-list + `credentials: true`, so the rotated token in the
 * response cannot be read by a foreign origin.
 *
 * A non-browser/API client may still pass the token in the request body; the
 * readers below prefer the cookie and fall back to the body for that case.
 *
 * The helpers are name-parameterized so the SEPARATE store-customer identity can
 * reuse the exact same transport with its own cookie (`arya_store_refresh`)
 * without the two ever colliding — both are `path=/api`, so both ride on every
 * API request, but each endpoint only ever reads its own.
 */
export const REFRESH_COOKIE = 'arya_refresh';

/** Cookie name for the store CUSTOMER identity (distinct from the platform one). */
export const STORE_REFRESH_COOKIE = 'arya_store_refresh';

/** Cookie path — scoped to the API so it never rides on static/asset requests. */
const COOKIE_PATH = '/api';

function parseExpirationMs(expStr: string): number {
  const value = parseInt(expStr, 10);
  const unit = expStr.slice(-1);
  if (unit === 'd') return value * 86_400_000;
  if (unit === 'h') return value * 3_600_000;
  if (unit === 'm') return value * 60_000;
  return value * 1_000;
}

function baseOptions(config: ConfigService): CookieOptions {
  const isProd = config.get<string>('NODE_ENV') === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: COOKIE_PATH,
  };
}

/** Set (or refresh) the HttpOnly refresh cookie with a fresh max-age. */
export function setRefreshCookie(
  res: Response,
  token: string,
  config: ConfigService,
  name: string = REFRESH_COOKIE,
): void {
  const expStr = config.get<string>('JWT_REFRESH_EXPIRATION', '7d');
  res.cookie(name, token, {
    ...baseOptions(config),
    maxAge: parseExpirationMs(expStr),
  });
}

/** Clear the refresh cookie (logout). Attributes must match how it was set. */
export function clearRefreshCookie(
  res: Response,
  config: ConfigService,
  name: string = REFRESH_COOKIE,
): void {
  res.clearCookie(name, baseOptions(config));
}

/**
 * Resolve the presented refresh token: prefer the HttpOnly cookie, fall back to
 * a body-supplied token for non-browser API clients. Returns undefined if absent.
 */
export function readRefreshToken(
  req: Request,
  bodyToken?: string,
  name: string = REFRESH_COOKIE,
): string | undefined {
  const cookieHeader = req.headers?.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      if (key === name) {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
  }
  return bodyToken && bodyToken.length > 0 ? bodyToken : undefined;
}

/**
 * The browser origins permitted to drive the SPA. SINGLE SOURCE OF TRUTH — both
 * the CORS allow-list (main.ts) and the CSRF origin check below read this, so a
 * legit origin can never pass one and fail the other.
 */
export function allowedOrigins(config: ConfigService): string[] {
  const frontendUrl = config.get<string>('FRONTEND_URL', 'http://localhost:3000');
  return [
    frontendUrl,
    'http://localhost:3000',
    'http://localhost:3005',
    'https://aryavartham.com',
    'https://www.aryavartham.com',
  ];
}

/**
 * CSRF defense for COOKIE-authenticated state-changing endpoints (refresh /
 * logout). Because the refresh cookie is `SameSite=None` in prod, the browser
 * attaches it on cross-site requests, so a forged cross-site POST could
 * otherwise force a logout (family revoke) or an unwanted rotation. CORS only
 * blocks the attacker from READING the response, not from sending the request.
 *
 * Reject when an `Origin` header is present and not in the allow-list. A browser
 * ALWAYS sends `Origin` on cross-origin requests and on cross-site form POSTs,
 * so an absent Origin cannot be a browser cross-site attack — it is a same-origin
 * call or a non-browser API client (which authenticates via the body token, not
 * the cookie). This adds no friction for the legitimate SPA (its Origin is
 * allow-listed) and requires no client cooperation.
 */
export function assertTrustedOrigin(req: Request, config: ConfigService): void {
  const header = req.headers?.origin;
  const origin = Array.isArray(header) ? header[0] : header;
  if (origin && !allowedOrigins(config).includes(origin)) {
    throw new ForbiddenException('Cross-origin request rejected');
  }
}
