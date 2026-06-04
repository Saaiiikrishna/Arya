import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, CouponType, CouponStatus } from '@prisma/client';
import { PrismaService } from '../../prisma';
import {
  CreateCouponDto,
  UpdateCouponDto,
  CouponQueryDto,
  MAX_PERCENT_BPS,
} from './dto';
import { rupeesToPaise, optionalRupeesToPaise } from './dto/money';

/**
 * Context for validating/redeeming a coupon. Identity is sourced server-side
 * from the JWT (registered customer) or the guest checkout context — never from
 * the request body. `isGuest` is the authoritative flag; `customerId`/`email`
 * are whatever identity the caller has resolved.
 */
export interface CouponContext {
  customerId?: string;
  email?: string;
  isGuest: boolean;
}

/** The validated-coupon shape returned to checkout (and the public validate route). */
export interface ValidatedCoupon {
  couponId: string;
  code: string;
  discountPaise: number;
}

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────
  //  Boundary helpers
  // ─────────────────────────────────────────────────────────────

  /** Normalize a coupon code for storage/lookup: trim + uppercase. */
  private static normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  /** Normalize an email for the per-identity anti-farming dedupe key. */
  private static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Resolve the stored integer `value` for a coupon from a rupee/bps DTO value,
   * applying the type-specific rule in ONE place:
   *  - PERCENT → basis points (1..10000), taken directly (not money).
   *  - FIXED   → rupees converted to integer paise.
   */
  private static resolveStoredValue(type: CouponType, value: number): number {
    if (type === CouponType.PERCENT) {
      if (!Number.isInteger(value) || value <= 0 || value > MAX_PERCENT_BPS) {
        throw new BadRequestException(
          `PERCENT coupon value must be an integer in basis points (1..${MAX_PERCENT_BPS}; 1800 = 18%)`,
        );
      }
      return value;
    }
    // FIXED: rupees → paise; must be a positive amount.
    const paise = rupeesToPaise(value, 'value');
    if (paise <= 0) {
      throw new BadRequestException(
        'FIXED coupon value must be greater than 0',
      );
    }
    return paise;
  }

  // ─────────────────────────────────────────────────────────────
  //  ADMIN CRUD
  // ─────────────────────────────────────────────────────────────

  async createCoupon(dto: CreateCouponDto) {
    const code = CouponService.normalizeCode(dto.code);
    const value = CouponService.resolveStoredValue(dto.type, dto.value);
    const { startsAt, expiresAt } = this.parseWindow(
      dto.startsAt,
      dto.expiresAt,
    );

    const maxDiscount = optionalRupeesToPaise(dto.maxDiscount, 'maxDiscount');
    if (dto.type === CouponType.FIXED && maxDiscount !== undefined) {
      // maxDiscount only caps PERCENT coupons; a FIXED cap is meaningless and a
      // likely admin mistake — reject rather than silently store dead config.
      throw new BadRequestException(
        'maxDiscount applies only to PERCENT coupons',
      );
    }

    try {
      return await this.prisma.coupon.create({
        data: {
          code,
          description: dto.description ?? null,
          type: dto.type,
          value,
          maxDiscount: maxDiscount ?? null,
          minOrderValue:
            optionalRupeesToPaise(dto.minOrderValue, 'minOrderValue') ?? 0,
          status: dto.status ?? CouponStatus.ACTIVE,
          usageLimit: dto.usageLimit ?? null,
          perCustomerLimit: dto.perCustomerLimit ?? 1,
          allowGuest: dto.allowGuest ?? false,
          startsAt,
          expiresAt,
        },
      });
    } catch (err) {
      throw this.mapCodeConflict(err, code);
    }
  }

  async updateCoupon(id: string, dto: UpdateCouponDto) {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Coupon not found');

    const data: Prisma.CouponUpdateInput = {};

    if (dto.description !== undefined) data.description = dto.description;

    if (dto.value !== undefined) {
      // `type` is immutable, so resolve against the existing type.
      data.value = CouponService.resolveStoredValue(existing.type, dto.value);
    }

    if (dto.maxDiscount !== undefined) {
      const maxDiscount = rupeesToPaise(dto.maxDiscount, 'maxDiscount');
      if (existing.type === CouponType.FIXED) {
        throw new BadRequestException(
          'maxDiscount applies only to PERCENT coupons',
        );
      }
      // A cap of 0 paise would silently zero every PERCENT discount, disabling
      // the coupon while it still reads ACTIVE — reject as an admin mistake.
      if (maxDiscount <= 0) {
        throw new BadRequestException('maxDiscount must be greater than 0');
      }
      data.maxDiscount = maxDiscount;
    }

    if (dto.minOrderValue !== undefined) {
      data.minOrderValue = rupeesToPaise(dto.minOrderValue, 'minOrderValue');
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.usageLimit !== undefined) {
      // Lowering usageLimit below the already-consumed usedCount would make every
      // future validate/redeem fail ('reached its usage limit') while the coupon
      // still shows its configured status — refuse the inconsistent config.
      if (dto.usageLimit < existing.usedCount) {
        throw new BadRequestException(
          `usageLimit (${dto.usageLimit}) cannot be lower than the ${existing.usedCount} redemptions already used`,
        );
      }
      data.usageLimit = dto.usageLimit;
    }
    if (dto.perCustomerLimit !== undefined) {
      data.perCustomerLimit = dto.perCustomerLimit;
    }
    if (dto.allowGuest !== undefined) data.allowGuest = dto.allowGuest;

    if (dto.startsAt !== undefined || dto.expiresAt !== undefined) {
      const { startsAt, expiresAt } = this.parseWindow(
        dto.startsAt ?? existing.startsAt?.toISOString(),
        dto.expiresAt ?? existing.expiresAt?.toISOString(),
      );
      if (dto.startsAt !== undefined) data.startsAt = startsAt;
      if (dto.expiresAt !== undefined) data.expiresAt = expiresAt;
    }

    return this.prisma.coupon.update({ where: { id }, data });
  }

  async listCoupons(query: CouponQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const skip = (page - 1) * limit;

    const where: Prisma.CouponWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { code: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.coupon.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { _count: { select: { redemptions: true } } },
      }),
      this.prisma.coupon.count({ where }),
    ]);

    return {
      data: rows,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getCoupon(id: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }

  // ─────────────────────────────────────────────────────────────
  //  CROSS-MODULE CONTRACT: validateCoupon
  // ─────────────────────────────────────────────────────────────

  /**
   * Validate a coupon for the given context + cart subtotal and compute the
   * discount. Read-only — does NOT consume capacity (that is redeemCoupon's job,
   * inside the checkout tx). Used both by the public `validate` route and by
   * checkout to surface the line before reservation.
   *
   * Rejects (always BadRequest, never a generic 500) when:
   *  - the code does not exist,
   *  - status is not ACTIVE,
   *  - now is outside [startsAt, expiresAt],
   *  - subtotal < minOrderValue,
   *  - the coupon disallows guests and the context is a guest,
   *  - total capacity (usageLimit) is already exhausted.
   *
   * Discount:
   *  - PERCENT → round-half-up(subtotal * bps / 10000), capped at maxDiscount.
   *  - FIXED   → min(value, subtotal).
   *  No stacking — a single coupon per cart (enforced by Cart.couponId upstream).
   */
  async validateCoupon(
    code: string,
    ctx: CouponContext,
    subtotalPaise: number,
  ): Promise<ValidatedCoupon> {
    if (!Number.isInteger(subtotalPaise) || subtotalPaise < 0) {
      throw new BadRequestException('Cart subtotal is invalid');
    }
    const normalized = CouponService.normalizeCode(code);
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: normalized },
    });
    if (!coupon) {
      throw new BadRequestException('Coupon code is not valid');
    }

    if (coupon.status !== CouponStatus.ACTIVE) {
      throw new BadRequestException('This coupon is not currently active');
    }

    const now = new Date();
    if (coupon.startsAt && now < coupon.startsAt) {
      throw new BadRequestException('This coupon is not active yet');
    }
    if (coupon.expiresAt && now > coupon.expiresAt) {
      throw new BadRequestException('This coupon has expired');
    }

    if (subtotalPaise < coupon.minOrderValue) {
      throw new BadRequestException(
        `Add ${this.paiseToRupeeString(
          coupon.minOrderValue - subtotalPaise,
        )} more to use this coupon (minimum order ${this.paiseToRupeeString(
          coupon.minOrderValue,
        )})`,
      );
    }

    if (!coupon.allowGuest && ctx.isGuest) {
      throw new BadRequestException(
        'This coupon is available to registered accounts only. Please sign in to use it.',
      );
    }

    // Total-capacity gate (best-effort here; the authoritative CAS lives in
    // redeemCoupon inside the checkout tx). usageLimit null = unlimited.
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException('This coupon has reached its usage limit');
    }

    // Per-identity pre-check (anti-farming). Authoritative enforcement is in
    // redeemCoupon under the advisory lock; this gives a friendly early error.
    // Two keys are checked because either may be the only identity available:
    //   - email: the primary anti-farming key (Section 8.13) — fires whenever an
    //     email is present, including allowGuest coupons where a guest supplied
    //     one, so a single human cannot farm via fresh guest Customer rows.
    //   - customerId: a secondary cap so email-free OTP-only customers (whose
    //     JWT carries no email) are still bound by perCustomerLimit rather than
    //     bypassing it entirely.
    const priorCount = await this.countPriorRedemptions(
      this.prisma,
      coupon.id,
      {
        email: ctx.email,
        customerId: ctx.isGuest ? undefined : ctx.customerId,
      },
    );
    if (priorCount !== null && priorCount >= coupon.perCustomerLimit) {
      throw new BadRequestException(
        'You have already used this coupon the maximum number of times',
      );
    }

    const discountPaise = this.computeDiscount(coupon, subtotalPaise);
    return { couponId: coupon.id, code: coupon.code, discountPaise };
  }

  /**
   * Count this identity's prior redemptions of a coupon for the per-customer cap.
   * Prefers the normalized email key (Section 8.13 anti-farming, which defeats
   * guest-account farming because it does not depend on Customer.id); falls back
   * to the customerId key so email-free (OTP-only) accounts are still bounded.
   * Returns null when neither key is available (nothing to dedupe on — the total
   * usageLimit + unique([couponId,orderId]) still bound abuse). Accepts a Prisma
   * client OR a transaction client so it is reusable from validate (read) and
   * redeem (inside the tx, under the advisory lock).
   */
  private async countPriorRedemptions(
    client: PrismaService | Prisma.TransactionClient,
    couponId: string,
    identity: { email?: string; customerId?: string },
  ): Promise<number | null> {
    const normalizedEmail = identity.email
      ? CouponService.normalizeEmail(identity.email)
      : null;
    if (normalizedEmail) {
      return client.couponRedemption.count({
        where: { couponId, redeemerEmail: normalizedEmail },
      });
    }
    if (identity.customerId) {
      return client.couponRedemption.count({
        where: { couponId, customerId: identity.customerId },
      });
    }
    return null;
  }

  /**
   * Pure discount math (no I/O), shared by validate + redeem so the amount can
   * never drift between the quote and the consume.
   *  - PERCENT: round-half-up(subtotal * bps / 10000), then cap at maxDiscount,
   *             then clamp to subtotal (a discount can never exceed the order).
   *  - FIXED:   min(value, subtotal).
   */
  private computeDiscount(
    coupon: { type: CouponType; value: number; maxDiscount: number | null },
    subtotalPaise: number,
  ): number {
    let discount: number;
    if (coupon.type === CouponType.PERCENT) {
      // round-half-up on non-negative integers: floor((a*b + denom/2)/denom).
      discount = Math.floor((subtotalPaise * coupon.value + 5000) / 10000);
      if (coupon.maxDiscount !== null) {
        discount = Math.min(discount, coupon.maxDiscount);
      }
    } else {
      discount = coupon.value;
    }
    // A discount can never exceed the order subtotal.
    discount = Math.min(discount, subtotalPaise);
    return Math.max(0, discount);
  }

  // ─────────────────────────────────────────────────────────────
  //  CROSS-MODULE CONTRACT: redeemCoupon (called INSIDE the checkout tx)
  // ─────────────────────────────────────────────────────────────

  /**
   * Atomically consume one redemption of a coupon for an order. MUST be called
   * inside the checkout `$transaction` (it takes a tx-scoped advisory lock and
   * relies on the surrounding tx to roll back on any failure).
   *
   * Steps (Section 5.2 "Coupon redemption" row + 8.13 anti-farming):
   *  1. advisory lock `coupon_{id}` (tx-scoped; serializes concurrent redeems).
   *  2. re-read the coupon under the lock and re-assert status ACTIVE + window
   *     (state may have changed between validate and checkout).
   *  3. require a customerId. Even a guest checkout creates a GUEST Customer row
   *     (Section 8.13 / 2.4), so every order that reaches redeem MUST carry one;
   *     CouponRedemption.customerId is a non-nullable FK. This single check is the
   *     enforcement backstop of that invariant — a checkout that reaches here
   *     without a Customer is a bug, surfaced as a tx-rolling-back 400.
   *     The authoritative guest/allowGuest gate already ran in validateCoupon
   *     (which receives the JWT-resolved isGuest); it is NOT repeated here because
   *     `customerId` presence cannot distinguish a guest (who also has a GUEST
   *     Customer) from a registered customer, so a redeem-time allowGuest check
   *     keyed on customerId would be both wrong and unreachable.
   *  4. per-identity dedupe: count prior CouponRedemption for (couponId,
   *     normalized redeemerEmail) and require < perCustomerLimit — defeats
   *     guest-account farming because the cap keys on email, not Customer.id.
   *  5. CAS bump usedCount guarded usedCount < usageLimit (when limited).
   *  6. insert CouponRedemption (@@unique([couponId, orderId]) is the
   *     double-redeem-per-order backstop). discountApplied is the caller-supplied
   *     value from validateCoupon (the same number checkout charged), so the audit
   *     row can never drift from the charge and we avoid an extra Order read.
   *
   * Throws ConflictException on capacity/dedupe loss and BadRequest on an
   * invalid coupon state — both roll the checkout tx back so no order is paid
   * against a coupon that could not be consumed.
   */
  async redeemCoupon(
    tx: Prisma.TransactionClient,
    args: {
      couponId: string;
      orderId: string;
      discountPaise: number;
      customerId?: string;
      email?: string;
      phone?: string;
    },
  ): Promise<void> {
    if (!Number.isInteger(args.discountPaise) || args.discountPaise < 0) {
      throw new BadRequestException('Coupon discount amount is invalid');
    }

    const lockKey = `coupon_${args.couponId}`;
    // (1) tx-scoped advisory lock — auto-releases at commit/rollback. hashtext
    // maps the stable string key into the 32-bit advisory-lock space (same idiom
    // as InventoryService / the repo-wide convention).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    // (2) re-read under the lock.
    const coupon = await tx.coupon.findUnique({ where: { id: args.couponId } });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    if (coupon.status !== CouponStatus.ACTIVE) {
      throw new BadRequestException('This coupon is no longer active');
    }
    const now = new Date();
    if (coupon.startsAt && now < coupon.startsAt) {
      throw new BadRequestException('This coupon is not active yet');
    }
    if (coupon.expiresAt && now > coupon.expiresAt) {
      throw new BadRequestException('This coupon has expired');
    }

    // (3) require a Customer row. CouponRedemption.customerId is a non-nullable
    // FK; even a guest checkout creates a GUEST Customer (Section 8.13 / 2.4), so
    // every order that reaches redeem must carry one. The allowGuest gate already
    // ran authoritatively in validateCoupon (keyed on the JWT-resolved isGuest);
    // it is intentionally NOT repeated here because customerId presence cannot
    // distinguish a guest from a registered customer. Refuse rather than violate
    // the FK — this surfaces a checkout sequencing bug as a tx-rolling-back 400.
    if (!args.customerId) {
      throw new BadRequestException(
        'A customer record is required to redeem a coupon',
      );
    }

    const normalizedEmail = args.email
      ? CouponService.normalizeEmail(args.email)
      : null;

    // (4) per-identity dedupe under the advisory lock (anti-farming, Section
    // 8.13). Prefers the normalized email key (defeats guest-account farming);
    // falls back to customerId so email-free OTP-only accounts are still capped.
    // When neither key exists the unique([couponId,orderId]) + total cap bound
    // abuse. Authoritative because it runs serialized under the coupon lock.
    const priorForIdentity = await this.countPriorRedemptions(tx, coupon.id, {
      email: args.email,
      customerId: args.customerId,
    });
    if (
      priorForIdentity !== null &&
      priorForIdentity >= coupon.perCustomerLimit
    ) {
      throw new ConflictException(
        'You have already used this coupon the maximum number of times',
      );
    }

    // (5) CAS bump usedCount guarded < usageLimit (null = unlimited).
    const bumped = await tx.coupon.updateMany({
      where: {
        id: coupon.id,
        ...(coupon.usageLimit !== null
          ? { usedCount: { lt: coupon.usageLimit } }
          : {}),
      },
      data: { usedCount: { increment: 1 } },
    });
    if (bumped.count !== 1) {
      throw new ConflictException('This coupon has reached its usage limit');
    }

    // The applied discount is the caller-supplied value from validateCoupon — the
    // exact number checkout charged on the order — so the audit row can never
    // drift from the charge, and we avoid an extra Order round-trip (the Order's
    // discountTotal is still 0 at this point in the checkout tx). Re-clamp the
    // discount against the coupon's own cap as a defense-in-depth backstop so a
    // caller can never persist a discount larger than the coupon could grant.
    let discountApplied = args.discountPaise;
    if (coupon.maxDiscount !== null) {
      discountApplied = Math.min(discountApplied, coupon.maxDiscount);
    }

    // (6) insert the redemption row. @@unique([couponId, orderId]) backstops a
    // double-redeem of the same coupon on the same order (maps P2002 → 409).
    try {
      await tx.couponRedemption.create({
        data: {
          couponId: coupon.id,
          customerId: args.customerId,
          orderId: args.orderId,
          redeemerEmail: normalizedEmail,
          redeemerPhone: args.phone ?? null,
          discountApplied,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This coupon has already been applied to this order',
        );
      }
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Internal helpers
  // ─────────────────────────────────────────────────────────────

  /** Parse + validate the optional [startsAt, expiresAt] window. */
  private parseWindow(
    startsAtIso?: string,
    expiresAtIso?: string,
  ): { startsAt: Date | null; expiresAt: Date | null } {
    const startsAt = startsAtIso ? new Date(startsAtIso) : null;
    const expiresAt = expiresAtIso ? new Date(expiresAtIso) : null;
    if (startsAt && Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('startsAt is not a valid date');
    }
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('expiresAt is not a valid date');
    }
    if (startsAt && expiresAt && expiresAt <= startsAt) {
      throw new BadRequestException('expiresAt must be after startsAt');
    }
    return { startsAt, expiresAt };
  }

  /** Map a Prisma P2002 on coupon.code to a friendly 409; re-throw everything else. */
  private mapCodeConflict(err: unknown, code: string): unknown {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictException(`Coupon code "${code}" already exists`);
    }
    return err;
  }

  /**
   * Format integer paise as a ₹ rupee string for user-facing messages using
   * integer arithmetic (whole-rupee = floor(paise/100), fraction = paise%100),
   * keeping the "money is integer paise" invariant all the way to the display
   * layer rather than going through a lossy float division.
   */
  private paiseToRupeeString(paise: number): string {
    const whole = Math.floor(paise / 100);
    const fraction = paise % 100;
    return `₹${whole}.${String(fraction).padStart(2, '0')}`;
  }

  // ─────────────────────────────────────────────────────────────
  //  Maintenance (driven by the daily store-coupon-expiry cron)
  // ─────────────────────────────────────────────────────────────

  /**
   * Flip every ACTIVE coupon whose `expiresAt` is in the past to EXPIRED
   * (Section 7 `store-coupon-expiry`). validate/redeem already reject expired
   * coupons by date comparison, but the persisted `status` must also reflect
   * reality so admin list filters (`status=EXPIRED`) and status analytics are
   * correct rather than showing stale ACTIVE rows forever.
   *
   * Idempotent: the `status: ACTIVE` + `expiresAt < now` predicate makes a
   * re-run a no-op, so the cron and any retry converge on the same result.
   * Returns the number of rows transitioned (for the caller's log line).
   */
  async expireStaleCoupons(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.coupon.updateMany({
      where: {
        status: CouponStatus.ACTIVE,
        expiresAt: { not: null, lt: now },
      },
      data: { status: CouponStatus.EXPIRED },
    });
    return result.count;
  }
}
