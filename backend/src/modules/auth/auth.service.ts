import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import { randomInt, createHash, timingSafeEqual, randomUUID } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../../prisma';
import { EmailService } from '../email/email.service';
import { NotificationService } from '../notifications/notification.service';
import { LoginDto, CreateAdminDto } from './dto';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tokenId?: string; // For refresh token rotation tracking
  jti?: string; // Unique per-token id — guarantees every refresh token is distinct
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly redis: Redis;

  /**
   * Grace window (ms) during which presenting an already-rotated token is
   * treated as a benign concurrent/retried refresh rather than a replay. Keeps
   * multi-tab/cold-start double-refreshes from spuriously revoking the family,
   * while a genuine stolen-token replay (arriving well after rotation) still
   * trips reuse detection.
   */
  private static readonly REFRESH_REUSE_LEEWAY_MS = 10_000;

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

  async login(dto: LoginDto) {
    const admin = await this.prisma.admin.findUnique({
      where: { email: dto.email },
    });

    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
    };

    const refreshToken = this.signRefreshToken(payload);
    await this.storeRefreshToken(admin.id, refreshToken);

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken,
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
      },
    };
  }

  /** Investor email+password login → JWT with role INVESTOR (must be approved). */
  async investorLogin(email: string, password: string) {
    const normalizedEmail = (email || '').trim().toLowerCase();
    const investor = await this.prisma.investor.findUnique({ where: { email: normalizedEmail } });
    // Constant-ish failure: same error whether the investor is missing, has no
    // password set, or the password is wrong — avoids leaking which.
    if (!investor || !investor.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(password, investor.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (!investor.isApproved) {
      throw new UnauthorizedException('Your investor account is pending approval.');
    }

    const payload: JwtPayload = { sub: investor.id, email: investor.email, role: 'INVESTOR' };
    const refreshToken = this.signRefreshToken(payload);
    await this.storeRefreshToken(investor.id, refreshToken);

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken,
      investor: {
        id: investor.id,
        email: investor.email,
        firstName: investor.firstName,
        lastName: investor.lastName,
        firm: investor.firm,
        role: 'INVESTOR',
      },
    };
  }

  async googleLogin(token: string) {
    const client = new OAuth2Client(this.configService.get<string>('GOOGLE_CLIENT_ID'));

    // Only the external token verification is wrapped: it throws opaque,
    // low-level errors that we must not leak. Everything after runs outside
    // the catch so genuine failures (e.g. disabled account, DB errors) surface
    // as proper HttpExceptions instead of being masked.
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      });
      payload = ticket.getPayload();
    } catch (e) {
      this.logger.warn(`Google ID token verification failed: ${(e as any)?.message}`);
      throw new UnauthorizedException('Google Authentication Failed');
    }

    if (!payload || !payload.email) throw new UnauthorizedException('Invalid Google Token');
    // Reject unverified Google emails: an unverified address could belong to
    // someone else, so we must not auto-provision or log in against it.
    if (payload.email_verified !== true) {
      throw new UnauthorizedException('Google email is not verified');
    }

    const email = payload.email;
    const avatarUrl = payload.picture;
    let admin = await this.prisma.admin.findUnique({ where: { email } });

    if (admin) {
      if (!admin.isActive) throw new UnauthorizedException('Account is disabled');

      // Update avatar if changed
      if (avatarUrl && (admin as any).avatarUrl !== avatarUrl) {
        admin = await this.prisma.admin.update({
          where: { id: admin.id },
          data: { avatarUrl } as any,
        });
      }

      const jwtPayload: JwtPayload = { sub: (admin as any).id, email: (admin as any).email, role: (admin as any).role };
      const refreshToken = this.signRefreshToken(jwtPayload);
      await this.storeRefreshToken((admin as any).id, refreshToken);
      return {
        accessToken: this.jwtService.sign(jwtPayload),
        refreshToken,
        admin: {
          id: (admin as any).id,
          email: (admin as any).email,
          firstName: (admin as any).firstName,
          lastName: (admin as any).lastName,
          role: (admin as any).role,
          avatarUrl: (admin as any).avatarUrl
        },
      };
    }

    // If not admin, check/create Applicant
    let applicant = await this.prisma.applicant.findUnique({ where: { email } });
    if (!applicant) {
      const batch = await this.getOrCreateFillingBatch();
      applicant = await this.prisma.applicant.create({
        data: {
          email,
          firstName: payload.given_name || 'Founder',
          lastName: payload.family_name || '',
          accessToken: randomUUID(),
          batchId: (batch as any).id,
          avatarUrl,
        } as any
      });
    } else if (avatarUrl && (applicant as any).avatarUrl !== avatarUrl) {
      applicant = await this.prisma.applicant.update({
        where: { id: (applicant as any).id },
        data: { avatarUrl } as any,
      });
    }

    const jwtPayload: JwtPayload = { sub: (applicant as any).id, email: (applicant as any).email, role: 'APPLICANT' };
    const refreshToken = this.signRefreshToken(jwtPayload);
    await this.storeRefreshToken((applicant as any).id, refreshToken);
    return {
      accessToken: this.jwtService.sign(jwtPayload),
      refreshToken,
      admin: {
        id: (applicant as any).id,
        email: (applicant as any).email,
        firstName: (applicant as any).firstName,
        lastName: (applicant as any).lastName,
        role: 'APPLICANT',
        avatarUrl: (applicant as any).avatarUrl
      },
    };
  }

  async refreshToken(token: string) {
    // Verify the JWT signature first
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Look up the presented token. Three outcomes:
    //  - not found            → unknown/forged (or pruned) token → reject.
    //  - found, already revoked → a rotated token is being replayed (RFC 9700):
    //      the chain is compromised → revoke the whole family and reject. A
    //      small leeway absorbs benign concurrent/retried rotations (the loser
    //      of a race presents a just-revoked token) without nuking the family.
    //  - found, live, unexpired → legitimate → rotate within the family below.
    const stored = await this.prisma.refreshToken.findUnique({ where: { token: this.hashToken(token) } });
    if (!stored) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (stored.revokedAt) {
      const revokedAgoMs = Date.now() - stored.revokedAt.getTime();
      if (revokedAgoMs > AuthService.REFRESH_REUSE_LEEWAY_MS) {
        await this.revokeFamily(stored.familyId);
        this.logger.warn(
          `Refresh token reuse detected for user ${stored.userId}; revoked family ${stored.familyId}`,
        );
        throw new UnauthorizedException('Refresh token reuse detected. Please sign in again.');
      }
      // Within leeway: benign concurrent rotation — reject softly, family intact.
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    // Verify user is still active
    let newPayload: JwtPayload;
    if (payload.role === 'APPLICANT') {
      const applicant = await this.prisma.applicant.findUnique({ where: { id: payload.sub } });
      if (!applicant) throw new UnauthorizedException('User not found');
      newPayload = { sub: applicant.id, email: applicant.email, role: 'APPLICANT' };
    } else if (payload.role === 'MENTOR') {
      const mentor = await (this.prisma as any).mentor.findUnique({ where: { id: payload.sub } });
      if (!mentor || !mentor.isActive) throw new UnauthorizedException('Mentor not found or inactive');
      newPayload = { sub: mentor.id, email: mentor.email, role: 'MENTOR' };
    } else if (payload.role === 'COFOUNDER') {
      const cf = await (this.prisma as any).coFounder.findUnique({ where: { id: payload.sub } });
      if (!cf || !cf.isActive) throw new UnauthorizedException('Co-founder not found or inactive');
      newPayload = { sub: cf.id, email: cf.email, role: 'COFOUNDER' };
    } else if (payload.role === 'INVESTOR') {
      const investor = await this.prisma.investor.findUnique({ where: { id: payload.sub } });
      if (!investor || !investor.isApproved) throw new UnauthorizedException('Investor not found or not approved');
      newPayload = { sub: investor.id, email: investor.email, role: 'INVESTOR' };
    } else {
      const admin = await this.prisma.admin.findUnique({ where: { id: payload.sub } });
      if (!admin || !admin.isActive) throw new UnauthorizedException('User not found or inactive');
      newPayload = { sub: admin.id, email: admin.email, role: admin.role };
    }

    // Rotate atomically within the same family. The old token is REVOKED (not
    // deleted) so a later replay of it is still detectable as reuse. The CAS
    // (revokedAt: null guard) makes the revoke-then-issue race-safe: if a
    // concurrent refresh already consumed this token, our updateMany matches 0
    // rows and we abort the rotation instead of minting a second live sibling.
    const newRefresh = this.signRefreshToken(newPayload);
    const expStr = this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d');
    const expiresAt = new Date(Date.now() + this.parseExpirationMs(expStr));
    const rotated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (res.count !== 1) return false; // lost the rotation race
      await tx.refreshToken.create({
        data: {
          userId: newPayload.sub,
          familyId: stored.familyId,
          token: this.hashToken(newRefresh),
          expiresAt,
        },
      });
      return true;
    });
    if (!rotated) {
      // A concurrent refresh consumed this exact token first → benign race,
      // family intact (a genuine replay would arrive past the leeway window).
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return {
      accessToken: this.jwtService.sign(newPayload),
      refreshToken: newRefresh,
    };
  }

  /** Revoke every still-live token in a rotation family (reuse/logout). */
  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logout(token: string) {
    // Revoke the whole family so logging out kills every rotated sibling, not
    // just the token presented. Falls back to a by-hash revoke if the token
    // isn't on record (already pruned / never stored).
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: this.hashToken(token) },
      select: { familyId: true },
    });
    if (stored) {
      await this.revokeFamily(stored.familyId);
    } else {
      await this.prisma.refreshToken.updateMany({
        where: { token: this.hashToken(token) },
        data: { revokedAt: new Date() },
      });
    }
    return { success: true };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private signRefreshToken(payload: JwtPayload): string {
    // A unique jti makes every issued token distinct even when two are signed in
    // the same second with an identical payload — required now that rotated
    // tokens are RETAINED (revoked) for reuse detection and `token` is @unique.
    return this.jwtService.sign(
      { ...payload, jti: randomUUID() },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d') as any,
      },
    );
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
   * Persist a refresh token (hashed). `familyId` ties a rotation chain together
   * for RFC 9700 reuse detection — omit it on a fresh login to start a new
   * family; pass the existing family on rotation.
   */
  private async storeRefreshToken(
    userId: string,
    token: string,
    familyId?: string,
  ): Promise<void> {
    const expStr = this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d');
    const expiresAt = new Date(Date.now() + this.parseExpirationMs(expStr));
    await this.prisma.refreshToken.create({
      data: { userId, familyId: familyId ?? randomUUID(), token: this.hashToken(token), expiresAt },
    });
  }

  async createAdmin(dto: CreateAdminDto) {
    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const admin = await this.prisma.admin.create({
      data: {
        email: dto.email,
        passwordHash: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });

    return {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      role: admin.role,
    };
  }

  async validateUser(payload: JwtPayload) {
    if (payload.role === 'APPLICANT') {
      const applicant = await this.prisma.applicant.findUnique({ where: { id: payload.sub } });
      if (!applicant) throw new UnauthorizedException('Applicant not found');
      return { ...applicant, role: 'APPLICANT' };
    }

    if (payload.role === 'MENTOR') {
      const mentor = await (this.prisma as any).mentor.findUnique({ where: { id: payload.sub } });
      if (!mentor || !mentor.isActive) throw new UnauthorizedException('Mentor not found or inactive');
      return { ...mentor, role: 'MENTOR' };
    }

    if (payload.role === 'COFOUNDER') {
      const coFounder = await (this.prisma as any).coFounder.findUnique({ where: { id: payload.sub } });
      if (!coFounder || !coFounder.isActive) throw new UnauthorizedException('Co-founder not found or inactive');
      return { ...coFounder, role: 'COFOUNDER' };
    }

    if (payload.role === 'INVESTOR') {
      const investor = await this.prisma.investor.findUnique({ where: { id: payload.sub } });
      if (!investor || !investor.isApproved) throw new UnauthorizedException('Investor not found or not approved');
      return { ...investor, role: 'INVESTOR' };
    }

    const admin = await this.prisma.admin.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.isActive) throw new UnauthorizedException('Admin not found or inactive');
    return admin;
  }

  // ─── OTP Authentication ────────────────────────

  /**
   * Find the current FILLING batch or atomically create one. A
   * transaction-scoped advisory lock serializes concurrent sign-ups so two
   * requests can't mint duplicate batch numbers (the @unique would otherwise
   * crash one request with P2002).
   */
  private async getOrCreateFillingBatch(): Promise<{ id: string }> {
    const existing = await this.prisma.batch.findFirst({
      where: { status: 'FILLING' } as any,
      orderBy: { batchNumber: 'asc' },
    });
    if (existing) return existing as any;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aryavartham_batch_create'))`;
      const inLock = await tx.batch.findFirst({
        where: { status: 'FILLING' } as any,
        orderBy: { batchNumber: 'asc' },
      });
      if (inLock) return inLock as any;
      const lastBatch = await tx.batch.findFirst({ orderBy: { batchNumber: 'desc' } });
      // Fixed cohort rule: auto-created batches are always exactly 100 seats.
      return tx.batch.create({
        data: { batchNumber: ((lastBatch as any)?.batchNumber ?? 0) + 1, capacity: 100 } as any,
      }) as any;
    });
  }

  async sendOtp(email: string) {
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Valid email is required');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Generate cryptographically secure 6-digit OTP
    const otp = String(randomInt(100000, 1000000));

    // Store in Redis with 5 minute expiration (300 seconds)
    await this.redis.set(`otp:${normalizedEmail}`, otp, 'EX', 300);

    // Send OTP email via SES
    try {
      await this.emailService.sendEmail({
        to: normalizedEmail,
        subject: 'Your Aryavartham Login Code',
        htmlBody: this.emailService.buildBrandedEmail(`
          <p style="margin:0 0 16px;">Your verification code is:</p>
          <div style="text-align:center;padding:24px;margin:8px 0 20px;background:#133022;border-top:3px solid #E85D04;">
            <span style="font-family:'Courier New',monospace;font-size:32px;letter-spacing:8px;font-weight:bold;color:#FEF9F0;">${otp}</span>
          </div>
          <p style="margin:0;color:#6b573b;font-size:13px;">This code expires in 5 minutes. Do not share it with anyone.</p>
        `),
      });
    } catch (error) {
      this.logger.warn(`Failed to send OTP email to ${normalizedEmail}: ${(error as any)?.message}`);
    }

    // Also send the OTP over WhatsApp if we can resolve a phone for this email.
    // Best-effort: notifications.otpWhatsApp already swallows its own errors.
    try {
      const applicant = await this.prisma.applicant.findUnique({ where: { email: normalizedEmail } });
      if (applicant && (applicant as any).phone) {
        await this.notifications.otpWhatsApp((applicant as any).phone, otp);
      }
    } catch (error) {
      this.logger.warn(`Failed to send WhatsApp OTP to ${normalizedEmail}: ${(error as any)?.message}`);
    }

    // Expose the OTP only for the dedicated test account so the frontend
    // test-OTP display can render it; never leak it for real users.
    if (normalizedEmail === 'test@arya.com') {
      return { success: true, message: 'OTP sent to your email', otp };
    }

    return { success: true, message: 'OTP sent to your email' };
  }

  async verifyOtp(email: string, otp: string) {
    if (!email || !otp) {
      throw new BadRequestException('Email and OTP are required');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const storedOtp = await this.redis.get(`otp:${normalizedEmail}`);

    if (!storedOtp) {
      throw new UnauthorizedException('No OTP found for this email or it has expired. Please request a new one.');
    }

    // Constant-time comparison + bounded attempts to defeat brute force.
    const storedBuf = Buffer.from(storedOtp);
    const givenBuf = Buffer.from(otp ?? '');
    const matches =
      storedBuf.length === givenBuf.length && timingSafeEqual(storedBuf, givenBuf);
    if (!matches) {
      const attemptsKey = `otp_attempts:${normalizedEmail}`;
      const attempts = await this.redis.incr(attemptsKey);
      if (attempts === 1) await this.redis.expire(attemptsKey, 300);
      if (attempts >= 5) {
        // Burn the OTP after too many wrong guesses — forces a fresh request.
        await this.redis.del(`otp:${normalizedEmail}`);
        await this.redis.del(attemptsKey);
        throw new UnauthorizedException('Too many incorrect attempts. Please request a new code.');
      }
      throw new UnauthorizedException('Invalid OTP. Please try again.');
    }

    // OTP is valid - clear it and the attempt counter
    await this.redis.del(`otp:${normalizedEmail}`);
    await this.redis.del(`otp_attempts:${normalizedEmail}`);

    // Check if admin
    const admin = await this.prisma.admin.findUnique({ where: { email: normalizedEmail } });
    if (admin) {
      if (!admin.isActive) throw new UnauthorizedException('Account is disabled');
      const payload: JwtPayload = { sub: admin.id, email: admin.email, role: admin.role };
      const refreshToken = this.signRefreshToken(payload);
      await this.storeRefreshToken(admin.id, refreshToken);
      return {
        accessToken: this.jwtService.sign(payload),
        refreshToken,
        admin: {
          id: admin.id,
          email: admin.email,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: admin.role,
          avatarUrl: (admin as any).avatarUrl,
        },
      };
    }

    // Find or create applicant
    let applicant = await this.prisma.applicant.findUnique({ where: { email: normalizedEmail } });
    if (!applicant) {
      const batch = await this.getOrCreateFillingBatch();
      applicant = await this.prisma.applicant.create({
        data: {
          email: normalizedEmail,
          firstName: normalizedEmail.split('@')[0],
          lastName: '',
          accessToken: randomUUID(),
          batchId: (batch as any).id,
        } as any,
      });
    }

    const jwtPayload: JwtPayload = { sub: (applicant as any).id, email: (applicant as any).email, role: 'APPLICANT' };
    const refreshToken = this.signRefreshToken(jwtPayload);
    await this.storeRefreshToken((applicant as any).id, refreshToken);
    return {
      accessToken: this.jwtService.sign(jwtPayload),
      refreshToken,
      admin: {
        id: (applicant as any).id,
        email: (applicant as any).email,
        firstName: (applicant as any).firstName,
        lastName: (applicant as any).lastName,
        role: 'APPLICANT',
        avatarUrl: (applicant as any).avatarUrl,
      },
    };
  }
}
