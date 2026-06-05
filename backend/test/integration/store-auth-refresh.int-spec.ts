/**
 * INTEGRATION spec for STORE-CUSTOMER refresh-token rotation + RFC 9700 family
 * reuse detection (StoreAuthService.refresh / logout) against a REAL Postgres
 * (`arya_test`). Mirrors auth-refresh.int-spec.ts for the separate customer
 * identity (own `jwt-customer` secret, cookie `arya_store_refresh`).
 *
 * The refresh path touches only Prisma + JwtService; StoreAuthService is built
 * with the harness PrismaService, a real JwtService, a fake ConfigService, and
 * inert Email/Notification stubs. Redis is opened by the constructor but unused
 * on this path (closed in afterAll; jest-integration runs with --forceExit).
 *
 * Proven invariants:
 *  - a valid token rotates: old REVOKED (not deleted), new live, SAME family.
 *  - replaying a rotated token past the leeway → reuse detected → family revoked.
 *  - replaying within the leeway is benign (family stays live).
 *  - logout revokes every live sibling in the family.
 *  - an unknown token rejects without throwing on a missing family.
 */
import { createHash } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { StoreAuthService } from '../../src/modules/store-auth/store-auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { getPrisma, fakeConfig } from './harness';

const CUSTOMER_SECRET = 'int_test_customer_secret_0123456789_abcdefg';
const REFRESH_SECRET = 'int_test_store_refresh_secret_0123456789_abc';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

describe('StoreAuthService — customer refresh rotation + reuse detection (real Postgres)', () => {
  let prisma: PrismaService;
  let service: StoreAuthService;
  let customerId: string;
  let customerEmail: string;

  const seedToken = async (): Promise<string> => {
    const { refreshToken } = await (service as any).issueTokens({
      id: customerId,
      email: customerEmail,
    });
    return refreshToken as string;
  };

  beforeAll(async () => {
    prisma = await getPrisma();
    const jwt = new JwtService({ secret: 'unused-default-explicit-secrets-used' });
    const config = fakeConfig({
      JWT_CUSTOMER_SECRET: CUSTOMER_SECRET,
      JWT_SECRET: CUSTOMER_SECRET,
      JWT_REFRESH_SECRET: REFRESH_SECRET,
      JWT_REFRESH_EXPIRATION: '7d',
      JWT_EXPIRATION: '15m',
    });
    const email = { sendEmail: async () => undefined, buildBrandedEmail: (s: string) => s } as any;
    const notifications = { otpWhatsApp: async () => undefined } as any;
    service = new StoreAuthService(prisma, jwt, config, email, notifications);

    const customer = await prisma.customer.create({
      data: { type: 'REGISTERED', email: `store-refresh-int-${hash(REFRESH_SECRET).slice(0, 8)}@arya.test`, isActive: true },
    });
    customerId = customer.id;
    customerEmail = customer.email!;
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: customerId } });
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: customerId } });
    await prisma.customer.delete({ where: { id: customerId } }).catch(() => undefined);
    await service.onModuleDestroy().catch(() => undefined);
  });

  it('rotates a valid token: old revoked, new live, family preserved', async () => {
    const t1 = await seedToken();
    const res = await service.refresh(t1);

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
    const res = await service.refresh(t1); // → t2, t1 revoked (just now)

    await prisma.refreshToken.update({
      where: { token: hash(t1) },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    await expect(service.refresh(t1)).rejects.toThrow(UnauthorizedException);

    const sibling = await prisma.refreshToken.findUnique({ where: { token: hash(res.refreshToken) } });
    expect(sibling?.revokedAt).not.toBeNull();
  });

  it('treats a replay within the leeway window as benign (family stays live)', async () => {
    const t1 = await seedToken();
    const res = await service.refresh(t1); // → t2, t1 revoked ~now (within leeway)

    await expect(service.refresh(t1)).rejects.toThrow(UnauthorizedException);

    const sibling = await prisma.refreshToken.findUnique({ where: { token: hash(res.refreshToken) } });
    expect(sibling?.revokedAt).toBeNull();
  });

  it('logout revokes every live token in the family', async () => {
    const t1 = await seedToken();
    const res = await service.refresh(t1); // → t2 (live), same family

    await service.logout(res.refreshToken);

    const sibling = await prisma.refreshToken.findUnique({ where: { token: hash(res.refreshToken) } });
    expect(sibling?.revokedAt).not.toBeNull();
  });

  it('rejects an unknown token without throwing on a missing family', async () => {
    // A validly-signed CUSTOMER refresh JWT that was never stored.
    const jwt = new JwtService({ secret: 'x' });
    const bogus = jwt.sign(
      { sub: customerId, email: customerEmail, role: 'CUSTOMER' },
      { secret: REFRESH_SECRET, expiresIn: '7d' },
    );
    await expect(service.refresh(bogus)).rejects.toThrow(UnauthorizedException);
  });
});
