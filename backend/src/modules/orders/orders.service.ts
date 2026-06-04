import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CustomerType,
  Order,
  OrderEventType,
  OrderPaymentStatus,
  OrderStatus,
  Prisma,
  ProductStatus,
  ProductType,
  ReservationStatus,
  StockMovementReason,
} from '@prisma/client';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { CartService } from '@/modules/cart/cart.service';
import { CouponService } from '@/modules/coupons/coupons.service';
import {
  InventoryService,
  StockLine,
  StockUpdatedEvent,
} from '@/modules/inventory/inventory.service';
import { TaxService } from '@/modules/tax/tax.service';
import { GuestTokenService } from '@/modules/store-auth/guest-token.service';
import { SELLER_GSTIN_SETTING_KEY } from '@/modules/tax/tax.service';
import { SettingsService } from '@/modules/settings/settings.service';
import { DocumentService } from '@/modules/document/document.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import {
  apportion as apportionShared,
  resolveUnitPrice as resolveUnitPriceShared,
} from '../store/shared/pricing.utils';
// Import the CANONICAL realtime event name + payload type from store-realtime and
// re-export them below, so this producer and the gateway @OnEvent consumer share a
// single source of truth and cannot drift on a rename / field addition (Section 6).
import {
  ORDER_UPDATED_EVENT as CANONICAL_ORDER_UPDATED_EVENT,
  type OrderUpdatedPayload,
} from '@/modules/store-realtime/realtime.constants';
import { CheckoutAddressDto, CheckoutDto, OrderQueryDto } from './dto';

/** The checkout caller, resolved from the guard (CUSTOMER JWT or guest token). */
export interface CheckoutActor {
  /** Present for a registered customer (CUSTOMER JWT). */
  customerId?: string;
  /** Buyer email if known (registered customer). */
  email?: string | null;
  /** Buyer phone if known. */
  phone?: string | null;
  /** Resolved guest cart id (guest path only). */
  guestCartId?: string;
  /** True when authorized purely by a guest cart token. */
  isGuest: boolean;
}

/** A generic audited actor (JWT-sourced) for admin transitions / refunds. */
export interface OrderActor {
  id: string;
  role?: string;
}

/** The Razorpay payment entity fields the store webhook reads. */
interface RazorpayPaymentEntity {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
}

/** The Razorpay webhook envelope the store handler parses. */
interface RazorpayWebhookEnvelope {
  event?: string;
  payload?: { payment?: { entity?: RazorpayPaymentEntity } };
}

/**
 * Realtime `order.updated` event name + payload. Emitted on the global
 * EventEmitter2 bus AFTER an order-mutation transaction COMMITS (checkout /
 * webhook capture / status transition) and consumed by the store-realtime
 * OrdersGateway, which relays it to the admin / order / customer rooms. Kept
 * best-effort: an emit failure must never break the business path (Section 6).
 */
export const ORDER_UPDATED_EVENT = CANONICAL_ORDER_UPDATED_EVENT;

/**
 * Authoritative `order.updated` payload. Aliased to the canonical
 * `OrderUpdatedPayload` in realtime.constants.ts so the producer (here) and the
 * gateway @OnEvent consumer reference ONE type — adding a field in one place
 * surfaces in the other rather than silently dropping at the relay (Section 6).
 */
export type OrderUpdatedEvent = OrderUpdatedPayload;

/** Reservation TTL for an unpaid order (architecture 4.6 / 5.2). */
const RESERVATION_TTL_MS = 30 * 60 * 1000; // 30 minutes
/**
 * Re-use window for an unpaid (PENDING_PAYMENT) order minted from the SAME cart.
 * Mirrors payment.service.ts's 15-minute reuse window (architecture 8.1): two
 * rapid concurrent checkouts (double-submit on a slow network) must converge on
 * ONE Razorpay order + ONE reservation rather than each minting a duplicate.
 */
const ORDER_REUSE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

/**
 * Allowed order state-machine transitions (admin board + cancel/refund).
 * CONFIRMED → PROCESSING/PACKED → SHIPPED → DELIVERED forward path.
 * CANCELLED is reachable from any pre-shipped state (releases stock).
 * REFUNDED / PARTIALLY_REFUNDED are driven by the returns/refund flow.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, OrderStatus[]>> = {
  PENDING_PAYMENT: [OrderStatus.CANCELLED],
  PAID: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [
    OrderStatus.PROCESSING,
    OrderStatus.PACKED,
    OrderStatus.CANCELLED,
  ],
  PROCESSING: [OrderStatus.PACKED, OrderStatus.CANCELLED],
  PACKED: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  SHIPPED: [OrderStatus.DELIVERED],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
  PARTIALLY_REFUNDED: [],
};

/** Statuses from which a cancel still releases reserved/restocks committed stock. */
const PRE_SHIPPED_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.PACKED,
]);

@Injectable()
export class OrdersService {
  private readonly razorpay: Razorpay;
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cart: CartService,
    private readonly coupons: CouponService,
    private readonly inventory: InventoryService,
    private readonly tax: TaxService,
    private readonly guestTokens: GuestTokenService,
    private readonly settings: SettingsService,
    private readonly documents: DocumentService,
    private readonly invoicing: InvoicingService,
    private readonly events: EventEmitter2,
  ) {
    this.razorpay = new Razorpay({
      key_id: this.config.get<string>('RAZORPAY_KEY_ID', ''),
      key_secret: this.config.get<string>('RAZORPAY_KEY_SECRET', ''),
    });
  }

  /**
   * Best-effort realtime emit of a committed order change. Called ONLY after the
   * mutating transaction has committed. Swallows any emitter error so realtime
   * can never poison the order/payment business path (Section 6).
   */
  private emitOrderUpdated(order: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    paymentStatus: OrderPaymentStatus;
    customerId: string | null;
  }): void {
    try {
      this.events.emit(ORDER_UPDATED_EVENT, {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        customerId: order.customerId,
      } satisfies OrderUpdatedEvent);
    } catch (e) {
      this.logger.warn(
        `order.updated emit failed for ${order.orderNumber}: ${(e as Error)?.message}`,
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CHECKOUT (POST /api/store/checkout) — architecture 4.6 / 5.1 / 5.2 / 8.4
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Create an order from the resolved cart and mint a Razorpay order for it. THE
   * transactional core.
   *
   * The ENTIRE order build runs in ONE this.prisma.$transaction so that if any
   * step throws (no fulfillable warehouse, insufficient stock, coupon exhausted,
   * digital SKU, etc.) the whole thing rolls back BEFORE any Razorpay charge is
   * created — we NEVER mint a Razorpay order for a doomed checkout.
   *
   * The Razorpay order is created AFTER the DB transaction commits, then the
   * razorpayOrderId is patched onto the order. If Razorpay creation fails, the
   * order is left PENDING_PAYMENT with the reservation TTL; the reservation cron
   * releases the held stock and cancels the order, so no stock is permanently
   * leaked and the customer is never charged.
   */
  async checkout(actor: CheckoutActor, dto: CheckoutDto) {
    const cartId = await this.resolveCartId(actor);

    // Snapshot addresses BEFORE the tx (pure validation/normalization).
    const shipping = dto.shippingAddress;
    const billing = dto.billingAddress ?? dto.shippingAddress;
    const buyerStateCode = TaxService.normalizeStateCode(shipping.stateCode);
    if (!buyerStateCode) {
      throw new BadRequestException(
        'Shipping stateCode must be a 2-digit GST state code',
      );
    }

    // Normalize guest contact ONCE (lowercase + trim email) so the persisted
    // Order/Customer rows, the admin search index, and the coupon anti-farming
    // dedup key (CouponRedemption.redeemerEmail, normalized lowercase) all agree
    // — otherwise 'User@Ex.com' vs 'user@ex.com' could bypass the per-customer
    // coupon cap or fragment the order search.
    const guestEmail = dto.guestEmail?.trim().toLowerCase() || undefined;
    const guestPhone = dto.guestPhone?.trim() || undefined;

    // Resolve the seller identity (single seller; SiteSettings) ONCE, before the
    // tx, so we never hold a DB transaction open over settings round-trips.
    const sellerStateCode = await this.tax.resolveSellerStateCode();
    const sellerGstin =
      (await this.settings.get(SELLER_GSTIN_SETTING_KEY))?.trim() ?? null;

    // ── Phase 1: seed from the cart (read; checkout re-prices authoritatively).
    const seed = await this.cart.getCartForCheckout(cartId);
    if (seed.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Hard-block DIGITAL SKUs at checkout (Section 8.10) and assert purchasable.
    for (const it of seed.items) {
      const sku = it.sku;
      if (sku.product.type === ProductType.DIGITAL) {
        throw new UnprocessableEntityException(
          'DIGITAL_NOT_AVAILABLE: digital products cannot be purchased at this time',
        );
      }
      if (!sku.isActive || sku.product.status !== ProductStatus.ACTIVE) {
        throw new BadRequestException(
          'One or more items in your cart are no longer available for purchase',
        );
      }
    }

    // ── Phase 2: allocate the single fulfilling warehouse (unlocked read; the
    // authoritative re-check happens under the reservation locks). 409 if none.
    const allocationLines = seed.items.map((it) => ({
      skuId: it.skuId,
      qty: it.quantity,
    }));
    const warehouseId = await this.inventory.allocateWarehouse(allocationLines);

    // Batch-fetch the SKU SNAPSHOT fields (skuCode/name/variant/product name) the
    // cart's pricing projection omits — these are frozen onto each OrderItem so the
    // order survives catalog edits / SKU deletion.
    const skuIds = [...new Set(seed.items.map((it) => it.skuId))];
    const snapshotRows = await this.prisma.sku.findMany({
      where: { id: { in: skuIds } },
      select: {
        id: true,
        skuCode: true,
        name: true,
        variantAttributes: true,
        product: { select: { name: true } },
      },
    });
    const snapshotById = new Map(snapshotRows.map((s) => [s.id, s]));

    // ── Phase 3: re-price each line server-side (NEVER trust cart snapshots).
    const priced = seed.items.map((it) => {
      const unitPrice = resolveUnitPriceShared(it.sku, it.quantity);
      const lineSubtotal = unitPrice * it.quantity;
      const snap = snapshotById.get(it.skuId);
      if (!snap) {
        throw new BadRequestException(
          'One or more items in your cart are no longer available for purchase',
        );
      }
      return {
        skuId: it.skuId,
        sku: it.sku,
        snapshot: snap,
        quantity: it.quantity,
        unitPrice,
        lineSubtotal,
      };
    });
    const itemsSubtotal = priced.reduce((s, l) => s + l.lineSubtotal, 0);
    if (itemsSubtotal <= 0) {
      throw new BadRequestException('Cart total must be greater than zero');
    }

    // ── Phase 4: validate coupon (preview) BEFORE the tx; redeem INSIDE it.
    let couponId: string | null = null;
    let couponCode: string | null = null;
    let couponDiscount = 0;
    if (seed.couponId) {
      const validated = await this.validateAttachedCoupon(
        seed.couponId,
        actor,
        itemsSubtotal,
      );
      if (validated) {
        couponId = validated.couponId;
        couponCode = validated.code;
        couponDiscount = Math.min(validated.discountPaise, itemsSubtotal);
      }
      // If the attached coupon no longer validates we proceed WITHOUT it rather
      // than fail the whole checkout (the cart preview is advisory). Persisted
      // discount is 0 then.
    }

    // ── Phase 5: apportion discount across lines pro-rata so per-line taxable +
    // GST are correct and shares sum exactly to the discounted total.
    const lineDiscounts = apportionShared(
      priced.map((l) => l.lineSubtotal),
      couponDiscount,
    );

    // ── Phase 6: compute GST once (buyer vs seller state) over per-line taxable
    // values. The per-line results are persisted on OrderItem (single source of
    // truth for the invoice — never re-computed).
    const taxLines = priced.map((l, i) => ({
      taxableValuePaise: Math.max(0, l.lineSubtotal - (lineDiscounts[i] ?? 0)),
      taxClassId: l.sku.taxClassId,
      hsnCode: l.sku.hsnCode,
    }));
    const taxResults = await this.tax.computeTax(
      taxLines,
      buyerStateCode,
      sellerStateCode,
    );

    const isInterState = buyerStateCode !== sellerStateCode;

    // Assemble the OrderItem create rows + running totals.
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;
    const orderItemsData = priced.map((l, i) => {
      const lineDiscount = lineDiscounts[i] ?? 0;
      const taxableValue = Math.max(0, l.lineSubtotal - lineDiscount);
      const t = taxResults[i];
      cgstTotal += t.cgstAmount;
      sgstTotal += t.sgstAmount;
      igstTotal += t.igstAmount;
      const lineTax = t.cgstAmount + t.sgstAmount + t.igstAmount;
      return {
        skuId: l.skuId,
        skuCodeSnapshot: l.snapshot.skuCode,
        nameSnapshot:
          l.snapshot.name ?? l.snapshot.product?.name ?? l.snapshot.skuCode,
        variantSnapshot:
          (l.snapshot.variantAttributes as Prisma.InputJsonValue | undefined) ??
          undefined,
        hsnCodeSnapshot: l.sku.hsnCode,
        gstBpsSnapshot: t.cgstBps + t.sgstBps + t.igstBps,
        cgstBpsSnapshot: t.cgstBps,
        sgstBpsSnapshot: t.sgstBps,
        igstBpsSnapshot: t.igstBps,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineSubtotal: l.lineSubtotal,
        lineDiscount,
        taxableValue,
        cgstAmount: t.cgstAmount,
        sgstAmount: t.sgstAmount,
        igstAmount: t.igstAmount,
        lineTotal: taxableValue + lineTax,
        warehouseId,
      };
    });

    const taxTotal = cgstTotal + sgstTotal + igstTotal;
    const discountTotal = couponDiscount;
    const shippingTotal = 0; // flat-rate shipping not in v1 scope
    const grandTotal =
      Math.max(0, itemsSubtotal - discountTotal) + taxTotal + shippingTotal;

    // Reservation lines (one per priced line; coalesced inside reserveMany).
    const stockLines: StockLine[] = priced.map((l) => ({
      skuId: l.skuId,
      warehouseId,
      qty: l.quantity,
    }));

    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);

    // Pre-generate the Order id so the guest order-access token embeds the REAL
    // order id in its JWT payload (not a throwaway nonce). The token is minted up
    // front so its hash can be persisted in the same insert, and the raw token is
    // returned to the client once. Passing this id explicitly as Order.id keeps
    // the token's `orderId` claim and the persisted Order.id identical, so any
    // path that trusts the claim resolves the correct order.
    const orderId = crypto.randomUUID();
    const guestToken =
      actor.isGuest && !actor.customerId
        ? this.guestTokens.mintOrderToken(orderId)
        : null;

    // ── Phase 7: THE single transaction. Any throw rolls everything back
    // BEFORE Razorpay is ever called.
    //
    // IDEMPOTENCY (architecture 8.1 — "reuse verbatim: advisory-lock + 15-min
    // reuse window on order create", mirroring payment.service.ts L88-147): the
    // FIRST statement takes a tx-scoped advisory lock keyed on the cart id so two
    // rapid concurrent checkouts of the SAME cart (double-submit on a slow
    // network) fully serialize for the lifetime of the tx. The winner creates
    // the order + converts the cart; the loser then runs AFTER the winner
    // committed and takes one of two safe paths:
    //   (a) REGISTERED customer — its customerId is stable across the two
    //       attempts, so it finds the winner's live PENDING_PAYMENT order within
    //       the reuse window and REUSES it (no duplicate order / reservation /
    //       Razorpay order). `reused` short-circuits Phase 8.
    //   (b) GUEST — a fresh GUEST Customer is minted per attempt so there is no
    //       stable customer key to match on; the cart is already CONVERTED, so
    //       `markConverted`'s CAS (step 4) fails and the whole tx rolls back with
    //       a clean 409 — still no duplicate order, reservation, or charge.
    let reused = false;
    // Deferred realtime stock emits: reserveMany runs INSIDE this tx, so it must
    // not emit until we commit. It drains the post-commit payloads here; we flush
    // them to the bus only after the $transaction resolves successfully.
    const stockEmitSink: StockUpdatedEvent[] = [];
    const created = await this.prisma.$transaction(async (tx) => {
      // Serialize same-cart checkout attempts for the lifetime of this tx.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store_checkout_${cartId}`}))`;

      // Re-check INSIDE the lock (registered customers only): did a concurrent
      // winner already mint a live unpaid order from THIS SAME CART within the
      // reuse window? If so, reuse it verbatim. Keying on cartId (not just
      // customerId + grandTotal) is what guarantees correctness: two DISTINCT
      // carts of the same customer with an identical total within the window can
      // never collapse onto one order — a different cart never reuses another
      // cart's pending order. grandTotal is kept as a belt-and-suspenders guard,
      // and razorpayOrderId not null ensures we only reuse an order that already
      // has a live Razorpay order to hand back (no half-built order).
      if (actor.customerId) {
        const existing = await tx.order.findFirst({
          where: {
            cartId,
            status: OrderStatus.PENDING_PAYMENT,
            razorpayOrderId: { not: null },
            grandTotal,
            createdAt: { gte: new Date(Date.now() - ORDER_REUSE_WINDOW_MS) },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) {
          reused = true;
          return existing;
        }
      }

      // Ensure a Customer row exists (guest checkout also needs one — the
      // CouponRedemption + Order FKs are non-nullable on customerId).
      const customerId = await this.ensureCustomer(tx, actor, {
        shipping,
        guestEmail,
        guestPhone,
      });

      // Allocate the gapless order number INSIDE the tx (Phase 7) so a rollback
      // also rolls back the sequence bump — no permanently-consumed number / gap.
      const orderNumber = await this.nextNumber(tx, 'ORDER', 'AO');

      // (1) create the Order PENDING_PAYMENT with the frozen seller identity. The
      // id is the pre-generated orderId embedded in the guest token's JWT payload.
      const order = await tx.order.create({
        data: {
          id: orderId,
          orderNumber,
          customerId,
          // The cart this order was minted from — the key the reuse query above
          // matches on so a different cart never collapses onto this order.
          cartId,
          guestEmail: actor.isGuest ? (guestEmail ?? null) : null,
          guestPhone: actor.isGuest ? (guestPhone ?? null) : null,
          guestAccessTokenHash: guestToken?.hash ?? null,
          status: OrderStatus.PENDING_PAYMENT,
          paymentStatus: OrderPaymentStatus.UNPAID,
          currency: 'INR',
          itemsSubtotal,
          discountTotal,
          cgstTotal,
          sgstTotal,
          igstTotal,
          taxTotal,
          shippingTotal,
          grandTotal,
          refundedTotal: 0,
          couponId,
          couponCodeSnapshot: couponCode,
          billingAddress: OrdersService.addressJson(billing),
          shippingAddress: OrdersService.addressJson(shipping),
          placeOfSupplyState: buyerStateCode,
          sellerStateCode,
          sellerGstinSnapshot: sellerGstin,
          isInterState,
          fulfilledFromWarehouseId: warehouseId,
          placedAt: new Date(),
          items: { create: orderItemsData },
        },
      });

      // (2) reserve stock under globally-ordered locks (authoritative re-check).
      // emitSink defers the stock.updated realtime emits until after THIS tx
      // commits (Section 6: never emit inside the tx).
      await this.inventory.reserveMany(tx, stockLines, {
        orderId: order.id,
        expiresAt,
        actor: { id: customerId, role: 'CUSTOMER' },
        referenceType: 'ORDER',
        emitSink: stockEmitSink,
      });

      // (3) redeem the coupon atomically (CAS usedCount + per-email cap).
      if (couponId) {
        await this.coupons.redeemCoupon(tx, {
          couponId,
          orderId: order.id,
          discountPaise: couponDiscount,
          customerId,
          email: actor.email?.trim().toLowerCase() ?? guestEmail ?? undefined,
          phone: actor.phone ?? guestPhone ?? undefined,
        });
      }

      // (4) mark the cart CONVERTED (CAS-guarded; double-checkout → 409).
      await this.cart.markConverted(tx, cartId);

      // (5) audit: order CREATED.
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: OrderEventType.CREATED,
          toStatus: OrderStatus.PENDING_PAYMENT,
          triggeredBy: customerId,
          actorRole: actor.isGuest ? 'GUEST' : 'CUSTOMER',
          note: `Order created${couponCode ? ` with coupon ${couponCode}` : ''}`,
        },
      });

      return order;
    });

    // ── Post-commit realtime (Section 6). Drain the deferred stock emits and
    // announce the new order. Skipped on the reuse path (no new mutation —
    // `created` is a pre-existing order, its events were already emitted on the
    // winning attempt). Best-effort: the inventory helper swallows emit errors,
    // and emitOrderUpdated does too, so realtime never affects the checkout result.
    if (!reused) {
      if (stockEmitSink.length > 0) {
        this.inventory.publishStockChanges(stockEmitSink);
      }
      this.emitOrderUpdated({
        id: created.id,
        orderNumber: created.orderNumber,
        status: created.status,
        paymentStatus: created.paymentStatus,
        customerId: created.customerId,
      });
    }

    // ── Phase 8: create the Razorpay order AFTER commit (never inside the tx).
    // On the reuse path the order ALREADY carries a live razorpayOrderId, so we
    // return it verbatim and never mint a second Razorpay order. The reused
    // order's guest token hash was minted on the first attempt and is NOT
    // recoverable here (we only persisted its hash), so we omit guestOrderToken
    // on reuse — the original checkout response already returned the raw token.
    if (reused) {
      return {
        orderId: created.id,
        orderNumber: created.orderNumber,
        razorpayOrderId: created.razorpayOrderId as string,
        amount: created.grandTotal,
        currency: created.currency,
        key: this.config.get<string>('RAZORPAY_KEY_ID', ''),
      };
    }

    let razorpayOrderId: string;
    try {
      const rzpOrder = await this.razorpay.orders.create({
        amount: grandTotal, // integer paise
        currency: 'INR',
        receipt: `order_${created.orderNumber}`,
        notes: { surface: 'store', orderId: created.id },
      });
      razorpayOrderId = rzpOrder.id;
      await this.prisma.order.update({
        where: { id: created.id },
        data: { razorpayOrderId },
      });
    } catch (e) {
      // The order is committed PENDING_PAYMENT with its reservation TTL. The
      // reservation cron will release the held stock and cancel the order, so no
      // stock leaks and no charge ever happens. Surface a clean error.
      this.logger.error(
        `Razorpay order creation failed for ${created.orderNumber}: ${(e as Error)?.message}`,
      );
      throw new InternalServerErrorException(
        'Could not initiate payment — please try again',
      );
    }

    return {
      orderId: created.id,
      orderNumber: created.orderNumber,
      razorpayOrderId,
      amount: grandTotal,
      currency: 'INR',
      key: this.config.get<string>('RAZORPAY_KEY_ID', ''),
      ...(guestToken ? { guestOrderToken: guestToken.token } : {}),
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  WEBHOOK (POST /api/store/webhooks/razorpay) — architecture 8.1 / 5.2
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Handle a Razorpay store webhook. Verifies HMAC-SHA256 over the RAW body with
   * RAZORPAY_STORE_WEBHOOK_SECRET (timingSafeEqual, fail-closed). OWNERSHIP-
   * FILTERED: an event whose order is not a store Order is acked-and-ignored so
   * pledge Payments are never touched.
   *
   * payment.captured: exactly-once CAS PENDING→PAID, commit reservations
   * (reserved→onHand decrement + OUT movement), Order→CONFIRMED, OrderEvent,
   * best-effort notification + invoice.
   * payment.failed: release reservations + Order→PAYMENT_FAILED-equivalent
   * (CANCELLED, since there is no PAYMENT_FAILED OrderStatus enum member).
   */
  async handleWebhook(signature: string, rawBody: Buffer | string) {
    const secret = this.config.get<string>('RAZORPAY_STORE_WEBHOOK_SECRET');
    if (!secret) {
      // Fail-closed (matches payment.service): a missing secret means we CANNOT
      // verify authenticity, so we never act on the event. NOTE: a 500 makes
      // Razorpay retry, which can flood logs during a misconfiguration — but
      // validateEnv() requires RAZORPAY_STORE_WEBHOOK_SECRET in production (see
      // app.module.ts), so this branch is only reachable in a misconfigured dev
      // env, where loud failure is the desired signal.
      this.logger.error(
        'RAZORPAY_STORE_WEBHOOK_SECRET not configured; rejecting store webhook',
      );
      throw new InternalServerErrorException(
        'Store payment webhook secret not configured',
      );
    }

    const bodyBuf = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(typeof rawBody === 'string' ? rawBody : '');

    const expected = crypto
      .createHmac('sha256', secret)
      .update(bodyBuf)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    // Constant-time compare that does NOT short-circuit on a length mismatch: copy
    // the received signature into a fixed-length buffer (same length as expected)
    // so timingSafeEqual always runs over equal-length buffers, then AND in the
    // real-length check. A caller cannot distinguish "wrong length" from "right
    // length, wrong value" by timing the length branch.
    const receivedRaw = Buffer.from(signature ?? '', 'utf8');
    const receivedPadded = Buffer.alloc(expectedBuf.length);
    receivedRaw.copy(receivedPadded);
    const ok =
      crypto.timingSafeEqual(expectedBuf, receivedPadded) &&
      receivedRaw.length === expectedBuf.length;
    if (!ok) {
      throw new BadRequestException('Invalid webhook signature');
    }

    let parsed: RazorpayWebhookEnvelope;
    try {
      parsed = JSON.parse(bodyBuf.toString('utf8')) as RazorpayWebhookEnvelope;
    } catch {
      throw new BadRequestException('Malformed webhook body');
    }
    const event = parsed.event;
    const paymentEntity = parsed.payload?.payment?.entity;

    // Only payment.* events carry an order_id we can match. Anything else (or a
    // refund event, which the returns module owns) is acked-and-ignored.
    if (event !== 'payment.captured' && event !== 'payment.failed') {
      return { received: true };
    }
    const razorpayOrderId: string | undefined = paymentEntity?.order_id;
    if (!razorpayOrderId) {
      return { received: true };
    }

    // OWNERSHIP FILTER: is this a STORE order? If not (e.g. a pledge order on the
    // shared Razorpay account), ack and ignore — never touch pledge Payments.
    const order = await this.prisma.order.findUnique({
      where: { razorpayOrderId },
    });
    if (!order) {
      return { received: true };
    }

    if (event === 'payment.captured') {
      await this.handleCaptured(order, paymentEntity);
    } else {
      await this.handleFailed(order, paymentEntity);
    }

    return { received: true };
  }

  /** Exactly-once PENDING→PAID promote + stock commit + CONFIRMED. */
  private async handleCaptured(
    order: Order,
    paymentEntity: RazorpayPaymentEntity | undefined,
  ) {
    // Idempotency advisory check (the real dedupe is the CAS below).
    if (order.paymentStatus === OrderPaymentStatus.PAID) {
      return;
    }

    // Verify the captured amount/currency matches what we charged (paise).
    if (
      Number(paymentEntity?.amount) !== order.grandTotal ||
      paymentEntity?.currency !== order.currency
    ) {
      this.logger.error(
        `Store capture amount/currency mismatch on order ${order.orderNumber}: ` +
          `expected ${order.grandTotal} ${order.currency}, got ${paymentEntity?.amount} ${paymentEntity?.currency}; NOT confirming`,
      );
      return;
    }

    // Deferred stock emits: commitReservation runs inside the capture tx.
    const stockEmitSink: StockUpdatedEvent[] = [];
    const promoted = await this.prisma.$transaction(async (tx) => {
      // Exactly-once CAS: PENDING_PAYMENT → PAID/CONFIRMED. A duplicate delivery
      // sees count 0 and no-ops.
      const flip = await tx.order.updateMany({
        where: { id: order.id, status: OrderStatus.PENDING_PAYMENT },
        data: {
          status: OrderStatus.CONFIRMED,
          paymentStatus: OrderPaymentStatus.PAID,
          razorpayPaymentId: paymentEntity?.id ?? null,
          paidAt: new Date(),
        },
      });
      if (flip.count !== 1) {
        return false;
      }

      // Fetch reservations INSIDE the tx (not before it): a concurrent
      // reservation-expiry cron may have flipped a row to EXPIRED between an outer
      // read and this loop. Reading here, after the CAS flip won, means we only
      // act on rows that are ACTIVE at commit time. commitReservation additionally
      // CAS-guards each (sku,wh) under its own ordered advisory lock.
      const reservations = await tx.stockReservation.findMany({
        where: { orderId: order.id, status: ReservationStatus.ACTIVE },
        select: { id: true },
      });

      // Commit every active reservation (reserved→onHand decrement + OUT/SALE).
      // emitSink defers the stock.updated emits until after this tx commits.
      for (const r of reservations) {
        await this.inventory.commitReservation(tx, r.id, {
          actor: { id: 'SYSTEM', role: 'SYSTEM' },
          emitSink: stockEmitSink,
        });
      }

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: OrderEventType.PAYMENT_CAPTURED,
          fromStatus: OrderStatus.PENDING_PAYMENT,
          toStatus: OrderStatus.CONFIRMED,
          triggeredBy: 'SYSTEM',
          actorRole: 'SYSTEM',
          note: `Payment captured (${paymentEntity?.id ?? 'unknown'})`,
          metadata: { razorpayPaymentId: paymentEntity?.id ?? null },
        },
      });
      return true;
    });

    if (!promoted) {
      return; // duplicate delivery already confirmed this order
    }

    // ── Post-commit realtime (Section 6): the order is now CONFIRMED/PAID and the
    // sale decrements are committed. Flush the deferred stock emits and announce
    // the order's new state to the admin + order + customer rooms.
    if (stockEmitSink.length > 0) {
      this.inventory.publishStockChanges(stockEmitSink);
    }
    this.emitOrderUpdated({
      id: order.id,
      orderNumber: order.orderNumber,
      status: OrderStatus.CONFIRMED,
      paymentStatus: OrderPaymentStatus.PAID,
      customerId: order.customerId,
    });

    // Best-effort, AFTER commit: notification + invoice. Never throw out of the
    // webhook (matches payment.service).
    await this.fireOrderConfirmation(order.id).catch((e) =>
      this.logger.error(
        `order-confirmation notify failed for ${order.orderNumber}: ${(e as Error)?.message}`,
      ),
    );
    await this.invoicing
      .generateInvoice(order.id)
      .catch((e) =>
        this.logger.error(
          `Invoice generation failed for ${order.orderNumber}: ${(e as Error)?.message}`,
        ),
      );
  }

  /** payment.failed: release reservations + mark the order CANCELLED. */
  private async handleFailed(
    order: Order,
    paymentEntity: RazorpayPaymentEntity | undefined,
  ) {
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      return; // already paid/confirmed/cancelled — ignore a late failure
    }

    // Deferred stock emits: releaseReservation runs inside the cancel tx.
    const stockEmitSink: StockUpdatedEvent[] = [];
    const cancelled = await this.prisma.$transaction(async (tx) => {
      // No PAYMENT_FAILED member in OrderPaymentStatus; the failed payment leaves
      // paymentStatus UNPAID and flips the order to CANCELLED (stock released).
      const flip = await tx.order.updateMany({
        where: { id: order.id, status: OrderStatus.PENDING_PAYMENT },
        data: { status: OrderStatus.CANCELLED },
      });
      if (flip.count !== 1) {
        return false;
      }
      // Fetch reservations INSIDE the tx after the CANCEL CAS won (see
      // handleCaptured) so we only release rows still ACTIVE at commit time.
      const reservations = await tx.stockReservation.findMany({
        where: { orderId: order.id, status: ReservationStatus.ACTIVE },
        select: { id: true },
      });
      for (const r of reservations) {
        await this.inventory.releaseReservation(tx, r.id, {
          actor: { id: 'SYSTEM', role: 'SYSTEM' },
          emitSink: stockEmitSink,
        });
      }
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: OrderEventType.PAYMENT_FAILED,
          fromStatus: OrderStatus.PENDING_PAYMENT,
          toStatus: OrderStatus.CANCELLED,
          triggeredBy: 'SYSTEM',
          actorRole: 'SYSTEM',
          note: `Payment failed (${paymentEntity?.id ?? 'unknown'})`,
        },
      });
      return true;
    });

    if (!cancelled) {
      return; // concurrent transition already finalized this order
    }

    // ── Post-commit realtime (Section 6): order CANCELLED, holds released.
    if (stockEmitSink.length > 0) {
      this.inventory.publishStockChanges(stockEmitSink);
    }
    this.emitOrderUpdated({
      id: order.id,
      orderNumber: order.orderNumber,
      status: OrderStatus.CANCELLED,
      paymentStatus: order.paymentStatus,
      customerId: order.customerId,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  STATE MACHINE (exposed to siblings) — architecture CONTRACT
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Validated order state-machine transition + OrderEvent audit. CANCELLED from a
   * pre-shipped state releases active reservations AND restocks any committed
   * stock (so a paid-then-cancelled order returns its units). EXPOSED for the
   * fulfillment/returns siblings.
   *
   * @param opts.deliveredAt when transitioning to DELIVERED, stamps
   *   Order.deliveredAt ATOMICALLY in the same update (the 7-day returns window
   *   anchors on this — it must never be mutated in a separate, unlocked write).
   *   Only applied when toStatus is DELIVERED and deliveredAt is currently null.
   * @param opts.tx run inside an EXISTING transaction (and its advisory lock)
   *   instead of opening a new one. Callers that must commit the transition
   *   atomically with their own writes (e.g. the shipping ship() flow creating a
   *   Shipment in the same tx) pass their TransactionClient so this stays the
   *   single source of truth for the allowed hops without nesting $transaction.
   *   The caller is responsible for taking the `order_status_{orderId}` advisory
   *   lock before calling with its own tx (ship() takes it).
   *
   * @throws NotFoundException order does not exist
   * @throws ConflictException illegal transition for the current status
   */
  async transitionStatus(
    orderId: string,
    toStatus: OrderStatus,
    actor: OrderActor,
    note?: string,
    opts?: { deliveredAt?: Date; tx?: Prisma.TransactionClient },
  ) {
    // When the caller supplies its own transaction we run the core inline (the
    // caller owns the advisory lock + commit boundary); otherwise we open our own
    // transaction and take the per-order advisory lock here.
    //
    // REALTIME (Section 6): we may only emit AFTER commit. On the own-tx path we
    // own the commit, so we drain a deferred sink + emit once the $transaction
    // resolves. On the FORWARDED-tx path the caller (e.g. shipping ship()) owns
    // the commit and the store-realtime lane must not edit shipping.service.ts, so
    // we do NOT emit here — that caller's own realtime (shipment.updated, owned by
    // store-jobs) covers it, and emitting a not-yet-committed value would violate
    // the after-commit rule.
    if (opts?.tx) {
      return this.transitionStatusInTx(
        opts.tx,
        orderId,
        toStatus,
        actor,
        note,
        {
          deliveredAt: opts.deliveredAt,
          ownLock: false,
        },
      );
    }

    const stockEmitSink: StockUpdatedEvent[] = [];
    const updated = await this.prisma.$transaction((tx) =>
      this.transitionStatusInTx(tx, orderId, toStatus, actor, note, {
        deliveredAt: opts?.deliveredAt,
        ownLock: true,
        stockEmitSink,
      }),
    );

    // Post-commit realtime. A no-op transition (from === toStatus) leaves the sink
    // empty and re-announces the unchanged state harmlessly.
    if (stockEmitSink.length > 0) {
      this.inventory.publishStockChanges(stockEmitSink);
    }
    this.emitOrderUpdated({
      id: updated.id,
      orderNumber: updated.orderNumber,
      status: updated.status,
      paymentStatus: updated.paymentStatus,
      customerId: updated.customerId,
    });

    return updated;
  }

  /**
   * Core state-machine transition, executed against a given transaction client.
   * Shared by the standalone public path (which opens its own tx + lock) and the
   * tx-forwarding path (ship() supplies its tx + has already taken the lock).
   */
  private async transitionStatusInTx(
    tx: Prisma.TransactionClient,
    orderId: string,
    toStatus: OrderStatus,
    actor: OrderActor,
    note: string | undefined,
    opts: {
      deliveredAt?: Date;
      ownLock: boolean;
      /** Sink for deferred stock emits (own-tx path only; flushed post-commit). */
      stockEmitSink?: StockUpdatedEvent[];
    },
  ) {
    // Lock the order row for the duration of the transition so two concurrent
    // admin actions can't both flip from the same source status. When a caller
    // forwards its own tx it MUST have already taken this exact lock.
    //
    // DEADLOCK INVARIANT (architecture 5.1): on a CANCEL this method calls
    // releaseOrRestockForCancel, which in turn calls inventory.releaseReservation
    // / inventory.restock — each acquires a per-(sku,warehouse) advisory lock.
    // Safety relies ENTIRELY on inventory acquiring those (sku,wh) locks in the
    // GLOBAL ascending order (skuId, then warehouseId) it documents in §5.1. Do
    // NOT call transitionStatus from a path that already holds a (sku,wh)
    // advisory lock in a different order, or a lock-cycle deadlock becomes
    // possible. The order_status_{orderId} lock here is disjoint from the stock
    // locks (different key space) so it does not itself participate in any cycle.
    if (opts.ownLock) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order_status_${orderId}`}))`;
    }

    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    const from = order.status;
    if (from === toStatus) {
      return order; // idempotent no-op
    }
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new ConflictException(
        `Illegal order transition ${from} → ${toStatus}`,
      );
    }

    // CANCEL from a pre-shipped state: free the held/committed stock.
    if (toStatus === OrderStatus.CANCELLED && PRE_SHIPPED_STATUSES.has(from)) {
      await this.releaseOrRestockForCancel(
        tx,
        order,
        actor,
        opts.stockEmitSink,
      );
    }

    // paymentStatus is left untouched here: an unpaid cancel stays UNPAID; a
    // paid cancel keeps PAID until a refund flips it via refundOrder (the
    // OrderPaymentStatus enum has no CANCELLED/FAILED member).
    //
    // deliveredAt is stamped ATOMICALLY with the DELIVERED flip (never in a
    // separate write): the 7-day returns window anchors on it, so it must be set
    // exactly once, under this lock. Only set it when delivering and when it is
    // still null so a re-delivered/late webhook never overwrites the first stamp.
    const data: Prisma.OrderUpdateInput = { status: toStatus };
    if (
      toStatus === OrderStatus.DELIVERED &&
      opts.deliveredAt &&
      order.deliveredAt === null
    ) {
      data.deliveredAt = opts.deliveredAt;
    }
    const updated = await tx.order.update({
      where: { id: orderId },
      data,
    });

    await tx.orderEvent.create({
      data: {
        orderId,
        type: OrdersService.eventTypeFor(toStatus),
        fromStatus: from,
        toStatus,
        triggeredBy: actor.id,
        actorRole: actor.role ?? null,
        note: note ?? null,
      },
    });

    return updated;
  }

  /**
   * Refund (a portion of) an order via Razorpay, with a cumulative-cap guard.
   * EXPOSED for the returns sibling per the CONTRACT.
   *
   * RESERVE-THEN-EXECUTE (architecture 5.2 / 8.1): the Razorpay refund API call
   * must NOT run inside a held DB transaction (an external HTTP round-trip would
   * pin a Postgres tx + connection open under load, and a network timeout would
   * abort the tx). The reference payment.service.ts keeps the create-order API
   * call inside the lock only because there is nothing to "reserve"; a refund
   * mutates money, so we instead:
   *
   *   1. Tx-1 (short, advisory-locked `order_refund_{orderId}`): re-assert the
   *      order is paid + refundable, assert the cumulative cap, then CAS-bump
   *      `refundedTotal` to RESERVE the amount and write a REFUND_INITIATED
   *      event. Committing the bump under the lock is what serializes concurrent
   *      refunds — two callers cannot both reserve past the cap. Commit.
   *   2. Outside any tx: call the Razorpay refund API (no DB lock held).
   *   3a. On API success — Tx-2 (short): flip status / paymentStatus to
   *       (PARTIALLY_)REFUNDED and write the REFUNDED event with the
   *       razorpayRefundId. The reservation already moved the money.
   *   3b. On API failure — compensating Tx: CAS-release the reserved amount
   *       (revert `refundedTotal`) and write a REFUND_INITIATED note recording
   *       the failure, so a failed attempt never permanently consumes cap.
   *
   * Idempotency across the API gap is guarded by the CAS on `refundedTotal` and
   * the per-Return `razorpayRefundId @unique` backstop (owned by the returns
   * module). Callers in the returns flow pass a Return context.
   */
  async refundOrder(args: {
    orderId: string;
    amountPaise: number;
    reason: string;
    actorId: string;
  }): Promise<{ razorpayRefundId: string; refundedTotal: number }> {
    if (!Number.isInteger(args.amountPaise) || args.amountPaise <= 0) {
      throw new BadRequestException('Refund amount must be a positive integer');
    }

    // ── Step 1: RESERVE the refund amount under the per-order refund lock. The
    // cap assert + CAS-bump are serialized so two concurrent refunds cannot both
    // pass the cap. No external call happens while the lock is held.
    const reserved = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order_refund_${args.orderId}`}))`;

      const order = await tx.order.findUnique({ where: { id: args.orderId } });
      if (!order) throw new NotFoundException('Order not found');
      // Re-assert refundability INSIDE the lock (defense-in-depth against a
      // concurrent transition between any earlier read and here).
      if (!order.razorpayPaymentId) {
        throw new BadRequestException(
          'Order has no captured payment to refund',
        );
      }
      if (order.paymentStatus === OrderPaymentStatus.UNPAID) {
        throw new BadRequestException('Order is not paid');
      }

      const newRefundedTotal = order.refundedTotal + args.amountPaise;
      if (newRefundedTotal > order.grandTotal) {
        throw new ConflictException(
          `REFUND_EXCEEDS_TOTAL: refunding ${args.amountPaise} would exceed the collected amount ` +
            `(already refunded ${order.refundedTotal} of ${order.grandTotal})`,
        );
      }

      // CAS-bump refundedTotal guarded on the value we read (reserves the amount;
      // a racing refund that slipped the lock is rejected rather than over-applied).
      const bump = await tx.order.updateMany({
        where: { id: order.id, refundedTotal: order.refundedTotal },
        data: { refundedTotal: newRefundedTotal },
      });
      if (bump.count !== 1) {
        throw new ConflictException('Concurrent refund detected; please retry');
      }

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: OrderEventType.REFUND_INITIATED,
          triggeredBy: args.actorId,
          note: `Refund of ${args.amountPaise} paise reserved (${args.reason})`,
          metadata: {
            amountPaise: args.amountPaise,
            previousRefundedTotal: order.refundedTotal,
          },
        },
      });

      return {
        razorpayPaymentId: order.razorpayPaymentId,
        orderNumber: order.orderNumber,
        previousRefundedTotal: order.refundedTotal,
        newRefundedTotal,
        grandTotal: order.grandTotal,
      };
    });

    // ── Step 2: issue the Razorpay refund OUTSIDE any transaction / lock.
    let razorpayRefundId: string;
    try {
      const refund = await this.razorpay.payments.refund(
        reserved.razorpayPaymentId,
        {
          amount: args.amountPaise,
          notes: {
            surface: 'store',
            orderId: args.orderId,
            reason: args.reason,
          },
        },
      );
      razorpayRefundId = refund.id;
    } catch (e) {
      // ── Step 3b: COMPENSATE — the API failed, so release the reserved amount
      // (revert refundedTotal) under the lock so a failed attempt never burns cap.
      this.logger.error(
        `Razorpay refund failed for order ${reserved.orderNumber}: ${(e as Error)?.message}`,
      );
      await this.prisma
        .$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order_refund_${args.orderId}`}))`;
          const released = await tx.order.updateMany({
            where: {
              id: args.orderId,
              refundedTotal: reserved.newRefundedTotal,
            },
            data: { refundedTotal: reserved.previousRefundedTotal },
          });
          await tx.orderEvent.create({
            data: {
              orderId: args.orderId,
              type: OrderEventType.REFUND_INITIATED,
              triggeredBy: args.actorId,
              note: `Refund of ${args.amountPaise} paise FAILED at Razorpay; ${
                released.count === 1
                  ? 'reserved amount released'
                  : 'reservation could not be released (NEEDS_RECONCILIATION)'
              }`,
              metadata: {
                amountPaise: args.amountPaise,
                failed: true,
                released: released.count === 1,
              },
            },
          });
        })
        .catch((ce) =>
          this.logger.error(
            `Failed to release reserved refund for order ${reserved.orderNumber}: ${(ce as Error)?.message}`,
          ),
        );
      throw new InternalServerErrorException('Refund could not be processed');
    }

    // ── Step 3a: API succeeded — finalize the order status + audit. The money is
    // already reflected in refundedTotal (reserved in step 1).
    const fullyRefunded = reserved.newRefundedTotal >= reserved.grandTotal;
    const finalized = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.order.update({
        where: { id: args.orderId },
        data: {
          paymentStatus: fullyRefunded
            ? OrderPaymentStatus.REFUNDED
            : OrderPaymentStatus.PARTIALLY_REFUNDED,
          status: fullyRefunded
            ? OrderStatus.REFUNDED
            : OrderStatus.PARTIALLY_REFUNDED,
        },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          customerId: true,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: args.orderId,
          type: OrderEventType.REFUNDED,
          toStatus: fullyRefunded
            ? OrderStatus.REFUNDED
            : OrderStatus.PARTIALLY_REFUNDED,
          triggeredBy: args.actorId,
          note: `Refund ${args.amountPaise} paise (${args.reason})`,
          metadata: { razorpayRefundId, amountPaise: args.amountPaise },
        },
      });
      return upd;
    });

    // ── Post-commit realtime (Section 6): announce the (partial) refund.
    this.emitOrderUpdated(finalized);

    return { razorpayRefundId, refundedTotal: reserved.newRefundedTotal };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  READ SURFACES (admin board + customer/guest)
  // ════════════════════════════════════════════════════════════════════════

  /** Admin order board: filter + paginate. */
  async listOrders(query: OrderQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.customerId) where.customerId = query.customerId;
    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { orderNumber: { contains: term, mode: 'insensitive' } },
        { guestEmail: { contains: term, mode: 'insensitive' } },
        { razorpayOrderId: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          customer: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: rows,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Admin order detail by id (full include). */
  async getOrderForAdmin(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        events: { orderBy: { createdAt: 'desc' } },
        shipments: true,
        invoices: true,
        customer: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /** A registered customer's own orders (paginated). */
  async listCustomerOrders(customerId: string, query: OrderQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { _count: { select: { items: true } } },
      }),
      this.prisma.order.count({ where: { customerId } }),
    ]);

    return {
      data: rows.map((o) => this.serializeForCustomer(o)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Customer/guest order detail incl. tracking + invoice link. Authorization is
   * enforced by the caller: a CustomerJwtGuard route passes the JWT customerId
   * (ownership re-checked here), a GuestOrderGuard route passes the guard-resolved
   * order (ownership already proven by the token).
   */
  async getOrderForViewer(
    id: string,
    viewer: { customerId?: string; guestOrderId?: string },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        events: {
          where: { type: { not: OrderEventType.NOTE } },
          orderBy: { createdAt: 'desc' },
        },
        shipments: {
          include: { events: { orderBy: { occurredAt: 'desc' } } },
        },
        invoices: {
          where: { status: 'ISSUED' },
          select: { id: true, invoiceNumber: true, pdfS3Key: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    // Ownership: registered customer must own it; guest path already proved the
    // order via its token (guestOrderId === order.id).
    if (viewer.customerId && order.customerId !== viewer.customerId) {
      throw new ForbiddenException('This order belongs to another account');
    }
    if (viewer.guestOrderId && order.id !== viewer.guestOrderId) {
      throw new ForbiddenException('Order token does not match order');
    }

    const invoice = order.invoices[0] ?? null;
    let invoiceUrl: string | null = null;
    // Defense-in-depth: getSignedDownloadUrlForKey signs ANY key with no ownership
    // check, so we refuse to presign a key that is not under the invoices/ prefix
    // (the only place InvoicingService writes invoice PDFs). This bounds the blast
    // radius if a future write path ever lets pdfS3Key hold an arbitrary value.
    if (invoice?.pdfS3Key && invoice.pdfS3Key.startsWith('invoices/')) {
      try {
        invoiceUrl = await this.documents.getSignedDownloadUrlForKey(
          invoice.pdfS3Key,
        );
      } catch {
        invoiceUrl = null;
      }
    }

    return {
      ...this.serializeForCustomer(order),
      items: order.items,
      events: order.events,
      shipments: order.shipments,
      invoice: invoice
        ? { invoiceNumber: invoice.invoiceNumber, url: invoiceUrl }
        : null,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  INTERNAL HELPERS
  // ════════════════════════════════════════════════════════════════════════

  /** Resolve the cart id to check out from the guard-pinned actor. */
  private async resolveCartId(actor: CheckoutActor): Promise<string> {
    if (actor.guestCartId) return actor.guestCartId;
    if (actor.customerId) {
      const cart = await this.prisma.cart.findFirst({
        where: { customerId: actor.customerId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (!cart) {
        throw new NotFoundException(
          'No active cart found — add items to a cart before checking out',
        );
      }
      return cart.id;
    }
    throw new BadRequestException('No cart resolved for checkout');
  }

  /**
   * Validate the cart's attached coupon for checkout. Returns null (proceed
   * without discount) if it no longer validates — the cart preview is advisory.
   */
  private async validateAttachedCoupon(
    couponId: string,
    actor: CheckoutActor,
    subtotalPaise: number,
  ): Promise<{ couponId: string; code: string; discountPaise: number } | null> {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id: couponId },
      select: { code: true },
    });
    if (!coupon) return null;
    try {
      return await this.coupons.validateCoupon(
        coupon.code,
        {
          customerId: actor.customerId,
          email: actor.email?.trim().toLowerCase() ?? undefined,
          isGuest: actor.isGuest,
        },
        subtotalPaise,
      );
    } catch {
      return null;
    }
  }

  /**
   * Ensure a Customer row exists for the order. A registered customer already has
   * one (their JWT sub). A guest checkout creates a GUEST Customer (Section 2.4 /
   * 8.13) so the Order/CouponRedemption customerId FKs are satisfied and the
   * coupon anti-farming cap keys on the guest email.
   */
  private async ensureCustomer(
    tx: Prisma.TransactionClient,
    actor: CheckoutActor,
    info: {
      shipping: CheckoutAddressDto;
      guestEmail?: string;
      guestPhone?: string;
    },
  ): Promise<string> {
    if (actor.customerId) {
      const existing = await tx.customer.findUnique({
        where: { id: actor.customerId },
        select: { id: true, isActive: true },
      });
      if (!existing || !existing.isActive) {
        throw new ForbiddenException('Customer account is not active');
      }
      return existing.id;
    }

    // Guest path: mint a GUEST Customer.
    const guest = await tx.customer.create({
      data: {
        type: CustomerType.GUEST,
        email: info.guestEmail ?? null,
        phone: info.guestPhone ?? info.shipping.phone ?? null,
        firstName: info.shipping.fullName,
      },
      select: { id: true },
    });
    return guest.id;
  }

  /**
   * On a pre-shipped cancel, free the order's stock: release ACTIVE reservations
   * (unpaid) and restock any CONSUMED reservations (paid → units already
   * decremented from onHand). Both run inside the caller's tx.
   */
  private async releaseOrRestockForCancel(
    tx: Prisma.TransactionClient,
    order: Order,
    actor: OrderActor,
    stockEmitSink?: StockUpdatedEvent[],
  ): Promise<void> {
    const reservations = await tx.stockReservation.findMany({
      where: {
        orderId: order.id,
        status: { in: [ReservationStatus.ACTIVE, ReservationStatus.CONSUMED] },
      },
    });
    for (const r of reservations) {
      if (r.status === ReservationStatus.ACTIVE) {
        await this.inventory.releaseReservation(tx, r.id, {
          actor: { id: actor.id, role: actor.role },
          emitSink: stockEmitSink,
        });
      } else if (r.status === ReservationStatus.CONSUMED) {
        // Paid order cancelled before shipping: return the units to stock.
        await this.inventory.restock(
          tx,
          {
            skuId: r.skuId,
            warehouseId: r.warehouseId,
            qty: r.quantity,
          },
          {
            reason: StockMovementReason.RETURN,
            referenceType: 'ORDER',
            referenceId: order.id,
            actor: { id: actor.id, role: actor.role },
            note: `Restock on cancel of order ${order.orderNumber}`,
            emitSink: stockEmitSink,
          },
        );
      }
    }
  }

  /** Best-effort order-confirmation notification. Never throws. */
  private fireOrderConfirmation(orderId: string): Promise<void> {
    // NotificationService is applicant-centric; a dedicated order-confirmation
    // template/channel is owned by store-jobs (built in parallel). For now record
    // the signal so it is never lost and the webhook stays decoupled.
    this.logger.log(`order-confirmation queued for order ${orderId}`);
    return Promise.resolve();
  }

  /**
   * Allocate the next gapless human reference for a scope (ORDER/PO/RMA) INSIDE
   * the caller's transaction. Called from within the checkout $transaction (Phase
   * 7) so that a rollback (insufficient stock, coupon exhausted, double-checkout)
   * also rolls back the sequence bump — no permanently-consumed number / gap. The
   * advisory lock + `SELECT ... FOR UPDATE` row lock serialize concurrent writers
   * (the FOR UPDATE lock is the authoritative cross-replica serializer).
   */
  private async nextNumber(
    tx: Prisma.TransactionClient,
    scope: string,
    prefix: string,
  ): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`numseq_${scope}`}))`;
    await tx.$executeRaw`
      INSERT INTO number_sequences (scope, last_value, prefix, updated_at)
      VALUES (${scope}, 0, ${prefix}, now())
      ON CONFLICT (scope) DO NOTHING
    `;
    const rows = await tx.$queryRaw<{ last_value: number; prefix: string }[]>(
      Prisma.sql`
        SELECT last_value, prefix FROM number_sequences
        WHERE scope = ${scope} FOR UPDATE
      `,
    );
    const row = rows[0];
    const next = Number(row?.last_value ?? 0) + 1;
    const pfx = row?.prefix || prefix;
    await tx.$executeRaw`
      UPDATE number_sequences SET last_value = ${next}, updated_at = now()
      WHERE scope = ${scope}
    `;
    return `${pfx}-${String(next).padStart(6, '0')}`;
  }

  /** A trimmed serialization for customer-facing order reads. */
  private serializeForCustomer(o: Order & { _count?: { items: number } }) {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      paymentStatus: o.paymentStatus,
      currency: o.currency,
      itemsSubtotal: o.itemsSubtotal,
      discountTotal: o.discountTotal,
      taxTotal: o.taxTotal,
      shippingTotal: o.shippingTotal,
      grandTotal: o.grandTotal,
      refundedTotal: o.refundedTotal,
      placedAt: o.placedAt,
      paidAt: o.paidAt,
      createdAt: o.createdAt,
      itemCount: o._count?.items,
    };
  }

  // ── pure helpers (static, unit-testable) ──────────────────────────────────

  /** Snapshot a checkout address DTO into the immutable order JSON shape. */
  private static addressJson(a: CheckoutAddressDto): Prisma.InputJsonValue {
    return {
      fullName: a.fullName,
      phone: a.phone ?? null,
      line1: a.line1,
      line2: a.line2 ?? null,
      city: a.city,
      stateCode: a.stateCode,
      postalCode: a.postalCode,
      country: a.country ?? 'IN',
    };
  }

  /** Map a target OrderStatus to its OrderEventType for the audit row. */
  private static eventTypeFor(status: OrderStatus): OrderEventType {
    switch (status) {
      case OrderStatus.CONFIRMED:
        return OrderEventType.CONFIRMED;
      case OrderStatus.PACKED:
        return OrderEventType.PACKED;
      case OrderStatus.SHIPPED:
        return OrderEventType.SHIPPED;
      case OrderStatus.DELIVERED:
        return OrderEventType.DELIVERED;
      case OrderStatus.CANCELLED:
        return OrderEventType.CANCELLED;
      case OrderStatus.REFUNDED:
      case OrderStatus.PARTIALLY_REFUNDED:
        return OrderEventType.REFUNDED;
      default:
        return OrderEventType.NOTE;
    }
  }
}
