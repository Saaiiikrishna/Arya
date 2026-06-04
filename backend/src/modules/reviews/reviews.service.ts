import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Prisma, Review, ReviewStatus } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '@/prisma/prisma.service';
import {
  CreateReviewDto,
  ListReviewsDto,
  ReviewSort,
  AdminListReviewsDto,
} from './dto';

/** Default + max page sizes for the paginated review lists. */
const PUBLIC_DEFAULT_LIMIT = 10;
const PUBLIC_MAX_LIMIT = 50;
const ADMIN_DEFAULT_LIMIT = 20;
const ADMIN_MAX_LIMIT = 200;

/**
 * Helpful-vote dedupe window. A given IP can register at most ONE helpful vote
 * per review per this window (Redis SET NX EX). This is a coarse, infrastructure
 * -only mitigation layered on top of the per-IP @Throttle: it does not replace a
 * true per-user dedupe (which needs a votes junction table — a schema change
 * owned outside this module), but it converts "6 votes/min/IP forever" into "1
 * vote/IP/day" so vote inflation is no longer trivial. Best-effort: if Redis is
 * unavailable the vote is allowed through rather than failing the request.
 */
const HELPFUL_VOTE_DEDUPE_TTL_SECONDS = 24 * 60 * 60; // 24h
const HELPFUL_VOTE_KEY_PREFIX = 'review_helpful_vote';

/**
 * Public-safe projection of a review. Deliberately omits customerId / orderId
 * (internal linkage) and the moderation status — the public list returns APPROVED
 * rows only, so status is implicit. authorName is derived from the customer's
 * first name (+ last initial) so a full surname is never leaked.
 */
export interface PublicReviewDto {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  authorName: string;
  createdAt: Date;
}

/** Aggregate summary attached to the public list response. */
export interface ReviewSummaryDto {
  average: number;
  count: number;
  breakdown: { 5: number; 4: number; 3: number; 2: number; 1: number };
}

/**
 * Compute the rounded (1 dp) average from the denormalized integer aggregate.
 * Mirrors the read-boundary rounding the catalog service uses (integer columns
 * upstream avoid float drift; rounding happens only here). Returns 0 when there
 * are no ratings (stable "no stars yet" value; avoids divide-by-zero).
 */
function ratingAverage(ratingSum: number, ratingCount: number): number {
  if (!ratingCount || ratingCount <= 0) return 0;
  return Math.round((ratingSum / ratingCount) * 10) / 10;
}

/** Derive a privacy-preserving display name: "First L." (last initial only). */
function authorNameOf(
  firstName: string | null,
  lastName: string | null,
): string {
  const first = (firstName ?? '').trim();
  const last = (lastName ?? '').trim();
  if (!first && !last) return 'Anonymous';
  const initial = last ? ` ${last.charAt(0).toUpperCase()}.` : '';
  return first ? `${first}${initial}` : last;
}

/**
 * Mask an email for the admin/moderator moderation queue: keep the first 2 chars
 * of the local part + the full domain, star out the rest ("jo***@example.com").
 * Enough to identify/disambiguate the author without serialising the raw address
 * (DPDP-style data minimisation). Returns '' unchanged for a null/empty value and
 * masks the whole local part when it is 1–2 chars.
 */
function maskEmail(email: string | null | undefined): string {
  const value = (email ?? '').trim();
  if (!value) return '';
  const at = value.lastIndexOf('@');
  if (at <= 0) {
    // No usable domain — mask everything but the first char.
    return value.length <= 1 ? '*' : `${value[0]}***`;
  }
  const local = value.slice(0, at);
  const domain = value.slice(at); // includes '@'
  const keep = local.slice(0, 2);
  return `${keep}***${domain}`;
}

@Injectable()
export class ReviewsService implements OnModuleDestroy {
  private readonly logger = new Logger(ReviewsService.name);
  // Dedicated Redis connection for helpful-vote dedupe (mirrors StoreAuthService's
  // own connection rather than reaching into the BullMQ pool). Constructed from
  // the same REDIS_* config (port 6380 ⇒ TLS in prod).
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const useTls = String(port) === '6380';
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port,
      ...(password ? { password } : {}),
      ...(useTls ? { tls: {} } : {}),
      // Don't let a Redis hiccup crash the process or block startup; the
      // helpful-vote dedupe degrades open (best-effort) when Redis is down.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    // Swallow connection errors: dedupe is best-effort and must never bubble an
    // unhandled 'error' event from the ioredis client.
    this.redis.on('error', (err) => {
      this.logger.warn(`reviews helpful-vote Redis error: ${err.message}`);
    });
  }

  /**
   * Close the dedicated Redis connection on graceful shutdown so we don't leak a
   * socket on test teardown / rolling deploys (matches StoreAuthService).
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      /* already closing / closed — nothing to do on shutdown */
    }
  }

  // ─── CUSTOMER: SUBMIT ─────────────────────────────────────

  /**
   * Create a PENDING review for `productId` authored by the JWT-pinned customer.
   *
   * - One review per customer per product (@@unique([productId, customerId])): a
   *   duplicate surfaces as a 409, not a raw P2002.
   * - isVerifiedPurchase is computed server-side: true iff the customer has a
   *   DELIVERED order whose line items reference this product (via OrderItem.sku
   *   → Sku.product). Never trusted from the client. The matched order is linked
   *   (orderId) for provenance.
   * - The review NEVER affects Product.ratingSum/ratingCount here — only an admin
   *   APPROVE applies the aggregate delta.
   */
  async submitReview(
    productId: string,
    customerId: string,
    dto: CreateReviewDto,
  ): Promise<Review> {
    // Product must exist (a stale/invalid id is a clean 404 rather than a FK error).
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Verified-purchase linkage: find ONE delivered order from this customer that
    // contains the product. We match on the live Sku→Product relation (the
    // snapshot sku code on the order item is frozen text and could drift), and
    // fall back gracefully if the sku was later detached (skuId set null).
    const verifyingOrder = await this.prisma.order.findFirst({
      where: {
        customerId,
        status: OrderStatus.DELIVERED,
        items: { some: { sku: { productId } } },
      },
      select: { id: true },
      orderBy: { deliveredAt: 'desc' },
    });
    const isVerifiedPurchase = !!verifyingOrder;

    try {
      return await this.prisma.review.create({
        data: {
          productId,
          customerId,
          orderId: verifyingOrder?.id ?? null,
          rating: dto.rating,
          title: dto.title?.trim() || null,
          // Trimmed for parity with `title`; the DTO already trims + rejects an
          // empty/whitespace-only body (@Transform + @MinLength(1)), so this is a
          // belt-and-braces normalization, not the validation gate.
          body: dto.body.trim(),
          status: ReviewStatus.PENDING,
          isVerifiedPurchase,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // @@unique([productId, customerId]) — the customer already reviewed this product.
        throw new ConflictException(
          'You have already submitted a review for this product',
        );
      }
      // The 1..5 range is enforced at the API edge by CreateReviewDto
      // (@Min(1)/@Max(5)); the reviews_rating_check DB CHECK is a defense-in-depth
      // backstop. We deliberately do NOT translate that constraint here: an
      // out-of-range value can only reach the DB if the DTO were removed, in which
      // case the raw error is the correct, loud signal. (Note: a CHECK violation
      // on review.create surfaces as P2003, not P2010 — P2010 is for $queryRaw.)
      throw e;
    }
  }

  // ─── PUBLIC: LIST + SUMMARY ───────────────────────────────

  /**
   * Public paginated list of APPROVED reviews for a product, plus an aggregate
   * summary (average from Product.ratingSum/ratingCount, total count, and a 1..5
   * star breakdown via groupBy over the APPROVED rows).
   *
   * The summary `average`/`count` are read from the denormalized Product aggregate
   * (the same numbers list/detail catalog reads show) so the storefront sees one
   * consistent number; the per-star breakdown is computed from the APPROVED review
   * rows.
   */
  async listPublicReviews(productId: string, query: ListReviewsDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, ratingSum: true, ratingCount: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit =
      query.limit && query.limit > 0
        ? Math.min(query.limit, PUBLIC_MAX_LIMIT)
        : PUBLIC_DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const where: Prisma.ReviewWhereInput = {
      productId,
      status: ReviewStatus.APPROVED,
    };

    // HELPFUL     → helpfulCount desc, then newest as a stable tiebreak.
    // RATING_DESC → highest rated first, then newest as a stable tiebreak.
    // RECENT (default / unrecognised) → newest first.
    let orderBy: Prisma.ReviewOrderByWithRelationInput[];
    switch (query.sort) {
      case ReviewSort.HELPFUL:
        orderBy = [{ helpfulCount: 'desc' }, { createdAt: 'desc' }];
        break;
      case ReviewSort.RATING_DESC:
        orderBy = [{ rating: 'desc' }, { createdAt: 'desc' }];
        break;
      default:
        orderBy = [{ createdAt: 'desc' }];
    }

    const [rows, total, summary] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          isVerifiedPurchase: true,
          helpfulCount: true,
          createdAt: true,
          customer: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.review.count({ where }),
      this.buildSummary(productId, product.ratingSum, product.ratingCount),
    ]);

    const data: PublicReviewDto[] = rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      isVerifiedPurchase: r.isVerifiedPurchase,
      helpfulCount: r.helpfulCount,
      authorName: authorNameOf(r.customer.firstName, r.customer.lastName),
      createdAt: r.createdAt,
    }));

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      summary,
    };
  }

  /**
   * Build the {average, count, breakdown} summary. average/count come from the
   * denormalized Product aggregate; the per-star breakdown is a groupBy over the
   * APPROVED reviews (the only rows that count toward the public rating).
   */
  private async buildSummary(
    productId: string,
    ratingSum: number,
    ratingCount: number,
  ): Promise<ReviewSummaryDto> {
    const grouped = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { productId, status: ReviewStatus.APPROVED },
      _count: { _all: true },
    });

    const breakdown: ReviewSummaryDto['breakdown'] = {
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 0,
    };
    for (const g of grouped) {
      if (g.rating >= 1 && g.rating <= 5) {
        breakdown[g.rating as 1 | 2 | 3 | 4 | 5] = g._count._all;
      }
    }

    return {
      average: ratingAverage(ratingSum, ratingCount),
      count: ratingCount,
      breakdown,
    };
  }

  // ─── PUBLIC: HELPFUL ──────────────────────────────────────

  /**
   * Increment a review's helpfulCount. Public; we only count helpful votes on
   * APPROVED reviews (a PENDING/REJECTED review isn't publicly visible, so voting
   * on it is meaningless and is rejected as 404). A single atomic
   * UPDATE … SET helpful_count = helpful_count + 1 avoids a read-modify-write race.
   *
   * Dedupe: layered defence. A true per-user dedupe needs a votes junction table
   * (a schema change owned outside this module), so we instead apply a Redis
   * per-review-per-IP gate (one vote / IP / review / 24h) ON TOP of the per-IP
   * @Throttle. `SET key 1 NX EX` is atomic, so two concurrent votes from the same
   * IP for the same review cannot both pass. Degrades open: if Redis is down or no
   * IP is available, the vote is still counted (best-effort, never blocks the
   * read path). When the IP has already voted in-window we return the CURRENT
   * count unchanged (HTTP 200, idempotent) rather than erroring.
   */
  async markHelpful(
    reviewId: string,
    voterIp?: string | null,
  ): Promise<{ id: string; helpfulCount: number }> {
    // Per-IP dedupe BEFORE the increment. If this IP already voted on this review
    // within the window, short-circuit to the current count (no double-count).
    if (voterIp) {
      const firstVote = await this.tryClaimHelpfulVote(reviewId, voterIp);
      if (!firstVote) {
        const existing = await this.prisma.review.findFirst({
          where: { id: reviewId, status: ReviewStatus.APPROVED },
          select: { id: true, helpfulCount: true },
        });
        if (!existing) {
          throw new NotFoundException('Review not found');
        }
        return { id: existing.id, helpfulCount: existing.helpfulCount };
      }
    }

    // updateMany scoped to APPROVED so the increment is conditional in ONE
    // round-trip (no separate existence read that could race the status change).
    const result = await this.prisma.review.updateMany({
      where: { id: reviewId, status: ReviewStatus.APPROVED },
      data: { helpfulCount: { increment: 1 } },
    });
    if (result.count === 0) {
      // Not an APPROVED review: release the just-claimed dedupe key so a later
      // legitimate vote (once approved) isn't blocked by this rejected attempt.
      if (voterIp) {
        await this.redis
          .del(this.helpfulVoteKey(reviewId, voterIp))
          .catch(() => undefined);
      }
      throw new NotFoundException('Review not found');
    }
    const updated = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, helpfulCount: true },
    });
    // updated is non-null: the row matched the updateMany above within this request.
    return { id: updated!.id, helpfulCount: updated!.helpfulCount };
  }

  /** Redis dedupe key for one (review, IP) pair. */
  private helpfulVoteKey(reviewId: string, voterIp: string): string {
    return `${HELPFUL_VOTE_KEY_PREFIX}:${reviewId}:${voterIp}`;
  }

  /**
   * Atomically claim the (review, IP) vote slot. Returns true if THIS call set
   * the key (first vote in-window), false if it already existed (duplicate).
   * Degrades OPEN on any Redis error — returns true so the vote still counts.
   */
  private async tryClaimHelpfulVote(
    reviewId: string,
    voterIp: string,
  ): Promise<boolean> {
    try {
      const set = await this.redis.set(
        this.helpfulVoteKey(reviewId, voterIp),
        '1',
        'EX',
        HELPFUL_VOTE_DEDUPE_TTL_SECONDS,
        'NX',
      );
      // ioredis returns 'OK' when NX set succeeds, null when the key already exists.
      return set === 'OK';
    } catch (e) {
      this.logger.warn(
        `helpful-vote dedupe unavailable (review ${reviewId}); allowing vote: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return true;
    }
  }

  // ─── ADMIN: MODERATION QUEUE ──────────────────────────────

  /**
   * Admin moderation queue. Defaults to the PENDING work list when no status is
   * supplied. Returns the full review row plus a light customer/product label so
   * the admin board needs no follow-up lookups.
   *
   * PII minimisation: the customer email is MASKED (first 2 chars + domain) before
   * it leaves the service. The moderation UI only needs to identify the author,
   * and AdminGuard admits MODERATOR (whose sole function is review triage) — so a
   * full raw email is more PII than the task requires under DPDP-style data
   * minimisation. The customer id + name remain for identification/lookup.
   */
  async adminListReviews(query: AdminListReviewsDto) {
    const status = query.status ?? ReviewStatus.PENDING;
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit =
      query.limit && query.limit > 0
        ? Math.min(query.limit, ADMIN_MAX_LIMIT)
        : ADMIN_DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const where: Prisma.ReviewWhereInput = { status };

    const [rows, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          product: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    // Mask the email at the read boundary so the raw address is never serialised
    // to the admin/moderator client.
    const data = rows.map((r) => ({
      ...r,
      customer: { ...r.customer, email: maskEmail(r.customer.email) },
    }));

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── ADMIN: MODERATE (APPROVE / REJECT) ───────────────────

  /**
   * Moderate a review and keep Product.ratingSum/ratingCount in lockstep.
   *
   * The denormalized aggregate MUST change by EXACTLY the review's rating on the
   * first APPROVE, and reverse by EXACTLY that rating when an APPROVED review
   * moves to REJECTED. To make this race-safe AND idempotent:
   *
   *  1. Run inside a single $transaction.
   *  2. Take a tx-scoped advisory lock keyed on the product
   *     (pg_advisory_xact_lock(hashtext('product_rating_'+productId))) so two
   *     concurrent moderations of reviews for the SAME product serialize — the
   *     repo's approved concurrency idiom (matches inventory/coupons).
   *  3. Re-read the review UNDER the lock and compare its CURRENT status to the
   *     target. If they already match, this is a no-op (idempotent re-approve /
   *     re-reject never double-counts).
   *  4. Apply the aggregate delta ONLY on a real transition:
   *       * → APPROVED  : ratingSum += rating, ratingCount += 1
   *       APPROVED → REJECTED : ratingSum -= rating, ratingCount -= 1 (CAS-guarded
   *                             so it never drives the counters negative)
   *     PENDING → REJECTED and REJECTED → APPROVED-from-rejected are handled by
   *     the same "was it previously counted?" test (only an APPROVED row is ever
   *     counted), so the math is symmetric and self-correcting.
   */
  async moderateReview(
    reviewId: string,
    // Extract<…> narrows the Prisma const-object enum at the type level (a plain
    // `ReviewStatus.APPROVED` value-union can't be used as a type annotation here).
    targetStatus: Extract<ReviewStatus, 'APPROVED' | 'REJECTED'>,
  ): Promise<Review> {
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.findUnique({ where: { id: reviewId } });
      if (!review) {
        throw new NotFoundException('Review not found');
      }

      // Idempotent: target already met → return as-is, touch nothing.
      if (review.status === targetStatus) {
        return review;
      }

      const productId = review.productId;

      // (2) Serialize all rating mutations for this product. hashtext maps the
      // stable string key into the 32-bit advisory-lock space (same idiom as
      // inventory/coupons). Re-entrant within this tx. `productId` is a UUID
      // (validated by ParseUUIDPipe on the route and confirmed to exist by the
      // findUnique above); the value is passed as a bound parameter by Prisma's
      // tagged-template parameterisation (no inline SQL), so there is no injection
      // vector regardless. Template-literal key matches the repo-wide idiom.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`product_rating_${productId}`}))`;

      const wasCounted = review.status === ReviewStatus.APPROVED;
      const willBeCounted = targetStatus === ReviewStatus.APPROVED;

      if (!wasCounted && willBeCounted) {
        // First-time approval (PENDING/REJECTED → APPROVED): add the rating.
        await tx.product.update({
          where: { id: productId },
          data: {
            ratingSum: { increment: review.rating },
            ratingCount: { increment: 1 },
          },
        });
      } else if (wasCounted && !willBeCounted) {
        // Un-approve (APPROVED → REJECTED): subtract the rating. CAS-guarded so a
        // corrupted/under-counted aggregate can never go negative — the WHERE
        // clause only applies the decrement when both counters can absorb it; if
        // they can't (count===0 already) the no-op leaves them at the floor.
        const adjusted = await tx.product.updateMany({
          where: {
            id: productId,
            ratingCount: { gte: 1 },
            ratingSum: { gte: review.rating },
          },
          data: {
            ratingSum: { decrement: review.rating },
            ratingCount: { decrement: 1 },
          },
        });
        if (adjusted.count === 0) {
          // Aggregate was already at/below the floor for this delta — log and
          // proceed with the status change rather than corrupting the counters.
          this.logger.warn(
            `moderateReview: skipped rating subtraction for product ${productId} ` +
              `(review ${reviewId}); aggregate could not absorb -${review.rating}.`,
          );
        }
      }
      // else (PENDING → REJECTED): never counted, never counts — status-only.

      return tx.review.update({
        where: { id: reviewId },
        data: { status: targetStatus },
      });
    });
  }
}
