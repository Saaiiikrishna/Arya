import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, Review, ReviewStatus } from '@prisma/client';
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
  // ratingCount is a non-negative integer DB column; `<= 0` covers the 0 ("no
  // ratings yet") case and any negative value from DB corruption — and also
  // guards the divide below.
  if (ratingCount <= 0) return 0;
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
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  // ─── CUSTOMER: HELPFUL ────────────────────────────────────

  /**
   * Register a helpful vote on a review for the JWT-pinned customer. CUSTOMER-only
   * (the route is CustomerJwtGuard-gated); the public can still READ helpfulCount
   * via the list, but only a registered customer can vote.
   *
   * TRUE per-user dedupe (replaces the old coarse per-IP Redis gate): one row per
   * (review, customer) in `review_helpful_votes` with a @@unique([reviewId,
   * customerId]). A second vote from the same customer collides on that unique and
   * surfaces as a P2002 — we swallow it idempotently and return the CURRENT count
   * unchanged (HTTP 200, no increment). Both the junction insert and the count
   * increment run inside ONE $transaction so a fresh vote and its +1 are atomic.
   *
   * We only count helpful votes on APPROVED reviews (a PENDING/REJECTED review
   * isn't publicly visible, so voting on it is meaningless → 404). The increment
   * is an updateMany scoped to APPROVED so it is conditional in ONE round-trip
   * (no separate existence read that could race the status change); if it matches
   * nothing the transaction rolls back (so no orphan vote row is left behind) and
   * we surface a 404.
   */
  async markHelpful(
    reviewId: string,
    customerId: string,
  ): Promise<{ id: string; helpfulCount: number }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Claim the (review, customer) slot first. A duplicate collides on the
        // @@unique and throws P2002 — caught below and handled idempotently.
        await tx.reviewHelpfulVote.create({
          data: { reviewId, customerId },
        });

        // Fresh vote: increment, scoped to APPROVED so the +1 is conditional in
        // one atomic round-trip. updateMany returns count===0 for a missing /
        // non-APPROVED review → throw so the whole tx (incl. the vote insert above)
        // rolls back and no orphan vote row survives.
        const result = await tx.review.updateMany({
          where: { id: reviewId, status: ReviewStatus.APPROVED },
          data: { helpfulCount: { increment: 1 } },
        });
        if (result.count === 0) {
          throw new NotFoundException('Review not found');
        }

        const updated = await tx.review.findUnique({
          where: { id: reviewId },
          select: { id: true, helpfulCount: true },
        });
        // Non-null: the row matched the updateMany above within this transaction.
        return { id: updated!.id, helpfulCount: updated!.helpfulCount };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          // @@unique([reviewId, customerId]) — this customer already voted.
          // Idempotent: return the CURRENT count unchanged, no increment. Still
          // scoped to APPROVED so a vote that pre-dates a later rejection doesn't
          // leak a hidden review.
          const existing = await this.prisma.review.findFirst({
            where: { id: reviewId, status: ReviewStatus.APPROVED },
            select: { id: true, helpfulCount: true },
          });
          if (!existing) {
            throw new NotFoundException('Review not found');
          }
          return { id: existing.id, helpfulCount: existing.helpfulCount };
        }
        if (e.code === 'P2003') {
          // FK violation on the vote insert: the reviewId references no review row
          // at all — a clean 404 rather than a raw 500.
          throw new NotFoundException('Review not found');
        }
      }
      throw e;
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
