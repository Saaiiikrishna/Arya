/**
 * Integration spec for CouponService against a REAL Postgres (`arya_test`).
 *
 * These tests exercise the genuine concurrency + financial invariants that the
 * service was hardened for and that unit mocks cannot prove:
 *   1. TOTAL-LIMIT ATOMICITY  — the pg_advisory_xact_lock + CAS `usedCount` bump
 *      under usageLimit=1 admits EXACTLY ONE of N concurrent redeems.
 *   2. PER-CUSTOMER/EMAIL DEDUPE — perCustomerLimit keyed on the normalized
 *      redeemerEmail (NOT Customer.id) blocks a 2nd redeem by the same human even
 *      across distinct orders.
 *   3. validateCoupon discount math + the rejection gates (min order, expiry,
 *      non-ACTIVE status, guest-blocked).
 *
 * No DB mocks. The only thing stubbed would be external SDKs (S3/Razorpay/SES) —
 * CouponService touches none, so nothing is mocked here.
 */
import { randomUUID } from 'crypto';
import { CouponType, CouponStatus, CustomerType } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { getPrisma, truncateAll, closeAll } from './harness';
import { CouponService } from '../../src/modules/coupons/coupons.service';

let prisma: Awaited<ReturnType<typeof getPrisma>>;
let svc: CouponService;

beforeAll(async () => {
  prisma = await getPrisma();
  svc = new CouponService(prisma);
});

afterAll(async () => {
  await closeAll();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

// ──────────────────────────────────────────────────────────────────────────
//  Seed helpers — generate UUIDs app-side, money as integer paise, value as
//  the STORED integer the service expects (PERCENT = bps, FIXED = paise).
// ──────────────────────────────────────────────────────────────────────────

/** A minimal Coupon row. `value` is the stored integer (bps for PERCENT, paise for FIXED). */
async function seedCoupon(overrides: {
  code?: string;
  type?: CouponType;
  value?: number;
  maxDiscount?: number | null;
  minOrderValue?: number;
  status?: CouponStatus;
  usageLimit?: number | null;
  perCustomerLimit?: number;
  allowGuest?: boolean;
  startsAt?: Date | null;
  expiresAt?: Date | null;
} = {}) {
  return prisma.coupon.create({
    data: {
      id: randomUUID(),
      code: overrides.code ?? `SAVE${randomUUID().slice(0, 8).toUpperCase()}`,
      type: overrides.type ?? CouponType.PERCENT,
      value: overrides.value ?? 1000, // 10% (bps) by default
      maxDiscount: overrides.maxDiscount ?? null,
      minOrderValue: overrides.minOrderValue ?? 0,
      status: overrides.status ?? CouponStatus.ACTIVE,
      usageLimit: overrides.usageLimit ?? null,
      perCustomerLimit: overrides.perCustomerLimit ?? 1,
      allowGuest: overrides.allowGuest ?? false,
      startsAt: overrides.startsAt ?? null,
      expiresAt: overrides.expiresAt ?? null,
    },
  });
}

/** A Customer row (FK target for CouponRedemption.customerId, which is non-null). */
async function seedCustomer(
  type: CustomerType = CustomerType.REGISTERED,
  email?: string,
) {
  return prisma.customer.create({
    data: {
      id: randomUUID(),
      type,
      email: email ?? null,
      emailVerified: type === CustomerType.REGISTERED,
    },
  });
}

/**
 * An Order row (FK target for CouponRedemption.orderId, which is non-null AND
 * @unique). Only the non-defaulted, non-nullable columns must be supplied:
 * orderNumber (unique), customerId, billingAddress + shippingAddress (Json).
 */
async function seedOrder(customerId: string) {
  const addr = {
    fullName: 'Test Buyer',
    line1: '1 Test Rd',
    city: 'Bengaluru',
    stateCode: 'KA',
    postalCode: '560001',
    country: 'IN',
  };
  return prisma.order.create({
    data: {
      id: randomUUID(),
      orderNumber: `AS-${randomUUID().slice(0, 12).toUpperCase()}`,
      customerId,
      billingAddress: addr,
      shippingAddress: addr,
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────
//  (1) TOTAL-LIMIT ATOMICITY
// ──────────────────────────────────────────────────────────────────────────

describe('redeemCoupon — total-limit atomicity (usageLimit=1, concurrent)', () => {
  it('admits exactly ONE of three concurrent redeems and leaves usedCount=1', async () => {
    const coupon = await seedCoupon({
      type: CouponType.FIXED,
      value: 5000, // ₹50 in paise
      usageLimit: 1,
      perCustomerLimit: 1,
      allowGuest: true,
    });

    // Three DISTINCT customers + orders + emails so the ONLY contended resource
    // is the coupon's single total slot (not the per-email dedupe).
    const attempts = await Promise.all(
      [0, 1, 2].map(async (i) => {
        const customer = await seedCustomer(
          CustomerType.REGISTERED,
          `buyer${i}@example.com`,
        );
        const order = await seedOrder(customer.id);
        return { customer, order, email: `buyer${i}@example.com` };
      }),
    );

    // Fire all three redeems concurrently, each inside its own real $transaction
    // (this is exactly how checkout calls it). The advisory xact lock + CAS bump
    // must serialize them so only one wins the single slot.
    const results = await Promise.allSettled(
      attempts.map((a) =>
        prisma.$transaction((tx) =>
          svc.redeemCoupon(tx, {
            couponId: coupon.id,
            orderId: a.order.id,
            discountPaise: 5000,
            customerId: a.customer.id,
            email: a.email,
          }),
        ),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    // Losers fail on the CAS guard (capacity) — surfaced as ConflictException.
    for (const r of rejected as PromiseRejectedResult[]) {
      expect(r.reason).toBeInstanceOf(ConflictException);
    }

    const after = await prisma.coupon.findUnique({ where: { id: coupon.id } });
    expect(after?.usedCount).toBe(1);

    const redemptionCount = await prisma.couponRedemption.count({
      where: { couponId: coupon.id },
    });
    expect(redemptionCount).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  (2) PER-CUSTOMER / EMAIL DEDUPE
// ──────────────────────────────────────────────────────────────────────────

describe('redeemCoupon — per-customer dedupe keyed on normalized email', () => {
  it('rejects a 2nd redeem by the same email (distinct orders) when perCustomerLimit=1', async () => {
    const coupon = await seedCoupon({
      type: CouponType.FIXED,
      value: 10000, // ₹100
      usageLimit: null, // unlimited total — isolate the per-email cap
      perCustomerLimit: 1,
      allowGuest: true,
    });

    // Same human, same normalized email, but two SEPARATE orders (orderId is
    // @unique so we cannot reuse one). The dedupe must key on redeemerEmail.
    const customer = await seedCustomer(CustomerType.REGISTERED, 'Repeat@Example.com');
    const order1 = await seedOrder(customer.id);
    const order2 = await seedOrder(customer.id);

    // 1st redeem with a mixed-case email — service normalizes to lowercase.
    await prisma.$transaction((tx) =>
      svc.redeemCoupon(tx, {
        couponId: coupon.id,
        orderId: order1.id,
        discountPaise: 10000,
        customerId: customer.id,
        email: 'Repeat@Example.com',
      }),
    );

    // 2nd redeem with the SAME email in different casing/whitespace — must reject.
    await expect(
      prisma.$transaction((tx) =>
        svc.redeemCoupon(tx, {
          couponId: coupon.id,
          orderId: order2.id,
          discountPaise: 10000,
          customerId: customer.id,
          email: '  repeat@example.com ',
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    // Exactly one redemption row persisted; the stored email is normalized.
    const rows = await prisma.couponRedemption.findMany({
      where: { couponId: coupon.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].redeemerEmail).toBe('repeat@example.com');
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  (3) validateCoupon — discount math + rejection gates
// ──────────────────────────────────────────────────────────────────────────

describe('validateCoupon — discount math', () => {
  it('PERCENT discount is capped by maxDiscount', async () => {
    // 20% (2000 bps) of ₹1000 = ₹200, but capped at ₹150 → discount = 15000 paise.
    const coupon = await seedCoupon({
      type: CouponType.PERCENT,
      value: 2000,
      maxDiscount: 15000, // ₹150 cap
      allowGuest: true,
    });

    const res = await svc.validateCoupon(
      coupon.code,
      { isGuest: false, customerId: randomUUID() },
      100000, // ₹1000 subtotal
    );
    expect(res.discountPaise).toBe(15000);
    expect(res.couponId).toBe(coupon.id);
    expect(res.code).toBe(coupon.code);
  });

  it('PERCENT discount below the cap is the rounded percentage', async () => {
    // 18% (1800 bps) of ₹100 (10000 paise) = 1800 paise, under a ₹50 cap.
    const coupon = await seedCoupon({
      type: CouponType.PERCENT,
      value: 1800,
      maxDiscount: 5000,
      allowGuest: true,
    });
    const res = await svc.validateCoupon(coupon.code, { isGuest: true }, 10000);
    expect(res.discountPaise).toBe(1800);
  });

  it('FIXED discount = min(value, subtotal)', async () => {
    const coupon = await seedCoupon({
      type: CouponType.FIXED,
      value: 30000, // ₹300 off
      allowGuest: true,
    });

    // Subtotal ₹500 ⇒ full ₹300 off.
    const big = await svc.validateCoupon(coupon.code, { isGuest: true }, 50000);
    expect(big.discountPaise).toBe(30000);

    // Subtotal ₹200 (< value) ⇒ discount clamps to the subtotal, never negative total.
    const small = await svc.validateCoupon(coupon.code, { isGuest: true }, 20000);
    expect(small.discountPaise).toBe(20000);
  });

  it('rejects when subtotal is below minOrderValue', async () => {
    const coupon = await seedCoupon({
      type: CouponType.FIXED,
      value: 5000,
      minOrderValue: 50000, // ₹500 minimum
      allowGuest: true,
    });
    await expect(
      svc.validateCoupon(coupon.code, { isGuest: true }, 49999),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired coupon (expiresAt in the past)', async () => {
    const coupon = await seedCoupon({
      type: CouponType.FIXED,
      value: 5000,
      allowGuest: true,
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
    });
    await expect(
      svc.validateCoupon(coupon.code, { isGuest: true }, 100000),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-ACTIVE (DISABLED) coupon', async () => {
    // The schema enum is ACTIVE | DISABLED | EXPIRED (no PAUSED). DISABLED is the
    // "paused" state — validate rejects anything that is not ACTIVE.
    const coupon = await seedCoupon({
      type: CouponType.FIXED,
      value: 5000,
      status: CouponStatus.DISABLED,
      allowGuest: true,
    });
    await expect(
      svc.validateCoupon(coupon.code, { isGuest: true }, 100000),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks a guest when allowGuest=false', async () => {
    const coupon = await seedCoupon({
      type: CouponType.FIXED,
      value: 5000,
      allowGuest: false,
    });
    await expect(
      svc.validateCoupon(coupon.code, { isGuest: true }, 100000),
    ).rejects.toBeInstanceOf(BadRequestException);

    // …but a registered (non-guest) context is allowed.
    const ok = await svc.validateCoupon(
      coupon.code,
      { isGuest: false, customerId: randomUUID() },
      100000,
    );
    expect(ok.discountPaise).toBe(5000);
  });
});
