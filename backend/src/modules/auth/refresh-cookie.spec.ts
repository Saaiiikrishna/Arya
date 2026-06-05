import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { ConfigService } from '@nestjs/config';
import {
  REFRESH_COOKIE,
  STORE_REFRESH_COOKIE,
  readRefreshToken,
  allowedOrigins,
  assertTrustedOrigin,
} from './refresh-cookie';

// Minimal ConfigService stub.
const cfg = (values: Record<string, string> = {}): ConfigService =>
  ({ get: (k: string, d?: string) => values[k] ?? d } as unknown as ConfigService);

const reqWith = (headers: Record<string, string | undefined>): Request =>
  ({ headers } as unknown as Request);

describe('refresh-cookie — readRefreshToken', () => {
  it('reads the named cookie from the Cookie header', () => {
    const req = reqWith({ cookie: `foo=bar; ${REFRESH_COOKIE}=abc.def; baz=qux` });
    expect(readRefreshToken(req)).toBe('abc.def');
  });

  it('reads a DIFFERENT named cookie (store) without colliding with the platform one', () => {
    const req = reqWith({
      cookie: `${REFRESH_COOKIE}=platform; ${STORE_REFRESH_COOKIE}=store-tok`,
    });
    expect(readRefreshToken(req, undefined, STORE_REFRESH_COOKIE)).toBe('store-tok');
    expect(readRefreshToken(req)).toBe('platform');
  });

  it('url-decodes the cookie value', () => {
    const req = reqWith({ cookie: `${REFRESH_COOKIE}=a%2Bb%3Dc` });
    expect(readRefreshToken(req)).toBe('a+b=c');
  });

  it('falls back to the body token when no cookie is present (non-browser client)', () => {
    const req = reqWith({});
    expect(readRefreshToken(req, 'body-token')).toBe('body-token');
  });

  it('prefers the cookie over the body token', () => {
    const req = reqWith({ cookie: `${REFRESH_COOKIE}=cookie-tok` });
    expect(readRefreshToken(req, 'body-token')).toBe('cookie-tok');
  });

  it('returns undefined when neither cookie nor body token exists', () => {
    expect(readRefreshToken(reqWith({}), '')).toBeUndefined();
    expect(readRefreshToken(reqWith({}))).toBeUndefined();
  });
});

describe('refresh-cookie — assertTrustedOrigin (CSRF defense)', () => {
  const config = cfg({ FRONTEND_URL: 'https://app.example.com' });

  it('allows a request whose Origin is in the allow-list', () => {
    expect(() =>
      assertTrustedOrigin(reqWith({ origin: 'https://app.example.com' }), config),
    ).not.toThrow();
    expect(() =>
      assertTrustedOrigin(reqWith({ origin: 'https://aryavartham.com' }), config),
    ).not.toThrow();
  });

  it('allows a request with NO Origin header (same-origin / non-browser API client)', () => {
    expect(() => assertTrustedOrigin(reqWith({}), config)).not.toThrow();
  });

  it('rejects a forged cross-site Origin', () => {
    expect(() =>
      assertTrustedOrigin(reqWith({ origin: 'https://evil.example' }), config),
    ).toThrow(ForbiddenException);
  });

  it('includes the configured FRONTEND_URL in the allow-list', () => {
    expect(allowedOrigins(config)).toContain('https://app.example.com');
  });
});
