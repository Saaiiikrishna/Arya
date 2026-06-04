import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CartStatus, CustomerType, Prisma } from '@prisma/client';
import Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationService } from '../notifications/notification.service';
import { RegisterCustomerDto, CustomerLoginDto } from './dto';
import {
  CustomerJwtPayload,
  resolveCustomerSecret,
} from './customer.strategy';

const BCRYPT_ROUNDS = 12;
const OTP_TTL_SECONDS = 300; // 5 minutes, matching platform auth
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class StoreAuthService {
  private readonly logger = new Logger(StoreAuthService.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly notifications: NotificationService,
  ) {
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const useTls = String(port) === '6380';
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port,
      ...(password ? { password } : {}),
      ...(useTls ? { tls: {} } : {}),
    });
  }

  // ─── Token helpers (SHA-256 — same scheme as platform auth.service.ts) ───

  /** SHA-256 hex digest. Refresh TOKENS are SHA-256 (NOT bcrypt) to match the
   *  existing platform scheme — passwords stay bcrypt; these are different. */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private signAccessToken(payload: CustomerJwtPayload): string {
    // Sign with the DEDICATED customer secret (JWT_CUSTOMER_SECRET, JWT_SECRET
    // fallback) — the SAME secret CustomerStrategy + the inline dual-auth
    // verifiers use to verify, and the same one the module's JwtModule is
    // configured with. Passed explicitly (not relying on the JwtModule default)
    // so this stays correct even if the module wiring changes. A platform token
    // signed with JWT_SECRET is rejected on every customer verify path.
    return this.jwtService.sign(payload, {
      secret: resolveCustomerSecret(this.configService),
      expiresIn: this.configService.get<string>(
        'JWT_EXPIRATION',
        '15m',
      ) as any,
    });
  }

  private signRefreshToken(payload: CustomerJwtPayload): string {
    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>(
        'JWT_REFRESH_EXPIRATION',
        '7d',
      ) as any,
    });
  }

  private parseExpirationMs(expStr: string): number {
    const value = parseInt(expStr, 10);
    const unit = expStr.slice(-1);
    if (unit === 'd') return value * 86_400_000;
    if (unit === 'h') return value * 3_600_000;
    if (unit === 'm') return value * 60_000;
    return value * 1_000;
  }

  /**
   * Persist the SHA-256 hash of a freshly minted refresh token. Accepts an
   * optional transaction client so a caller that creates the Customer row and
   * issues tokens inside one $transaction can pass `tx` through and keep both
   * writes atomic (no window where a customer exists with no valid token).
   */
  private async storeRefreshToken(
    userId: string,
    token: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const expStr = this.configService.get<string>(
      'JWT_REFRESH_EXPIRATION',
      '7d',
    );
    const expiresAt = new Date(Date.now() + this.parseExpirationMs(expStr));
    const client = tx ?? this.prisma;
    await client.refreshToken.create({
      data: { userId, token: this.hashToken(token), expiresAt },
    });
  }

  private async issueTokens(
    customer: { id: string; email: string | null },
    tx?: Prisma.TransactionClient,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: CustomerJwtPayload = {
      sub: customer.id,
      email: customer.email,
      role: 'CUSTOMER',
    };
    const accessToken = this.signAccessToken(payload);
    const refreshToken = this.signRefreshToken(payload);
    await this.storeRefreshToken(customer.id, refreshToken, tx);
    return { accessToken, refreshToken };
  }

  private publicCustomer(customer: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    type: string;
    emailVerified: boolean;
  }) {
    return {
      id: customer.id,
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      type: customer.type,
      emailVerified: customer.emailVerified,
      role: 'CUSTOMER' as const,
    };
  }

  // ─── Register ────────────────────────────────────────────

  /**
   * Register a REGISTERED customer (email + password + name). Password is bcrypt.
   * Email uniqueness for REGISTERED customers is enforced by a partial-unique
   * index in the migration; we also pre-check to return a friendly 409 and to
   * defeat the race we catch the unique violation below.
   */
  async register(dto: RegisterCustomerDto) {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.customer.findFirst({
      where: { email, type: CustomerType.REGISTERED },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    let customer;
    try {
      customer = await this.prisma.customer.create({
        data: {
          type: CustomerType.REGISTERED,
          email,
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName?.trim() ?? null,
        },
      });
    } catch (e: any) {
      // P2002 = unique constraint (partial-unique email for REGISTERED) lost the race.
      if (e?.code === 'P2002') {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
      throw e;
    }

    const tokens = await this.issueTokens(customer);
    return { ...tokens, customer: this.publicCustomer(customer) };
  }

  // ─── Login (Razorpay-only platform: email + password) ────

  async login(dto: CustomerLoginDto) {
    const email = dto.email.trim().toLowerCase();
    const customer = await this.prisma.customer.findFirst({
      where: { email, type: CustomerType.REGISTERED },
    });

    // Uniform failure whether the customer is missing, has no password, is
    // inactive, or the password is wrong — avoids account enumeration.
    if (!customer || !customer.passwordHash || !customer.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(dto.password, customer.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(customer);
    return { ...tokens, customer: this.publicCustomer(customer) };
  }

  // ─── OTP login (Section 4.4: request-otp / verify-otp) ────

  /**
   * Issue a one-time login code for a customer email. Best-effort delivery over
   * email (+ WhatsApp if a phone is on file). Always returns a generic success
   * so the endpoint never reveals whether an account exists (no enumeration).
   * A REGISTERED Customer row is provisioned lazily on first successful verify,
   * not here, so requesting a code can never create accounts.
   */
  async requestOtp(rawEmail: string) {
    const email = (rawEmail || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Valid email is required');
    }

    const otp = String(randomInt(100000, 1000000));
    await this.redis.set(`store_otp:${email}`, otp, 'EX', OTP_TTL_SECONDS);

    try {
      await this.emailService.sendEmail({
        to: email,
        subject: 'Your Aryavartham Store Login Code',
        htmlBody: this.emailService.buildBrandedEmail(`
          <p style="margin:0 0 16px;">Your store verification code is:</p>
          <div style="text-align:center;padding:24px;margin:8px 0 20px;background:#133022;border-top:3px solid #E85D04;">
            <span style="font-family:'Courier New',monospace;font-size:32px;letter-spacing:8px;font-weight:bold;color:#FEF9F0;">${otp}</span>
          </div>
          <p style="margin:0;color:#6b573b;font-size:13px;">This code expires in 5 minutes. Do not share it with anyone.</p>
        `),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send store OTP email to ${email}: ${error?.message}`,
      );
    }

    // Best-effort WhatsApp delivery if we already know a phone for this customer.
    try {
      const customer = await this.prisma.customer.findFirst({
        where: { email, type: CustomerType.REGISTERED },
      });
      if (customer?.phone) {
        await this.notifications.otpWhatsApp(customer.phone, otp);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to send store WhatsApp OTP to ${email}: ${error?.message}`,
      );
    }

    return {
      success: true,
      message: 'If an account can receive it, a code has been sent.',
    };
  }

  /**
   * Verify a one-time code → CUSTOMER token pair. On the first successful verify
   * for an email with no REGISTERED Customer row, one is provisioned (passwordless,
   * email-verified). Constant-time compare + bounded attempts defeat brute force.
   */
  async verifyOtp(rawEmail: string, otp: string) {
    const email = (rawEmail || '').trim().toLowerCase();
    if (!email || !otp) {
      throw new BadRequestException('Email and OTP are required');
    }

    const stored = await this.redis.get(`store_otp:${email}`);
    if (!stored) {
      throw new UnauthorizedException(
        'No code found for this email or it has expired. Please request a new one.',
      );
    }

    const storedBuf = Buffer.from(stored);
    const givenBuf = Buffer.from(otp);
    const matches =
      storedBuf.length === givenBuf.length &&
      timingSafeEqual(storedBuf, givenBuf);
    if (!matches) {
      const attemptsKey = `store_otp_attempts:${email}`;
      const attempts = await this.redis.incr(attemptsKey);
      if (attempts === 1) await this.redis.expire(attemptsKey, OTP_TTL_SECONDS);
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await this.redis.del(`store_otp:${email}`);
        await this.redis.del(attemptsKey);
        throw new UnauthorizedException(
          'Too many incorrect attempts. Please request a new code.',
        );
      }
      throw new UnauthorizedException('Invalid code. Please try again.');
    }

    // Code consumed — clear it and the attempt counter before issuing tokens.
    await this.redis.del(`store_otp:${email}`);
    await this.redis.del(`store_otp_attempts:${email}`);

    let customer = await this.prisma.customer.findFirst({
      where: { email, type: CustomerType.REGISTERED },
    });
    if (customer && !customer.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          type: CustomerType.REGISTERED,
          email,
          emailVerified: true,
        },
      });
    } else if (!customer.emailVerified) {
      customer = await this.prisma.customer.update({
        where: { id: customer.id },
        data: { emailVerified: true },
      });
    }

    const tokens = await this.issueTokens(customer);
    return { ...tokens, customer: this.publicCustomer(customer) };
  }

  // ─── Google login (Section 4.4) ──────────────────────────

  /**
   * Exchange a verified Google ID token for a CUSTOMER token pair. Mirrors the
   * platform googleLogin(): only the external verification is wrapped so genuine
   * downstream failures surface as proper HttpExceptions, not opaque 401s.
   */
  async googleLogin(token: string) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const client = new OAuth2Client(clientId);

    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch (e) {
      this.logger.warn(
        `Google ID token verification failed (store): ${e?.message}`,
      );
      throw new UnauthorizedException('Google Authentication Failed');
    }

    if (!payload || !payload.email) {
      throw new UnauthorizedException('Invalid Google Token');
    }
    // Reject unverified Google emails: an unverified address could belong to
    // someone else, so we must not auto-provision or log in against it.
    if (payload.email_verified !== true) {
      throw new UnauthorizedException('Google email is not verified');
    }

    const email = payload.email.trim().toLowerCase();
    let customer = await this.prisma.customer.findFirst({
      where: { email, type: CustomerType.REGISTERED },
    });

    if (customer && !customer.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          type: CustomerType.REGISTERED,
          email,
          emailVerified: true,
          firstName: payload.given_name ?? null,
          lastName: payload.family_name ?? null,
        },
      });
    } else if (!customer.emailVerified) {
      customer = await this.prisma.customer.update({
        where: { id: customer.id },
        data: { emailVerified: true },
      });
    }

    const tokens = await this.issueTokens(customer);
    return { ...tokens, customer: this.publicCustomer(customer) };
  }

  // ─── Refresh (OWN customer path — validates Customer, rotates) ────

  /**
   * Customer-specific refresh. Does NOT call the platform refreshToken()
   * dispatcher (whose else-branch resolves Admin). Verifies the refresh JWT,
   * confirms it carries role CUSTOMER, confirms the hashed token is present and
   * not revoked/expired in the shared RefreshToken table, re-validates the
   * Customer is active, then rotates: revoke old + issue a fresh pair.
   */
  async refresh(rawToken: string) {
    let payload: CustomerJwtPayload;
    try {
      payload = this.jwtService.verify<CustomerJwtPayload>(rawToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.role !== 'CUSTOMER') {
      // A non-customer refresh token must use the platform refresh endpoint.
      throw new UnauthorizedException('Invalid refresh token');
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: this.hashToken(rawToken) },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: payload.sub },
    });
    // A guest row must never carry a JWT; reject defensively. Keep the caller
    // message generic (no existence/type disclosure) but log the real reason for
    // incident forensics.
    if (
      !customer ||
      !customer.isActive ||
      customer.type !== CustomerType.REGISTERED
    ) {
      this.logger.warn(
        `Refresh rejected for customer ${payload.sub}: ${
          !customer
            ? 'not found'
            : !customer.isActive
              ? 'inactive'
              : 'non-REGISTERED type'
        }`,
      );
      throw new UnauthorizedException('Customer not found or inactive');
    }

    // Rotate atomically: delete the consumed token, mint + store a new one.
    const newPayload: CustomerJwtPayload = {
      sub: customer.id,
      email: customer.email,
      role: 'CUSTOMER',
    };
    const newRefresh = this.signRefreshToken(newPayload);
    const expStr = this.configService.get<string>(
      'JWT_REFRESH_EXPIRATION',
      '7d',
    );
    const expiresAt = new Date(Date.now() + this.parseExpirationMs(expStr));

    await this.prisma.$transaction([
      this.prisma.refreshToken.delete({ where: { id: stored.id } }),
      this.prisma.refreshToken.create({
        data: {
          userId: customer.id,
          token: this.hashToken(newRefresh),
          expiresAt,
        },
      }),
    ]);

    return {
      accessToken: this.signAccessToken(newPayload),
      refreshToken: newRefresh,
    };
  }

  // ─── Logout ──────────────────────────────────────────────

  async logout(rawToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { token: this.hashToken(rawToken) },
      data: { revokedAt: new Date() },
    });
    // Idempotent: succeeds whether or not the token existed, to avoid acting as
    // a presence oracle. Abuse is bounded by the route's strict rate limit.
    return { success: true };
  }

  // ─── Convert guest (Section 4.4 / 8.2: merge guest cart on first login) ───

  /**
   * Claim a guest cart for the authenticated customer and merge its items into
   * the customer's ACTIVE cart. Identity is the JWT-resolved customerId — never
   * a body field. The guest cart is located by the SHA-256 hash of its raw
   * session token (knowing a Cart.id is never sufficient — IDOR rule). On claim
   * the guest cart's sessionTokenHash is cleared and its status set to CONVERTED
   * so the now customer-owned cart can no longer be reached via a guest token.
   */
  async convertGuest(customerId: string, rawCartToken: string) {
    const hash = this.hashToken(rawCartToken);

    return this.prisma.$transaction(async (tx) => {
      // Two distinct critical sections must be serialized here:
      //   1. concurrent claims of the SAME guest cart (two customers presenting
      //      the same guest token) — keyed on the guest cart identity (the
      //      SHA-256 session-token hash). Without this, both could read the cart
      //      as unclaimed and each claim/merge it.
      //   2. concurrent merges into the SAME customer cart — keyed on customerId,
      //      to keep item dedup race-free.
      // Both advisory locks are taken in the SAME tx before reading the cart.
      // Acquire them in a deterministic (sorted) order so two callers that touch
      // the same pair of keys can never deadlock by grabbing them in opposite
      // orders. hashtext(key) maps each stable string key into the 32-bit
      // advisory-lock space (same idiom as the rest of the codebase).
      const guestCartLockKey = 'store_cart_guest_' + hash;
      const customerMergeLockKey = 'store_cart_merge_' + customerId;
      const [firstLockKey, secondLockKey] = [
        guestCartLockKey,
        customerMergeLockKey,
      ].sort();
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${firstLockKey}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${secondLockKey}))`;

      const customer = await tx.customer.findUnique({
        where: { id: customerId },
      });
      if (
        !customer ||
        !customer.isActive ||
        customer.type !== CustomerType.REGISTERED
      ) {
        throw new UnauthorizedException('Customer not found or inactive');
      }

      // This read happens UNDER the guest-cart-identity lock, so it is the
      // re-read of ownership a concurrent claimer of the same token races on.
      // A claimer that committed first nulled sessionTokenHash (both the
      // claim-in-place and the merge path do), so this lookup returns null for
      // the loser, which then aborts below — no double claim/merge.
      const guestCart = await tx.cart.findUnique({
        where: { sessionTokenHash: hash },
        include: { items: true },
      });
      if (!guestCart) {
        throw new NotFoundException('Guest cart not found');
      }
      if (guestCart.status !== CartStatus.ACTIVE) {
        throw new ConflictException('Guest cart is no longer active');
      }
      // Already owned by someone — must not be re-claimable via a guest token.
      // Defensive net for the under-lock re-read in case a path ever leaves the
      // hash set while assigning an owner.
      if (guestCart.customerId && guestCart.customerId !== customerId) {
        throw new ConflictException('Guest cart already claimed');
      }

      // Find (or adopt) the customer's destination ACTIVE cart.
      const targetCart = await tx.cart.findFirst({
        where: { customerId, status: CartStatus.ACTIVE },
        include: { items: true },
      });

      // No existing customer cart: simply claim the guest cart in place.
      if (!targetCart) {
        const claimed = await tx.cart.update({
          where: { id: guestCart.id },
          data: { customerId, sessionTokenHash: null },
          include: { items: true },
        });
        return {
          cartId: claimed.id,
          merged: false,
          itemCount: claimed.items.length,
        };
      }

      // Merge guest items into the existing customer cart: same SKU → sum qty,
      // new SKU → move the line over. @@unique([cartId, skuId]) keeps lines deduped.
      const existingBySku = new Map(targetCart.items.map((i) => [i.skuId, i]));
      for (const item of guestCart.items) {
        const existing = existingBySku.get(item.skuId);
        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + item.quantity },
          });
        } else {
          await tx.cartItem.update({
            where: { id: item.id },
            data: { cartId: targetCart.id },
          });
        }
      }

      // Retire the emptied guest cart so its token can never reauthorize it.
      await tx.cart.update({
        where: { id: guestCart.id },
        data: { status: CartStatus.CONVERTED, sessionTokenHash: null },
      });

      const refreshed = await tx.cartItem.count({
        where: { cartId: targetCart.id },
      });
      return { cartId: targetCart.id, merged: true, itemCount: refreshed };
    });
  }

  // ─── Me ──────────────────────────────────────────────────

  async me(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer || !customer.isActive) {
      throw new NotFoundException('Customer not found');
    }
    return this.publicCustomer(customer);
  }
}
