import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CartStatus, CustomerType, Prisma } from '@prisma/client';
import Redis from 'ioredis';
import axios from 'axios';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationService } from '../notifications/notification.service';
import { RegisterCustomerDto, CustomerLoginDto } from './dto';
import { CustomerJwtPayload, resolveCustomerSecret } from './customer.strategy';

const BCRYPT_ROUNDS = 12;
const OTP_TTL_SECONDS = 300; // 5 minutes, matching platform auth
const OTP_MAX_ATTEMPTS = 5;

// OAuth2 anti-CSRF `state` (RFC 6749 §10.12): an opaque, single-use nonce minted
// when the authorize URL is built, round-tripped through Discord, and required +
// consumed on the code-exchange call. Short-lived — the user completes the hop in
// seconds; 10 minutes covers a slow consent screen without a long replay window.
const DISCORD_STATE_TTL_SECONDS = 600;
const DISCORD_STATE_PREFIX = 'store_discord_state:';

// Discord OAuth2 endpoints (https://discord.com/developers/docs/topics/oauth2).
const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_USER_URL = 'https://discord.com/api/users/@me';
const DISCORD_SCOPE = 'identify email';
// SiteSettings key holding the channel webhook URL that newly-PUBLISHED articles
// are announced to. Absent/blank ⇒ Discord announcements are disabled (no-op).
const DISCORD_ARTICLE_WEBHOOK_SETTING_KEY = 'discordArticleWebhookUrl';
// SSRF allowlist: the webhook URL is admin-mutable config, so we hard-pin its
// destination host to Discord's official webhook domains. A poisoned setting
// pointing anywhere else (internal IPs, cloud metadata endpoints, attacker
// hosts) is rejected before any outbound request is made.
// Restricted to the two production hosts ONLY — canary.discord.com and
// ptb.discord.com (Discord's pre-release / public-test-build environments) are
// deliberately EXCLUDED: no legitimate deployment posts announcements there, and
// admitting them would silently widen the allowlist for a mistyped/canary URL. Add
// a host here only with a documented reason.
// IMPORTANT: the membership test MUST use strict Set.has() (exact host equality) —
// never .includes()/.endsWith()/substring matching, which are trivially bypassable
// (e.g. `discord.com.attacker.example`). See the check in postDiscordArticle().
const DISCORD_WEBHOOK_HOSTS = new Set<string>([
  'discord.com',
  'discordapp.com',
]);
// In-process TTL for the cached webhook URL. A 5-minute window bounds staleness
// after an admin updates the setting while eliminating a per-publish DB round-trip.
const DISCORD_WEBHOOK_CACHE_TTL_MS = 5 * 60_000;

@Injectable()
export class StoreAuthService implements OnModuleDestroy {
  private readonly logger = new Logger(StoreAuthService.name);
  private readonly redis: Redis;
  // In-process TTL cache for the Discord article webhook URL so a high-volume
  // publish stream does not hit the SiteSettings table on every announcement.
  // Holds the resolved value (string) OR an explicit null (disabled) so a
  // "feature is off" result is cached too, not re-queried each call.
  private discordWebhookCache: {
    value: string | null;
    expiresAt: number;
  } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly notifications: NotificationService,
  ) {
    // Dedicated ioredis connection owned by this service (OTP codes, OAuth `state`
    // nonces). Intentionally NOT shared with BullMQ's pool: BullMQ connections run
    // in blocking command modes (BRPOPLPUSH / blocking subscribers) that cannot be
    // safely multiplexed with the simple GET/SET/INCR/GETDEL traffic here, and a
    // separate client isolates auth-critical reads from queue back-pressure. The
    // socket is drained + closed in onModuleDestroy so it is not leaked on
    // shutdown. NOTE: each module that spins its own client adds to the Azure
    // Redis connection count (billed/bounded on port 6380) — if more modules need
    // raw Redis, promote this to a shared @Global() RedisModule rather than
    // copying this constructor.
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

  /**
   * Close the dedicated Redis connection on graceful shutdown so we do not leak a
   * socket on test teardown / rolling deploys. `quit()` drains in-flight commands;
   * swallow any error — we are shutting down regardless.
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      /* already closing / closed — nothing to do on shutdown */
    }
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
      expiresIn: this.configService.get<string>('JWT_EXPIRATION', '15m') as any,
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
    // New login → new rotation family (familyId carried forward on rotation).
    await client.refreshToken.create({
      data: { userId, familyId: randomUUID(), token: this.hashToken(token), expiresAt },
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
    // timingSafeEqual() throws if the two buffers differ in length, so the length
    // equality MUST be checked first. This `===` short-circuit can leak (via a
    // timing side-channel) whether the submitted code is the right LENGTH — but
    // that is not a secret here: the stored OTP is always exactly 6 digits
    // (requestOtp mints randomInt(100000, 1000000) ⇒ 6 chars), so the length is
    // public/fixed and reveals nothing about the digits. The VALUE comparison
    // stays constant-time via timingSafeEqual once lengths match. If the OTP
    // length ever becomes variable or secret, replace this with a fixed-length
    // padded-buffer compare so no length signal leaks.
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

    // Code consumed — clear it and the attempt counter BEFORE the customer
    // find/create/update + token issue below. This ordering is intentional: a
    // valid OTP is strictly single-use, so we burn it the instant it verifies. If
    // a later DB write fails (connection drop, schema mismatch, etc.) the OTP is
    // already gone and the user must request a FRESH code rather than being able
    // to replay the just-verified one. The trade-off (a rare transient DB error
    // surfaces to the user as "request a new code") is preferred over leaving a
    // verified-but-uncommitted OTP live for replay.
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

  // ─── Discord login (gated behind config) ─────────────────

  /** True only when the full Discord OAuth2 credential set is configured. */
  private discordConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('DISCORD_CLIENT_ID') &&
      this.configService.get<string>('DISCORD_CLIENT_SECRET') &&
      this.configService.get<string>('DISCORD_REDIRECT_URI'),
    );
  }

  /**
   * Build the Discord OAuth2 authorize URL the storefront redirects to. Returns
   * null when Discord is not configured so the caller (controller) can fail-clean
   * (404) and the frontend can hide the "Continue with Discord" button — mirroring
   * the existing config-gating pattern. Requests the minimal `identify email`
   * scope: we only need a verified email to find-or-create the Customer.
   *
   * CSRF (RFC 6749 §10.12): a cryptographically-random `state` nonce is minted and
   * persisted in Redis (short TTL, single-use) and embedded in the URL. Discord
   * round-trips it back to the callback; the frontend echoes it on the exchange,
   * where discordLogin() requires + consumes it. An attacker cannot forge a value
   * present in our Redis, so a victim cannot be lured into completing an
   * attacker-chosen code exchange. Async because it writes the nonce to Redis.
   */
  async getDiscordAuthUrl(): Promise<string | null> {
    if (!this.discordConfigured()) return null;
    // 16 random bytes (128 bits) hex-encoded — unguessable and never reused.
    const state = randomBytes(16).toString('hex');
    await this.redis.set(
      `${DISCORD_STATE_PREFIX}${state}`,
      '1',
      'EX',
      DISCORD_STATE_TTL_SECONDS,
    );
    const params = new URLSearchParams({
      client_id: this.configService.get<string>('DISCORD_CLIENT_ID')!,
      redirect_uri: this.configService.get<string>('DISCORD_REDIRECT_URI')!,
      response_type: 'code',
      scope: DISCORD_SCOPE,
      state,
    });
    return `${DISCORD_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchange a Discord OAuth2 authorization code for a CUSTOMER token pair.
   *
   * Flow: POST the code to Discord's token endpoint (client secret), then GET the
   * user with the returned access token. We require a VERIFIED email — an
   * unverified Discord address could belong to someone else, so we must never
   * auto-provision or log in against it (same rule as googleLogin). The Customer
   * is found-or-created BY EMAIL (no discordId column — NO migration in this
   * batch): an existing REGISTERED customer with that email is reused, otherwise a
   * new REGISTERED customer is created with an unusable password sentinel (so the
   * account can never be password-logged-in but works for OTP/Google/Discord).
   * Then the normal issue/sign path mints the pair.
   *
   * CSRF: `state` must match a nonce minted by getDiscordAuthUrl() and still live
   * in Redis. It is consumed (deleted) atomically here BEFORE the code exchange so
   * it is strictly single-use and a stolen/observed value cannot be replayed.
   */
  async discordLogin(code: string, state: string) {
    if (!this.discordConfigured()) {
      // Fail clean: Discord is not enabled on this deployment.
      throw new BadRequestException('Discord login is not configured');
    }
    const trimmed = (code || '').trim();
    if (!trimmed) {
      throw new BadRequestException('Authorization code is required');
    }

    // 0. Verify + consume the anti-CSRF state nonce BEFORE touching Discord.
    //    GETDEL is atomic (read-and-delete in one round-trip), so two concurrent
    //    exchanges presenting the same state cannot both pass — exactly one
    //    removes it, the other sees null and is rejected. A missing/expired/forged
    //    value yields null ⇒ reject.
    const trimmedState = (state || '').trim();
    if (!trimmedState) {
      throw new BadRequestException('Missing OAuth state parameter');
    }
    const consumed = await this.redis.getdel(
      `${DISCORD_STATE_PREFIX}${trimmedState}`,
    );
    if (!consumed) {
      throw new BadRequestException('Invalid or expired OAuth state');
    }

    // 1. Exchange the code for a Discord access token.
    let accessToken: string;
    try {
      const tokenRes = await axios.post(
        DISCORD_TOKEN_URL,
        new URLSearchParams({
          client_id: this.configService.get<string>('DISCORD_CLIENT_ID')!,
          client_secret: this.configService.get<string>(
            'DISCORD_CLIENT_SECRET',
          )!,
          grant_type: 'authorization_code',
          code: trimmed,
          redirect_uri: this.configService.get<string>('DISCORD_REDIRECT_URI')!,
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10_000,
        },
      );
      accessToken = tokenRes.data?.access_token;
    } catch (e: any) {
      this.logger.warn(
        `Discord token exchange failed: ${e?.response?.status ?? ''} ${e?.message}`,
      );
      throw new BadRequestException('Discord authentication failed');
    }
    if (!accessToken) {
      throw new BadRequestException('Discord authentication failed');
    }

    // 2. Fetch the Discord user (email + verified flag + name).
    let profile: {
      email?: string | null;
      verified?: boolean;
      username?: string | null;
      global_name?: string | null;
    };
    try {
      const userRes = await axios.get(DISCORD_USER_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10_000,
      });
      profile = userRes.data ?? {};
    } catch (e: any) {
      this.logger.warn(
        `Discord user fetch failed: ${e?.response?.status ?? ''} ${e?.message}`,
      );
      throw new BadRequestException('Discord authentication failed');
    }

    if (!profile.email) {
      throw new BadRequestException('Discord account has no email');
    }
    if (profile.verified !== true) {
      throw new BadRequestException('Discord email is not verified');
    }

    const email = profile.email.trim().toLowerCase();

    // 3. Find-or-create the Customer by email (NO discordId column).
    let customer = await this.prisma.customer.findFirst({
      where: { email, type: CustomerType.REGISTERED },
    });

    if (customer && !customer.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    if (!customer) {
      // Federated (Discord) signups have no user-chosen password, but the column
      // is NOT NULL and `login()` runs bcrypt.compare() against it. Store a REAL
      // bcrypt hash of a high-entropy random secret that is never persisted or
      // revealed anywhere, so password login is cryptographically unreachable for
      // this row while the value remains a valid bcrypt hash (no malformed-hash
      // edge cases in compare()). The 32 random bytes render to 64 hex chars —
      // comfortably under bcrypt's 72-byte input cap (bcrypt v6 silently
      // truncates beyond that), so the full secret is hashed. firstName is
      // best-effort from the Discord display name.
      const unusablePasswordHash = await bcrypt.hash(
        randomBytes(32).toString('hex'),
        BCRYPT_ROUNDS,
      );
      customer = await this.prisma.customer.create({
        data: {
          type: CustomerType.REGISTERED,
          email,
          emailVerified: true,
          passwordHash: unusablePasswordHash,
          firstName: profile.global_name ?? profile.username ?? null,
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

  // ─── Discord article announcement (webhook POSTER — gated) ─

  /**
   * Announce a newly-PUBLISHED article to a Discord channel via an incoming
   * webhook. The webhook URL is read at call time from the SiteSettings key
   * `discordArticleWebhookUrl` (runtime-configurable, no redeploy). Absent/blank
   * ⇒ this is a silent no-op (returns false), so the feature is fully gated by
   * config. Best-effort and NON-throwing: a webhook failure must never roll back
   * an article publish.
   *
   * WIRED: ArticlesService.approve() calls this fire-and-forget (void, never
   * awaited inside the publish CAS) immediately after an article transitions to
   * PUBLISHED — see backend/src/modules/articles/articles.service.ts. A webhook
   * failure can therefore never roll back or block a publish.
   *
   * @returns true if a webhook was posted, false if disabled/unconfigured or it failed.
   */
  async postDiscordArticle(article: {
    title: string;
    url?: string | null;
    excerpt?: string | null;
    coverUrl?: string | null;
  }): Promise<boolean> {
    let webhookUrl: string | null = null;
    // Read through a 5-minute in-process cache. The cached entry stores the
    // resolved value OR null (disabled), so a high-volume publish stream costs at
    // most one SiteSettings round-trip per TTL window instead of one per call.
    const now = Date.now();
    if (this.discordWebhookCache && this.discordWebhookCache.expiresAt > now) {
      webhookUrl = this.discordWebhookCache.value;
    } else {
      try {
        const setting = await this.prisma.siteSetting.findUnique({
          where: { key: DISCORD_ARTICLE_WEBHOOK_SETTING_KEY },
        });
        webhookUrl = setting?.value?.trim() || null;
        this.discordWebhookCache = {
          value: webhookUrl,
          expiresAt: now + DISCORD_WEBHOOK_CACHE_TTL_MS,
        };
      } catch (e: any) {
        this.logger.warn(
          `Discord webhook setting lookup failed: ${e?.message}`,
        );
        return false;
      }
    }

    // Disabled unless a valid https Discord webhook URL is configured.
    if (!webhookUrl) return false;
    let parsed: URL;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      this.logger.warn(
        'Discord article webhook URL is not a valid URL — skipping',
      );
      return false;
    }
    if (parsed.protocol !== 'https:') {
      this.logger.warn(
        'Discord article webhook URL must be https — skipping',
      );
      return false;
    }
    // SSRF guard: the webhook URL is sourced from a runtime-mutable SiteSettings
    // row, so a poisoned/typo'd value could otherwise point axios at an internal
    // host (cloud metadata, localhost services, …). Pin the destination to
    // Discord's own webhook hosts ONLY and require the canonical webhook path.
    // Anything else is logged and treated as disabled (no-op, non-throwing).
    // IMPORTANT: use strict Set.has() (exact host equality) — never .includes(),
    // .endsWith(), or substring matching, which would admit a bypass host such as
    // `discord.com.attacker.example` or `evildiscord.com`.
    if (
      !DISCORD_WEBHOOK_HOSTS.has(parsed.hostname.toLowerCase()) ||
      !parsed.pathname.startsWith('/api/webhooks/')
    ) {
      this.logger.warn(
        `Discord article webhook URL host/path not allowed (${parsed.hostname}) — skipping`,
      );
      return false;
    }

    const title = (article.title || 'New article').slice(0, 256);
    const description = (article.excerpt || '').slice(0, 2048) || undefined;
    const articleUrl = article.url?.trim() || undefined;

    // Discord embeds render a clean card. `username` overrides the webhook's
    // default name; `embeds[0].url` makes the title a link.
    const payload: Record<string, unknown> = {
      username: 'Aryavartham',
      embeds: [
        {
          title,
          ...(articleUrl ? { url: articleUrl } : {}),
          ...(description ? { description } : {}),
          color: 0x133022, // Forest Green (DESIGN.md primary)
          ...(article.coverUrl?.trim()
            ? { image: { url: article.coverUrl.trim() } }
            : {}),
        },
      ],
    };

    try {
      await axios.post(webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10_000,
      });
      return true;
    } catch (e: any) {
      this.logger.warn(
        `Discord article webhook POST failed: ${e?.response?.status ?? ''} ${e?.message}`,
      );
      return false;
    }
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
          familyId: stored.familyId, // keep the rotation family across the chain
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
