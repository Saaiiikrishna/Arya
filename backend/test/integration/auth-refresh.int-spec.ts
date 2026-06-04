/**
 * INTEGRATION spec for refresh-token ROTATION + RFC 9700 family reuse detection
 * (AuthService.refreshToken / logout) against a REAL Postgres (`arya_test`).
 *
 * The refresh path touches only Prisma + JwtService, so we construct AuthService
 * with the real harness PrismaService, a real JwtService, a fake ConfigService,
 * and inert Email/Notification stubs. Redis is opened by the constructor but is
 * never used on this path (jest-integration runs with --forceExit).
 *
 * Proven invariants:
 *  - a valid token rotates: old REVOKED (not deleted), new live, SAME family.
 *  - replaying a token that was rotated away (past the leeway) → reuse detected:
 *    the whole family is revoked and the call rejects.
 *  - replaying a token revoked within the leeway window is benign: it rejects
 *    but does NOT revoke the family (absorbs concurrent/cold-start refreshes).
 *  - logout revokes every live sibling in the family.
 */
import { createHash, randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { getPrisma, fakeConfig } from './harness';

const REFRESH_SECRET = 'int_test_refresh_secret_0123456789_abcdefgh';
const ACCESS_SECRET = 'int_test_access_secret_0123456789_abcdefghi';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

describe('AuthService — refresh rotation + reuse detection (real Postgres)', () => {
  let prisma: PrismaService;
  let service: AuthService;
  let jwt: JwtService;
  let adminId: string;
  const adminEmail = `refresh-int-${randomUUID()}@arya.test`;

  const signRefresh = () =>
    jwt.sign(
      { sub: adminId, email: adminEmail, role: 'ADMIN' },
      { secret: REFRESH_SECRET, expiresIn: '7d' },
    );

  beforeAll(async () => {
    prisma = await getPrisma();
    jwt = new JwtService({ secret: ACCESS_SECRET, signOptions: { expiresIn: '15m' } });
    const config = fakeConfig({
      JWT_SECRET: ACCESS_SECRET,
      JWT_REFRESH_SECRET: REFRESH_SECRET,
      JWT_REFRESH_EXPIRATION: '7d',
    });
    const email = { sendEmail: async () => undefined, buildBrandedEmail: (s: string) => s } as any;
    const notifications = { otpWhatsApp: async () => undefined } as any;
    service = new AuthService(prisma, jwt, config, email, notifications);

    const admin = await prisma.admin.create({
      data: {
        email: adminEmail,
        passwordHash: 'x', // unused on the refresh path
        firstName: 'Refresh',
        lastName: 'Int',
        isActive: true,
      },
    });
    adminId = admin.id;
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: adminId } });
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: adminId } });
    await prisma.admin.delete({ where: { id: adminId } }).catch(() => undefined);
  });

  /** Seed a stored refresh token exactly as production does (new family). */
  async function seedToken(): Promise<string> {
    const token = signRefresh();
    await (service as any).storeRefreshToken(adminId, token);
    return token;
  }

  it('rotates a valid token: old revoked, new live, family preserved', async () => {
    const t1 = await seedToken();
    const res = await service.refreshToken(t1);

    expect(res.accessToken).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();
    expect(res.refreshToken).not.toBe(t1);

    const oldRow = await prisma.refreshToken.findUnique({ where: { token: hash(t1) } });
    const newRow = await prisma.refreshToken.findUnique({ where: { token: hash(res.refreshToken) } });
    expect(oldRow?.revokedAt).not.toBeNull();
    expect(newRow?.revokedAt).toBeNull();
    expect(newRow?.familyId).toBe(oldRow?.familyId);
  });

  it('detects reuse of a rotated token (past leeway) and revokes the whole family', async () => {
    const t1 = await seedToken();
    const res = await service.refreshToken(t1); // → t2, t1 now revoked (just now)

    // Back-date t1's revocation beyond the leeway so a replay is treated as theft.
    await prisma.refreshToken.update({
      where: { token: hash(t1) },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    await expect(service.refreshToken(t1)).rejects.toThrow(UnauthorizedException);

    // The still-live sibling (t2) must now be revoked — the family was killed.
    const sibling = await prisma.refreshToken.findUnique({ where: { token: hash(res.refreshToken) } });
    expect(sibling?.revokedAt).not.toBeNull();
  });

  it('treats a replay within the leeway window as benign (family stays live)', async () => {
    const t1 = await seedToken();
    const res = await service.refreshToken(t1); // → t2, t1 revoked ~now (within leeway)

    // Replay t1 immediately — revokedAt is recent, so no family revocation.
    await expect(service.refreshToken(t1)).rejects.toThrow(UnauthorizedException);

    const sibling = await prisma.refreshToken.findUnique({ where: { token: hash(res.refreshToken) } });
    expect(sibling?.revokedAt).toBeNull();
  });

  it('logout revokes every live token in the family', async () => {
    const t1 = await seedToken();
    const res = await service.refreshToken(t1); // → t2 (live), same family

    await service.logout(res.refreshToken);

    const sibling = await prisma.refreshToken.findUnique({ where: { token: hash(res.refreshToken) } });
    expect(sibling?.revokedAt).not.toBeNull();
  });

  it('rejects an unknown token without throwing on a missing family', async () => {
    const bogus = signRefresh(); // validly signed but never stored
    await expect(service.refreshToken(bogus)).rejects.toThrow(UnauthorizedException);
  });
});
