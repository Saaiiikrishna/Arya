/**
 * INTEGRATION spec for ReviewsService against a REAL Postgres (`arya_test`).
 *
 * ReviewsService's only collaborator is PrismaService — it touches no
 * S3/Razorpay/SES SDK (the per-IP Redis gate was replaced by a true per-customer
 * `review_helpful_votes` junction), so NOTHING is mocked here. Every invariant is
 * exercised against genuine Postgres so the concurrency guarantees the service was
 * hardened for (the moderate advisory lock + the @@unique-backed helpful dedupe)
 * are actually proven, not stubbed.
 *
 * Invariants asserted:
 *  (1) submit creates a PENDING review and sets isVerifiedPurchase=true ONLY when a
 *      DELIVERED order from this customer contains the product (Sku→Product live
 *      relation); the matched order is linked via orderId.
 *  (2) one-per-customer: a 2nd submit by the SAME customer on the SAME product
 *      collides on @@unique([productId,customerId]) → ConflictException (409).
 *  (3) admin moderate APPROVE moves the aggregate by EXACTLY the review's rating
 *      (Product.ratingSum += rating, ratingCount += 1).
 *  (4) CONCURRENT double-approve of the SAME review increments the aggregate
 *      EXACTLY once (idempotent under the per-product advisory lock).
 *  (5) helpful per-user dedupe: 3 concurrent helpful votes by the SAME customer on
 *      one review → helpfulCount === 1 and exactly ONE ReviewHelpfulVote row.
 */
import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import {
  CustomerType,
  OrderPaymentStatus,
  OrderStatus,
  ReviewStatus,
} from '@prisma/client';
import { getPrisma, truncateAll, closeAll } from './harness';
import { ReviewsService } from '../../src/modules/reviews/reviews.service';
import type { CreateReviewDto } from '../../src/modules/reviews/dto';

let prisma: Awaited<ReturnType<typeof getPrisma>>;
let svc: ReviewsService;

beforeAll(async () => {
  prisma = await getPrisma();
  // ReviewsService's sole dependency is PrismaService (no Config/Redis/SDKs).
  svc = new ReviewsService(prisma);
});

afterAll(async () => {
  await closeAll();
});

beforeEach(async () => {
  await truncateAll(prisma);
  // Pool-settle barrier: a trivial round-trip hands back a healthy pooled
  // connection at the start of every test (mirrors the other int-specs), so any
  // connection churn from a prior concurrent-transaction test cannot surface as a
  // transient error in this test's first query.
  await prisma.$queryRaw`SELECT 1`;
});

// ──────────────────────────────────────────────────────────────────────────
//  Seed helpers — UUIDs app-side, money integer paise.
// ──────────────────────────────────────────────────────────────────────────

/** A Product (DRAFT default is fine — submit/moderate never gate on status). */
async function seedProduct(): Promise<string> {
  const id = randomUUID();
  await prisma.product.create({
    data: { id, slug: `prod-${id}`, name: 'Test Product' },
  });
  return id;
}

/** A Sku for the product (needed so an OrderItem can reference Sku→Product). */
async function seedSku(productId: string): Promise<string> {
  const id = randomUUID();
  await prisma.sku.create({
    data: {
      id,
      productId,
      skuCode: `SKU-${id}`,
      name: 'Test SKU',
      basePrice: 100000, // integer paise (₹1000)
    },
  });
  return id;
}

/** A REGISTERED Customer (verified-purchase + helpful-vote author). */
async function seedCustomer(idx: number): Promise<string> {
  const id = randomUUID();
  await prisma.customer.create({
    data: {
      id,
      type: CustomerType.REGISTERED,
      email: `buyer${idx}-${id}@example.com`,
      firstName: `Buyer${idx}`,
      lastName: 'Test',
      emailVerified: true,
    },
  });
  return id;
}

/**
 * A DELIVERED order for `customerId` containing `skuId` (so submitReview's
 * verified-purchase probe — a DELIVERED order whose items reference the product
 * via the live Sku relation — matches). Returns the order id.
 */
async function seedDeliveredOrder(
  customerId: string,
  skuId: string,
): Promise<string> {
  const addr = {
    fullName: 'Test Buyer',
    line1: '1 Test Rd',
    city: 'Bengaluru',
    stateCode: '29',
    postalCode: '560001',
    country: 'IN',
  };
  const order = await prisma.order.create({
    data: {
      id: randomUUID(),
      orderNumber: `AO-${randomUUID().slice(0, 12).toUpperCase()}`,
      customerId,
      status: OrderStatus.DELIVERED,
      paymentStatus: OrderPaymentStatus.PAID,
      grandTotal: 118000,
      billingAddress: addr,
      shippingAddress: addr,
      deliveredAt: new Date(),
      items: {
        create: {
          id: randomUUID(),
          skuId,
          skuCodeSnapshot: `SKU-${skuId}`,
          nameSnapshot: 'Test Widget',
          quantity: 1,
          unitPrice: 100000,
          lineSubtotal: 100000,
          taxableValue: 100000,
          lineTotal: 118000,
        },
      },
    },
  });
  return order.id;
}

const dto = (overrides: Partial<CreateReviewDto> = {}): CreateReviewDto => ({
  rating: overrides.rating ?? 4,
  title: overrides.title,
  body: overrides.body ?? 'Solid build quality, would buy again.',
});

describe('ReviewsService (integration, real Postgres)', () => {
  it('(1) submit creates a PENDING review; isVerifiedPurchase=true only with a DELIVERED order containing the product', async () => {
    const productId = await seedProduct();
    const skuId = await seedSku(productId);

    // ── Customer A: HAS a DELIVERED order with the product → verified.
    const customerA = await seedCustomer(1);
    const orderId = await seedDeliveredOrder(customerA, skuId);

    const verified = await svc.submitReview(productId, customerA, dto({ rating: 5 }));
    expect(verified.status).toBe(ReviewStatus.PENDING);
    expect(verified.isVerifiedPurchase).toBe(true);
    expect(verified.orderId).toBe(orderId); // matched order linked for provenance
    expect(verified.rating).toBe(5);

    // ── Customer B: NO delivered order → unverified, orderId null.
    const customerB = await seedCustomer(2);
    const unverified = await svc.submitReview(productId, customerB, dto({ rating: 3 }));
    expect(unverified.status).toBe(ReviewStatus.PENDING);
    expect(unverified.isVerifiedPurchase).toBe(false);
    expect(unverified.orderId).toBeNull();

    // Submitting a PENDING review must NOT touch the denormalized aggregate.
    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product?.ratingSum).toBe(0);
    expect(product?.ratingCount).toBe(0);
  });

  it('(2) one review per customer per product → 2nd submit is a 409 ConflictException', async () => {
    const productId = await seedProduct();
    const customerId = await seedCustomer(1);

    await svc.submitReview(productId, customerId, dto({ rating: 4 }));

    await expect(
      svc.submitReview(productId, customerId, dto({ rating: 2 })),
    ).rejects.toBeInstanceOf(ConflictException);

    // Exactly one review row persisted for the (product, customer) pair.
    const count = await prisma.review.count({
      where: { productId, customerId },
    });
    expect(count).toBe(1);
  });

  it('(3) admin moderate APPROVE bumps Product.ratingSum/ratingCount by exactly the rating', async () => {
    const productId = await seedProduct();
    const customerId = await seedCustomer(1);
    const review = await svc.submitReview(productId, customerId, dto({ rating: 4 }));

    const approved = await svc.moderateReview(review.id, ReviewStatus.APPROVED);
    expect(approved.status).toBe(ReviewStatus.APPROVED);

    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product?.ratingSum).toBe(4); // += rating
    expect(product?.ratingCount).toBe(1); // += 1
  });

  it('(4) CONCURRENT double-approve of the SAME review increments the aggregate EXACTLY once (idempotent under advisory lock)', async () => {
    const productId = await seedProduct();
    const customerId = await seedCustomer(1);
    const review = await svc.submitReview(productId, customerId, dto({ rating: 5 }));

    // Two concurrent approvals of the SAME PENDING review. The per-product advisory
    // lock (pg_advisory_xact_lock(hashtext('product_rating_'+id))) SERIALIZES them:
    // the winner runs its transaction to completion first; the loser then acquires
    // the lock, re-reads status === APPROVED, and takes the idempotent early-return
    // (no second increment). Note these are serialized, not truly simultaneous — the
    // loser reaches the early-return AFTER the winner commits, which is exactly the
    // behaviour this test proves (idempotency under contention), not a same-instant
    // race of two in-flight transactions.
    const results = await Promise.allSettled([
      svc.moderateReview(review.id, ReviewStatus.APPROVED),
      svc.moderateReview(review.id, ReviewStatus.APPROVED),
    ]);

    // Both calls SUCCEED (idempotent), neither throws.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    for (const r of results) {
      if (r.status === 'fulfilled') {
        expect(r.value.status).toBe(ReviewStatus.APPROVED);
      }
    }

    // The aggregate moved by the rating EXACTLY once despite two approvals.
    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product?.ratingSum).toBe(5);
    expect(product?.ratingCount).toBe(1);

    // The review itself is APPROVED (single row).
    const fresh = await prisma.review.findUnique({ where: { id: review.id } });
    expect(fresh?.status).toBe(ReviewStatus.APPROVED);
  });

  it('(5) helpful per-user dedupe: 3 concurrent votes by the SAME customer → helpfulCount===1 and exactly one ReviewHelpfulVote row', async () => {
    const productId = await seedProduct();
    const authorId = await seedCustomer(1);
    const review = await svc.submitReview(productId, authorId, dto({ rating: 5 }));
    // Helpful votes only count on an APPROVED review.
    await svc.moderateReview(review.id, ReviewStatus.APPROVED);

    // A DIFFERENT customer casts THREE concurrent helpful votes on the one review.
    // The @@unique([reviewId, customerId]) backing review_helpful_votes means only
    // the first insert wins; the other two collide on P2002 and are swallowed
    // idempotently (return the current count, no second increment).
    const voter = await seedCustomer(2);
    const results = await Promise.allSettled([
      svc.markHelpful(review.id, voter),
      svc.markHelpful(review.id, voter),
      svc.markHelpful(review.id, voter),
    ]);

    // None of the three throws (the duplicates are idempotent 200s).
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // helpfulCount incremented EXACTLY once.
    const fresh = await prisma.review.findUnique({ where: { id: review.id } });
    expect(fresh?.helpfulCount).toBe(1);

    // Exactly ONE junction row for the (review, voter) pair.
    const voteRows = await prisma.reviewHelpfulVote.count({
      where: { reviewId: review.id, customerId: voter },
    });
    expect(voteRows).toBe(1);

    // And every returned payload reports the deduped count of 1.
    for (const r of results) {
      if (r.status === 'fulfilled') {
        expect(r.value.helpfulCount).toBe(1);
      }
    }
  });
});
