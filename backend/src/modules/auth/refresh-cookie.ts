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
 */
export const REFRESH_COOKIE = 'arya_refresh';

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
export function setRefreshCookie(res: Response, token: string, config: ConfigService): void {
  const expStr = config.get<string>('JWT_REFRESH_EXPIRATION', '7d');
  res.cookie(REFRESH_COOKIE, token, {
    ...baseOptions(config),
    maxAge: parseExpirationMs(expStr),
  });
}

/** Clear the refresh cookie (logout). Attributes must match how it was set. */
export function clearRefreshCookie(res: Response, config: ConfigService): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions(config));
}

/**
 * Resolve the presented refresh token: prefer the HttpOnly cookie, fall back to
 * a body-supplied token for non-browser API clients. Returns undefined if absent.
 */
export function readRefreshToken(req: Request, bodyToken?: string): string | undefined {
  const cookieHeader = req.headers?.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      if (key === REFRESH_COOKIE) {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
  }
  return bodyToken && bodyToken.length > 0 ? bodyToken : undefined;
}
