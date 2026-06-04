import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';

/**
 * Mints opaque, unguessable guest tokens for carts and order access, and the
 * matching SHA-256 hashes that are stored at rest. The RAW token is returned to
 * the client exactly once (cart create / checkout); only the hash is persisted
 * (Cart.sessionTokenHash / Order.guestAccessTokenHash). Possession of the raw
 * token — not knowledge of the Cart.id/order number — authorizes guest access
 * (IDOR fix, Section 9 / 8.2).
 *
 * Tokens are signed JWTs (so they are self-describing + tamper-evident under
 * JWT_SECRET) carrying a high-entropy random nonce. The hashing helper is the
 * SAME SHA-256 scheme used by the platform auth.service.ts and the guest guards.
 *
 * REVOCATION MODEL (security): these guest tokens are NOT individually revocable
 * the way refresh tokens are — there is no per-token DB row to flip. Two controls
 * bound the blast radius instead:
 *   1. The authoritative state lives server-side, not in the token. A cart's
 *      `Cart.sessionTokenHash` is nulled on convert-guest (so a kept cart token
 *      stops working the moment the cart is claimed — see StoreAuthService), and
 *      `GuestCartGuard` additionally rejects any cart with a non-null customerId.
 *   2. TTLs are kept business-appropriate (cart 30d; order 30d) rather than the
 *      original 180d, shrinking the passive-eavesdrop window on order
 *      status/tracking/invoice for a leaked order token.
 * Rotating `JWT_SECRET` invalidates ALL outstanding guest tokens at once (every
 * signature becomes invalid) — this is the global kill switch after a leak, and
 * is documented in the deployment runbook.
 */
export interface GuestCartTokenResult {
  /** Raw signed token — return to client, NEVER persist. */
  token: string;
  /** SHA-256 hash — persist in Cart.sessionTokenHash. */
  hash: string;
}

export interface GuestOrderTokenResult {
  /** Raw signed token — return to client, NEVER persist. */
  token: string;
  /** SHA-256 hash — persist in Order.guestAccessTokenHash. */
  hash: string;
}

@Injectable()
export class GuestTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** SHA-256 hex digest — identical scheme to auth.service.ts hashToken(). */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Mint a guest cart session token. Long-lived (matches guest cart TTL); the
   * cart row itself carries the authoritative expiresAt that the guard checks.
   */
  mintCartToken(cartId: string): GuestCartTokenResult {
    const token = this.jwtService.sign(
      { typ: 'guest-cart', cartId, nonce: randomBytes(24).toString('hex') },
      {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: '30d',
      },
    );
    return { token, hash: this.hashToken(token) };
  }

  /**
   * Mint a guest order-access token. Lets a guest view their order, tracking and
   * invoice without an account. TTL bounded to 30d (was 180d): a leaked token
   * should not grant 6 months of passive read access to order/tracking/invoice.
   * After expiry a guest re-authenticates via the order-access OTP flow.
   */
  mintOrderToken(orderId: string): GuestOrderTokenResult {
    const token = this.jwtService.sign(
      { typ: 'guest-order', orderId, nonce: randomBytes(24).toString('hex') },
      {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: '30d',
      },
    );
    return { token, hash: this.hashToken(token) };
  }
}
