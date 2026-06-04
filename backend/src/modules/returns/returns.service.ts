import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  OrderEventType,
  OrderStatus,
  Prisma,
  RefundStatus,
  ReturnStatus,
  ShipmentStatus,
  StockMovementReason,
} from '@prisma/client';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/prisma/prisma.service';
import { OrdersService } from '@/modules/orders/orders.service';
import { resolveCustomerSecret } from '@/modules/store-auth/customer.strategy';
import { InventoryService } from '@/modules/inventory/inventory.service';
import { InvoicingService } from '@/modules/invoicing/invoicing.service';
import { NotificationService } from '@/modules/notifications/notification.service';
import { CreateReturnDto, ReturnQueryDto } from './dto';

/**
 * The caller of a return-request, resolved by the controller from EITHER a
 * CUSTOMER JWT (registered owner) or a guest order-access token. Exactly one of
 * `customerId` / `guestOrderId` is set; the service uses whichever is present to
 * prove ownership of the order the returned items belong to (IDOR guard).
 */
export interface ReturnRequester {
  /** Set for a registered customer (CUSTOMER JWT sub). */
  customerId?: string;
  /** Set for a guest: the order id the presented order-token resolved to. */
  guestOrderId?: string;
}

/** A JWT-sourced admin actor for audited approve/reject. */
export interface ReturnAdminActor {
  id: string;
  role?: string;
}

/** The minimal verified CUSTOMER JWT payload the store dual-auth path relies on. */
interface CustomerJwtPayload {
  sub?: string;
  role?: string;
}

/** Returns window: 7 days post-delivery (decision: FULL refund incl. tax, no fee). */
const RETURN_WINDOW_DAYS = 7;
const RETURN_WINDOW_MS = RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

/**
 * Minimum length a raw guest order-access token must have before we bother
 * hashing it + hitting the DB. The real tokens are signed/high-entropy strings
 * far longer than this; rejecting anything shorter short-circuits junk-header
 * DB-lookup amplification without weakening the legitimate path.
 */
const MIN_GUEST_TOKEN_LENGTH = 20;

/** Statuses a prior ReturnItem must NOT be in to count toward the already-returned cap. */
const REJECTED_RETURN_STATUSES: ReadonlySet<ReturnStatus> = new Set([
  ReturnStatus.REJECTED,
  ReturnStatus.CANCELLED,
]);

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
    private readonly invoicing: InvoicingService,
    private readonly notifications: NotificationService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ════════════════════════════════════════════════════════════════════════
  //  DUAL-AUTH IDENTITY RESOLUTION (service-owned; no Prisma in the controller)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Resolve a store-facing requester from EITHER a CUSTOMER JWT (Authorization
   * header) OR a guest order-access token (X-Order-Token). Exactly one path:
   *
   *  - Authorization present (any non-empty value) → the CUSTOMER bearer path
   *    wins. A malformed/expired bearer throws UnauthorizedException; we do NOT
   *    silently fall through to the guest path (precedence rule: if a caller
   *    presents a bearer it MUST be a valid one — falling back would mask token
   *    bugs and let a stale bearer + a guest token co-exist ambiguously).
   *  - Otherwise the X-Order-Token guest path: the raw token is length-screened
   *    (cheap junk-header rejection), SHA-256 hashed, and matched against
   *    Order.guestAccessTokenHash. Knowing the order id is never sufficient.
   *
   * All Prisma + JWT work lives here (CLAUDE.md module pattern), so the
   * controller injects no PrismaService.
   */
  async resolveRequester(headers: {
    authorization?: string;
    orderToken?: string;
  }): Promise<ReturnRequester> {
    const authHeader = headers.authorization;
    if (typeof authHeader === 'string' && authHeader.length > 0) {
      // Bearer present → it must be valid; intentional non-fallthrough.
      const customerId = await this.verifyCustomerToken(authHeader);
      return { customerId };
    }

    const rawToken = headers.orderToken;
    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedException(
        'Provide a customer token (Authorization) or a guest order token (X-Order-Token)',
      );
    }
    if (rawToken.length < MIN_GUEST_TOKEN_LENGTH) {
      // Too short to be a real signed token; reject before hashing + DB lookup
      // (bounds junk-header DB-read amplification).
      throw new UnauthorizedException('Invalid order token');
    }
    const hash = createHash('sha256').update(rawToken).digest('hex');
    const order = await this.prisma.order.findUnique({
      where: { guestAccessTokenHash: hash },
      select: { id: true },
    });
    if (!order) {
      throw new UnauthorizedException('Invalid order token');
    }
    return { guestOrderId: order.id };
  }

  /**
   * Verify a CUSTOMER bearer token (same DEDICATED customer secret —
   * JWT_CUSTOMER_SECRET with JWT_SECRET fallback — + role assertion as the
   * dedicated 'jwt-customer' strategy) and resolve the active REGISTERED customer
   * id. Mirrors OrdersController.verifyCustomerToken so the dual-auth scheme stays
   * consistent across the store surface.
   *
   * The shared resolveCustomerSecret() is the SINGLE source of truth for the
   * customer signing/verification key, so this verifier, the strategy, the
   * OrdersController sibling, and StoreAuthService can never drift apart: once a
   * distinct JWT_CUSTOMER_SECRET is set, a platform token fails the signature
   * check here. The role assertion below remains as defense-in-depth.
   */
  private async verifyCustomerToken(authHeader: string): Promise<string> {
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Customer authentication required');
    }

    let payload: CustomerJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<CustomerJwtPayload>(token, {
        secret: resolveCustomerSecret(this.config),
      });
    } catch {
      throw new UnauthorizedException('Customer authentication required');
    }
    if (!payload || payload.role !== 'CUSTOMER' || !payload.sub) {
      throw new UnauthorizedException('Customer access required');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true, type: true },
    });
    if (!customer || !customer.isActive || customer.type !== 'REGISTERED') {
      throw new UnauthorizedException('Customer not found or inactive');
    }
    return customer.id;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  CUSTOMER: request a return (POST /api/store/returns) — architecture 4.10
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Create a Return (REQUESTED) for a DELIVERED order whose delivery is within
   * the 7-day window. The body lists {orderItemId, qty, reason}; the order,
   * customer, prices and refund amount are ALL derived server-side from the
   * frozen OrderItem snapshots — the client supplies no money and no identity.
   *
   * Per-line refund = full taxable share + full proportional cgst/sgst/igst of
   * the returned units (FULL refund incl. proportional tax, NO restocking fee).
   * Summed into Return.refundAmount.
   *
   * The route is order-scoped (`POST /api/store/orders/:orderNumber/returns`), so
   * `orderNumber` from the path is folded into the ownership scope: the items must
   * belong to THAT order AND be owned by the caller, or they are NotFound. This
   * reconciles the body-derived order with the spec's URL contract.
   *
   * @throws NotFoundException     an orderItemId does not exist / not on this order
   * @throws ForbiddenException    the order is not owned by the caller (IDOR)
   * @throws BadRequestException   mixed-order request / duplicate lines / not delivered
   * @throws UnprocessableEntity   RETURN_WINDOW_CLOSED (> 7 days post-delivery)
   * @throws ConflictException     a line exceeds orderedQty - alreadyReturnedQty
   */
  async requestReturn(
    requester: ReturnRequester,
    dto: CreateReturnDto,
    orderNumber: string,
  ) {
    // Reject duplicate orderItemIds up front: each OrderItem may appear at most
    // once per request (the @@unique([returnId, orderItemId]) constraint would
    // also reject it, but a clean 400 is friendlier than a P2002).
    const seen = new Set<string>();
    for (const line of dto.items) {
      if (seen.has(line.orderItemId)) {
        throw new BadRequestException(
          `Duplicate orderItemId ${line.orderItemId} in request; combine quantities into one line`,
        );
      }
      seen.add(line.orderItemId);
    }
    const orderItemIds = [...seen];

    // ── Ownership-SCOPED load (IDOR fix): filter the OrderItem query by the
    // caller's identity so items belonging to ANOTHER account simply do not match
    // (NotFound), rather than matching + then 403-ing — which would leak a
    // UUID-exists oracle (a 403 confirms the id exists for someone else, a 404
    // does not). A registered customer is scoped to their own orders; a guest is
    // scoped to the single order their presented token resolved to.
    let ownershipScope: Prisma.OrderWhereInput;
    if (requester.customerId) {
      ownershipScope = { customerId: requester.customerId };
    } else if (requester.guestOrderId) {
      ownershipScope = { id: requester.guestOrderId };
    } else {
      // The caller must resolve exactly one identity before calling the service;
      // reaching here is a wiring bug, not a client error.
      throw new ForbiddenException('Return requester identity not resolved');
    }
    // Fold the path's :orderNumber into the scope so the items must belong to THAT
    // order (spec contract) AND to the caller. A mismatch collapses to NotFound.
    ownershipScope = { ...ownershipScope, orderNumber };

    // Load the referenced OrderItems with their parent order. All must belong to
    // ONE order so the Return maps to a single order/refund/credit-note. The
    // `order: ownershipScope` filter enforces ownership at the DB layer.
    const orderItems = await this.prisma.orderItem.findMany({
      where: { id: { in: orderItemIds }, order: ownershipScope },
      include: { order: true },
    });
    if (orderItems.length !== orderItemIds.length) {
      // Either an id does not exist OR it is not owned by the caller — both
      // collapse to NotFound so ownership cannot be probed via the status code.
      throw new NotFoundException('One or more order items could not be found');
    }

    const orderIds = new Set(orderItems.map((oi) => oi.orderId));
    if (orderIds.size !== 1) {
      throw new BadRequestException(
        'All returned items must belong to the same order',
      );
    }
    const order = orderItems[0].order;

    // ── The order must be DELIVERED (a refund-eligible terminal-ish state) within
    // the 7-day window. Order has no deliveredAt column, so delivery time is
    // resolved from the Shipment(s) deliveredAt, falling back to the DELIVERED
    // OrderEvent timestamp.
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException(
        'Returns can only be requested for a delivered order',
      );
    }
    const deliveredAt = await this.resolveDeliveredAt(order.id);
    if (!deliveredAt) {
      // Marked DELIVERED but no timestamp recoverable — cannot prove the window;
      // refuse rather than silently allow an out-of-window return.
      throw new UnprocessableEntityException(
        'RETURN_WINDOW_CLOSED: delivery date could not be determined for this order',
      );
    }
    if (Date.now() - deliveredAt.getTime() > RETURN_WINDOW_MS) {
      throw new UnprocessableEntityException(
        `RETURN_WINDOW_CLOSED: returns must be requested within ${RETURN_WINDOW_DAYS} days of delivery`,
      );
    }

    const orderItemById = new Map(orderItems.map((oi) => [oi.id, oi]));

    // Pick a representative reason for the Return header (first line); per-line
    // reasons are not separately persisted (ReturnItem has no reason column), so
    // the customer comment carries any nuance.
    const headerReason = dto.items[0].reason;

    // ── Tally + cap-check + create ALL run inside ONE transaction, serialized per
    // order by `pg_advisory_xact_lock(return_request_<orderId>)`. This closes the
    // concurrent-request race: two parallel requests for the same OrderItem can no
    // longer both read alreadyReturned=0 and both write — the second waits on the
    // lock, then re-reads the first's now-committed tally and is capped. The RMA
    // number is allocated inside the same tx so a rollback also rolls back the bump.
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`return_request_${order.id}`}))`;

      // Authoritative already-returned tally per OrderItem (sum of prior
      // non-rejected ReturnItems across ALL returns of this order), read UNDER the
      // lock so it is consistent with the rows this tx is about to insert.
      const priorReturned = await this.alreadyReturnedByOrderItem(
        orderItemIds,
        tx,
      );

      // ── Compute per-line refunds from the frozen OrderItem snapshot. FULL refund:
      // proportional taxable + proportional cgst/sgst/igst of the returned units,
      // no restocking fee. Integer-paise proportional split by returned qty.
      let refundTotal = 0;
      const itemCreates = dto.items.map((line) => {
        const oi = orderItemById.get(line.orderItemId)!;
        const alreadyReturned = priorReturned.get(line.orderItemId) ?? 0;
        const returnable = oi.quantity - alreadyReturned;
        if (returnable <= 0) {
          throw new ConflictException(
            `All units of order item ${line.orderItemId} have already been returned`,
          );
        }
        if (line.qty > returnable) {
          throw new ConflictException(
            `Cannot return ${line.qty} of order item ${line.orderItemId}; only ${returnable} remain returnable`,
          );
        }

        const lineRefund = ReturnsService.proportionalLineRefund(
          {
            taxableValue: oi.taxableValue,
            cgstAmount: oi.cgstAmount,
            sgstAmount: oi.sgstAmount,
            igstAmount: oi.igstAmount,
            quantity: oi.quantity,
          },
          line.qty,
        );
        refundTotal += lineRefund;

        return {
          orderItemId: oi.id,
          skuId: oi.skuId,
          quantity: line.qty,
          refundAmount: lineRefund,
        };
      });

      const rmaNumber = await this.nextRmaNumber(tx);
      return tx.return.create({
        data: {
          rmaNumber,
          orderId: order.id,
          customerId: order.customerId,
          status: ReturnStatus.REQUESTED,
          reason: headerReason,
          comment: dto.comment ?? null,
          refundAmount: refundTotal,
          refundStatus: RefundStatus.PENDING,
          restockWarehouseId: order.fulfilledFromWarehouseId,
          items: { create: itemCreates },
        },
        include: { items: true },
      });
    });

    return created;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ADMIN: queue + detail
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Admin returns queue: filter by status/order/customer, paginate.
   *
   * PII minimization (sec finding): the list view is paginated up to 200 rows,
   * each carrying a customer email. A MODERATOR (the lowest admin tier) gets the
   * email MASKED in the bulk view to bound mass PII scraping; ADMIN/SUPER_ADMIN
   * see it in full. The detail view (`getReturnForAdmin`) retains full data for
   * legitimate single-record admin work.
   */
  async listReturns(query: ReturnQueryDto, actor?: ReturnAdminActor) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const skip = (page - 1) * limit;

    const where: Prisma.ReturnWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.orderId) where.orderId = query.orderId;
    if (query.customerId) where.customerId = query.customerId;

    const [rows, total] = await Promise.all([
      this.prisma.return.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          order: {
            select: { id: true, orderNumber: true, grandTotal: true },
          },
          customer: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.return.count({ where }),
    ]);

    const maskEmails = (actor?.role ?? '').toUpperCase() === 'MODERATOR';
    const data = maskEmails
      ? rows.map((r) =>
          r.customer
            ? {
                ...r,
                customer: {
                  ...r.customer,
                  email: ReturnsService.maskEmail(r.customer.email),
                },
              }
            : r,
        )
      : rows;

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Admin return detail (full include). */
  async getReturnForAdmin(id: string) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: {
        items: { include: { orderItem: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            grandTotal: true,
            refundedTotal: true,
            fulfilledFromWarehouseId: true,
          },
        },
        customer: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });
    if (!ret) throw new NotFoundException('Return not found');
    return ret;
  }

  /**
   * Customer/guest read of their own return. Ownership is enforced here: a
   * registered customer must own the return; a guest's token must resolve to the
   * return's order.
   */
  async getReturnForRequester(id: string, requester: ReturnRequester) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!ret) throw new NotFoundException('Return not found');

    if (requester.customerId) {
      if (ret.customerId !== requester.customerId) {
        throw new ForbiddenException('This return belongs to another account');
      }
    } else if (requester.guestOrderId) {
      if (ret.orderId !== requester.guestOrderId) {
        throw new ForbiddenException('Order token does not match return');
      }
    } else {
      throw new ForbiddenException('Return requester identity not resolved');
    }
    return ret;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ADMIN: reject
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Reject a REQUESTED return. CAS-guarded so only a REQUESTED return can be
   * rejected (a return already approved/refunded cannot be retroactively
   * rejected). No money / stock moves.
   *
   * NOTE on field reuse: the schema has no separate `rejectedById`/`rejectedAt`
   * columns, so the resolving admin + timestamp are recorded in `approvedById` /
   * `approvedAt` for BOTH approve and reject. These therefore mean "the admin who
   * RESOLVED this return, and when" — NOT "approved". The terminal `status`
   * (REJECTED vs APPROVED/REFUNDED) is the authoritative outcome; do not read
   * `approvedById` as proof of approval without checking `status`.
   */
  async rejectReturn(id: string, reason: string, actor: ReturnAdminActor) {
    const updated = await this.prisma.return.updateMany({
      where: { id, status: ReturnStatus.REQUESTED },
      data: {
        status: ReturnStatus.REJECTED,
        comment: reason,
        // Resolver identity (see NOTE above) — reused approve* columns.
        approvedById: actor.id,
        approvedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      // Either it does not exist or it is no longer REQUESTED.
      const exists = await this.prisma.return.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!exists) throw new NotFoundException('Return not found');
      throw new ConflictException(
        `Return cannot be rejected from status ${exists.status}`,
      );
    }
    return this.prisma.return.findUniqueOrThrow({ where: { id } });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ADMIN: approve — authorize the RMA (NO money / NO stock move yet)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Approve a REQUESTED return: REQUESTED → APPROVED. This authorizes the RMA so
   * the customer can ship the item back; NO money moves and NO stock is restocked
   * here. The financial + inventory settlement happens later in `receiveReturn`,
   * once the parcel is physically back at the warehouse (lifecycle:
   * REQUESTED → APPROVED → IN_TRANSIT → RECEIVED → REFUNDED, architecture 4.10).
   *
   * Idempotent + serialized: under advisory lock `return_approve_<id>`, the CAS
   * REQUESTED→APPROVED is the exactly-once gate, so a double-click is a no-op that
   * returns the current row. The per-line return-quantity cap is RE-VERIFIED here
   * under the same per-order lock used at request time, closing the concurrent-
   * request race (two parallel REQUESTED returns over-claiming the same OrderItem):
   * if approving this one would push an OrderItem over orderedQty, it is
   * auto-REJECTED with a system note instead of being authorized.
   */
  async approveReturn(id: string, actor: ReturnAdminActor, note?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`return_approve_${id}`}))`;

      const ret = await tx.return.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!ret) throw new NotFoundException('Return not found');

      // Idempotent: any non-REQUESTED status means it was already resolved; return
      // the current row rather than re-driving the transition.
      if (ret.status !== ReturnStatus.REQUESTED) {
        return { return: ret, overLine: null as string | null };
      }

      // ── Per-line cap RE-CHECK (sec finding): serialize against concurrent
      // requests for the same order, then verify each line's qty still fits within
      // orderedQty - (priorReturned EXCLUDING this return). This is the backstop
      // for the request-time race; if it fails we auto-REJECT instead of approving.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`return_request_${ret.orderId}`}))`;
      const orderItemIds = ret.items.map((it) => it.orderItemId);
      const priorReturned = await this.alreadyReturnedByOrderItem(
        orderItemIds,
        tx,
        ret.id, // exclude THIS return from the tally
      );
      const orderItems = await tx.orderItem.findMany({
        where: { id: { in: orderItemIds } },
        select: { id: true, quantity: true },
      });
      const orderedById = new Map(orderItems.map((oi) => [oi.id, oi.quantity]));
      const overLine = ret.items.find((it) => {
        const ordered = orderedById.get(it.orderItemId) ?? 0;
        const prior = priorReturned.get(it.orderItemId) ?? 0;
        return it.quantity + prior > ordered;
      });
      if (overLine) {
        // A concurrent return already consumed the units this one claims. REJECT
        // (persisted — this write commits with the tx) rather than authorize a
        // refund that would over-return the line. The conflict is surfaced to the
        // caller AFTER commit so the rejection is not rolled back by the throw.
        await tx.return.updateMany({
          where: { id, status: ReturnStatus.REQUESTED },
          data: {
            status: ReturnStatus.REJECTED,
            refundStatus: RefundStatus.FAILED,
            approvedById: actor.id,
            approvedAt: new Date(),
            comment: `Auto-rejected: order item ${overLine.orderItemId} would exceed the returnable quantity (a concurrent return already covered these units).`,
          },
        });
        const rejected = await tx.return.findUniqueOrThrow({
          where: { id },
          include: { items: true },
        });
        return { return: rejected, overLine: overLine.orderItemId };
      }

      const flip = await tx.return.updateMany({
        where: { id, status: ReturnStatus.REQUESTED },
        data: {
          status: ReturnStatus.APPROVED,
          approvedById: actor.id,
          approvedAt: new Date(),
          ...(note ? { comment: note } : {}),
        },
      });
      if (flip.count !== 1) {
        // Lost the CAS despite the lock — re-read and return current state.
        const current = await tx.return.findUniqueOrThrow({
          where: { id },
          include: { items: true },
        });
        return { return: current, overLine: null as string | null };
      }

      const approved = await tx.return.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });
      return { return: approved, overLine: null as string | null };
    });

    // Surface the auto-rejection as a 409 AFTER the rejection has committed.
    if (result.overLine) {
      throw new ConflictException(
        `Cannot approve: order item ${result.overLine} would exceed the returnable quantity; the return was rejected`,
      );
    }
    return result.return;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ADMIN: mark in-transit — customer has shipped the item back (optional)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Mark an APPROVED return as IN_TRANSIT (the customer has dispatched the parcel
   * back). Pure status step — no money / no stock. Idempotent: a return already
   * IN_TRANSIT (or further along) is returned as-is. This step is optional in the
   * flow; `receiveReturn` accepts both APPROVED and IN_TRANSIT.
   */
  async markReturnInTransit(id: string, actor: ReturnAdminActor) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`return_approve_${id}`}))`;
      const ret = await tx.return.findUnique({ where: { id } });
      if (!ret) throw new NotFoundException('Return not found');

      if (ret.status === ReturnStatus.IN_TRANSIT) return ret; // idempotent
      if (ret.status !== ReturnStatus.APPROVED) {
        throw new ConflictException(
          `Return cannot be marked in-transit from status ${ret.status}`,
        );
      }
      await tx.return.updateMany({
        where: { id, status: ReturnStatus.APPROVED },
        data: { status: ReturnStatus.IN_TRANSIT },
      });
      return tx.return.findUniqueOrThrow({ where: { id } });
    });
    this.logger.log(
      `Return ${id} marked IN_TRANSIT by ${actor.id} (RMA ${result.rmaNumber})`,
    );
    return result;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ADMIN: receive — THE money path (restock + refund + credit note)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Receive a physically-returned parcel and execute the full settlement in ONE
   * coherent, idempotent flow (architecture 4.10 — the restock+refund step):
   *   1. Under advisory lock `return_approve_<id>`, CAS APPROVED|IN_TRANSIT →
   *      RECEIVED + stamp the REAL `receivedAt`. A double-click loses the CAS and
   *      short-circuits — so refund/restock/credit-note can never run twice.
   *   2. Razorpay refund of the frozen Return.refundAmount via
   *      OrdersService.refundOrder (its own `order_refund_<orderId>` lock +
   *      cumulative cap + razorpayRefundId @unique protect against over-refund).
   *      The external Razorpay call happens OUTSIDE the advisory lock / tx, exactly
   *      as refundOrder requires.
   *   3. Restock each line into the order's fulfilling warehouse (onHand += ,
   *      StockMovement RETURN), each guarded by the per-ReturnItem `restocked`
   *      CAS so a retry never double-restocks.
   *   4. Issue the idempotent CREDIT_NOTE via InvoicingService.generateCreditNote.
   *   5. CAS RECEIVED → REFUNDED + persist razorpayRefundId + refundedAt.
   *
   * Restocking happens HERE (on physical receipt), never at approval time, so
   * inventory is never inflated by items not yet back at the warehouse. The order's
   * own status (REFUNDED / PARTIALLY_REFUNDED) is advanced by refundOrder; this
   * method does not duplicate that transition.
   */
  async receiveReturn(id: string, actor: ReturnAdminActor, note?: string) {
    // ── Step 1: idempotent claim. Advisory lock serializes concurrent receives of
    // the SAME return; the CAS {APPROVED,IN_TRANSIT}→RECEIVED is the exactly-once
    // gate and stamps the real physical-receipt time.
    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`return_approve_${id}`}))`;

      const ret = await tx.return.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!ret) throw new NotFoundException('Return not found');

      // Must be approved (or in-transit) before it can be received.
      if (
        ret.status !== ReturnStatus.APPROVED &&
        ret.status !== ReturnStatus.IN_TRANSIT
      ) {
        // Already RECEIVED/REFUNDED (settlement done or in-flight), or REQUESTED/
        // REJECTED/CANCELLED (cannot receive). Treat terminal money states as
        // already-handled; reject the un-receivable ones.
        if (
          ret.status === ReturnStatus.RECEIVED ||
          ret.status === ReturnStatus.REFUNDED
        ) {
          return { ret, claimed: false as const };
        }
        throw new ConflictException(
          `Return cannot be received from status ${ret.status}`,
        );
      }

      const flip = await tx.return.updateMany({
        where: {
          id,
          status: {
            in: [ReturnStatus.APPROVED, ReturnStatus.IN_TRANSIT],
          },
        },
        data: {
          status: ReturnStatus.RECEIVED,
          receivedAt: new Date(), // REAL physical-receipt time
          refundStatus: RefundStatus.PROCESSING,
          ...(note ? { comment: note } : {}),
        },
      });
      if (flip.count !== 1) {
        // Lost the CAS to a concurrent receiver despite the lock — the winner is
        // performing the settlement.
        return { ret, claimed: false as const };
      }

      // Re-read the order's fulfilling warehouse + number for the settlement.
      const order = await tx.order.findUnique({
        where: { id: ret.orderId },
        select: {
          id: true,
          orderNumber: true,
          fulfilledFromWarehouseId: true,
        },
      });
      if (!order) throw new NotFoundException('Order not found for return');

      return { ret, order, claimed: true as const };
    });

    // Not the claiming caller (double-click / concurrent / already settled): return
    // current state, do NOT re-run any money / stock movement.
    if (!claim.claimed) {
      return this.prisma.return.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });
    }

    const { ret, order } = claim;
    if (!order.fulfilledFromWarehouseId) {
      // Without a fulfilling warehouse we cannot restock. The CAS already moved the
      // return to RECEIVED, but no money has moved yet; fail loudly so an admin
      // reconciles rather than silently skipping restock.
      throw new ConflictException(
        'Order has no fulfilling warehouse on record; cannot restock this return',
      );
    }

    // ── Step 2: Razorpay refund (OUTSIDE any tx/lock, per refundOrder contract).
    // refundOrder is itself idempotent + cumulative-capped; if the return was
    // partially settled in a prior crashed attempt, its razorpayRefundId @unique
    // backstop + refundedTotal cap prevent a double charge.
    let razorpayRefundId: string | null = null;
    if (ret.refundAmount > 0) {
      const refund = await this.orders.refundOrder({
        orderId: ret.orderId,
        amountPaise: ret.refundAmount,
        reason: `RMA ${ret.rmaNumber}`,
        actorId: actor.id,
      });
      razorpayRefundId = refund.razorpayRefundId;
    }

    // ── Step 3: restock each line into the fulfilling warehouse, each guarded by
    // the per-ReturnItem `restocked` CAS so a retry can never double-restock.
    await this.restockReturnItems(
      ret.id,
      order.fulfilledFromWarehouseId,
      order.orderNumber,
      actor,
    );

    // ── Step 4: idempotent credit note (compliance). The invoicing service
    // dedupes on a stable CN:<returnId> marker, so a retry never re-numbers.
    try {
      await this.invoicing.generateCreditNote(ret.id);
    } catch (e) {
      // Non-fatal: the refund + restock already happened (the financially material
      // steps). A failed credit-note render is recoverable via the existing
      // idempotent admin endpoint POST .../credit-note. Log loudly.
      this.logger.error(
        `Credit note generation failed for RMA ${ret.rmaNumber}: ${(e as Error)?.message}`,
      );
    }

    // ── Step 5: finalize the Return. CAS RECEIVED→REFUNDED so a concurrent path
    // cannot regress the status; persist razorpayRefundId + refundedAt.
    await this.prisma.return.updateMany({
      where: { id: ret.id, status: ReturnStatus.RECEIVED },
      data: {
        status: ReturnStatus.REFUNDED,
        refundStatus: RefundStatus.COMPLETED,
        razorpayRefundId,
        refundedAt: new Date(),
      },
    });

    // Best-effort customer notification (never throws out of the settlement).
    this.notifyReturnRefunded(ret.id).catch((e) =>
      this.logger.error(
        `Return-refunded notification failed for RMA ${ret.rmaNumber}: ${(e as Error)?.message}`,
      ),
    );

    return this.prisma.return.findUniqueOrThrow({
      where: { id: ret.id },
      include: { items: true },
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  INTERNAL HELPERS
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Restock every line of a return into the given warehouse, each line guarded by
   * a per-ReturnItem `restocked` CAS (false→true) so a re-run never double-counts
   * stock. Each line runs in its own tx: the inventory.restock primitive takes
   * the (sku, warehouse) advisory lock + onHand CAS + writes a RETURN movement.
   * A line whose skuId is null (SKU later deleted) is marked restocked without a
   * stock bump (nowhere to add it back) so it does not block the return.
   *
   * IDEMPOTENT RE-ENTRY CONTRACT (explicit): the caller (`receiveReturn`) is itself
   * gated exactly-once by the RECEIVED CAS, but a crash AFTER some lines flip and
   * BEFORE the RECEIVED→REFUNDED finalize will, on retry, re-enter this method from
   * the top. That is SAFE: each line's `restocked=false→true` CAS means only the
   * first run of a given line bumps stock; re-entry re-reads all items and the
   * already-flipped lines fail the CAS (`claimed.count !== 1`) and are skipped, so
   * no line is ever double-restocked. The per-line tx (not one tx across all lines)
   * is a deliberate latency/connection tradeoff: each line's onHand bump and its
   * `restocked` flip commit atomically together (correct), at the cost of N
   * round-trips for an N-line return. Because every line is individually idempotent
   * the lack of a single enclosing tx across lines does not threaten correctness.
   */
  private async restockReturnItems(
    returnId: string,
    warehouseId: string,
    orderNumber: string,
    actor: ReturnAdminActor,
  ): Promise<void> {
    const items = await this.prisma.returnItem.findMany({
      where: { returnId },
    });

    for (const item of items) {
      await this.prisma.$transaction(async (tx) => {
        // CAS-claim this line for restock: only the first run flips false→true.
        const claimed = await tx.returnItem.updateMany({
          where: { id: item.id, restocked: false },
          data: { restocked: true },
        });
        if (claimed.count !== 1) {
          // Already restocked by a prior (possibly crashed-then-retried) run.
          return;
        }

        if (!item.skuId) {
          // SKU was deleted (OrderItem.skuId SetNull propagated); nothing to add
          // back to. The CAS above already marked it restocked so it won't retry.
          this.logger.warn(
            `Return item ${item.id} (RMA order ${orderNumber}) has no SKU; skipping stock add-back`,
          );
          return;
        }

        // Add the units back; inventory.restock takes the (sku,wh) advisory lock,
        // CAS-bumps onHand, and writes a StockMovement(RETURN). Runs INSIDE this
        // tx so the onHand bump and the `restocked` flip commit/rollback together.
        await this.inventory.restock(
          tx,
          { skuId: item.skuId, warehouseId, qty: item.quantity },
          {
            reason: StockMovementReason.RETURN,
            referenceType: 'RETURN',
            // StockMovement.referenceId is @db.Uuid — pass the bare return uuid,
            // not a prefixed 'RMA:<id>' label (that breaks the uuid cast). The
            // human-readable RMA reference lives in the note.
            referenceId: returnId,
            actor: { id: actor.id, role: actor.role },
            note: `Restock for RMA on order ${orderNumber}`,
          },
        );
      });
    }
  }

  /**
   * Resolve the order's delivery instant — the anchor for the 7-day return window.
   * Resolution order, most-authoritative first:
   *   1. `Order.deliveredAt`  — stamped once by the courier-delivery webhook; the
   *      canonical anchor (schema comment: "anchors the 7-day returns window").
   *   2. most-recent `Shipment.deliveredAt`.
   *   3. latest DELIVERED `OrderEvent`: prefer the courier's original delivery
   *      timestamp captured in `metadata.deliveredAt` over the event's write-time
   *      `createdAt` (createdAt can lag actual delivery if the event was written
   *      late by the courier-sync cron or replayed in disaster-recovery, which
   *      would otherwise mis-shorten the customer's window).
   * Returns null if none is present (caller refuses the return rather than guess).
   */
  private async resolveDeliveredAt(orderId: string): Promise<Date | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { deliveredAt: true },
    });
    if (order?.deliveredAt) return order.deliveredAt;

    const shipment = await this.prisma.shipment.findFirst({
      where: {
        orderId,
        status: ShipmentStatus.DELIVERED,
        deliveredAt: { not: null },
      },
      orderBy: { deliveredAt: 'desc' },
      select: { deliveredAt: true },
    });
    if (shipment?.deliveredAt) return shipment.deliveredAt;

    const event = await this.prisma.orderEvent.findFirst({
      where: { orderId, type: OrderEventType.DELIVERED },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, metadata: true },
    });
    if (!event) return null;
    // Prefer the courier's original delivery instant if the webhook/cron recorded
    // it in metadata; fall back to the event's write-time createdAt.
    const metaDelivered = ReturnsService.metadataDeliveredAt(event.metadata);
    return metaDelivered ?? event.createdAt;
  }

  /**
   * Sum already-returned quantities per OrderItem across all PRIOR returns whose
   * status is not REJECTED/CANCELLED. This is the authoritative cap basis: a unit
   * counts as "returned" once a non-rejected ReturnItem covers it, so two parallel
   * requests cannot both claim the same unit (the second sees the first's tally —
   * and the @@unique([returnId, orderItemId]) plus the cap re-check on approve
   * back this up).
   *
   * Runs on the supplied tx client when given (so request-time + approve-time
   * tallies are consistent with the rows the caller is about to insert/approve,
   * read under the per-order advisory lock); otherwise on the base client.
   *
   * @param excludeReturnId when set, that return's own items are EXCLUDED from the
   *   tally — used by the approve-time re-check so a return is not counted against
   *   itself when verifying its lines still fit under the cap.
   */
  private async alreadyReturnedByOrderItem(
    orderItemIds: string[],
    db: PrismaService | Prisma.TransactionClient = this.prisma,
    excludeReturnId?: string,
  ): Promise<Map<string, number>> {
    const rows = await db.returnItem.groupBy({
      by: ['orderItemId'],
      where: {
        orderItemId: { in: orderItemIds },
        return: { status: { notIn: [...REJECTED_RETURN_STATUSES] } },
        ...(excludeReturnId ? { returnId: { not: excludeReturnId } } : {}),
      },
      _sum: { quantity: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.orderItemId, r._sum.quantity ?? 0);
    }
    return map;
  }

  /**
   * Allocate the next gapless RMA number INSIDE the caller's tx. The advisory
   * lock + `SELECT ... FOR UPDATE` row lock serialize concurrent writers (the
   * FOR UPDATE row lock is the authoritative cross-replica serializer; advisory
   * locks are session-scoped). Mirrors the orders/invoicing numbering idiom.
   */
  private async nextRmaNumber(tx: Prisma.TransactionClient): Promise<string> {
    const scope = 'RMA';
    const prefix = 'RMA';
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`numseq_${scope}`}))`;
    await tx.$executeRaw`
      INSERT INTO number_sequences (scope, last_value, prefix, updated_at)
      VALUES (${scope}, 0, ${prefix}, now())
      ON CONFLICT (scope) DO NOTHING
    `;
    const rows = await tx.$queryRaw<
      { last_value: string | number; prefix: string | null }[]
    >(
      Prisma.sql`
        SELECT last_value, prefix FROM number_sequences
        WHERE scope = ${scope} FOR UPDATE
      `,
    );
    // Postgres returns BIGINT columns as JS strings via $queryRaw — parse with an
    // explicit radix (Number() would truncate above MAX_SAFE_INTEGER). `??` (not
    // `||`) so a legitimate empty-string prefix is preserved and a missing row
    // (theoretically possible if the scope row was deleted between INSERT..ON
    // CONFLICT and this SELECT) is not silently masked beyond the prefix fallback.
    const row = rows[0];
    const next = parseInt(String(row?.last_value ?? 0), 10) + 1;
    const pfx = row?.prefix ?? prefix;
    await tx.$executeRaw`
      UPDATE number_sequences SET last_value = ${next}, updated_at = now()
      WHERE scope = ${scope}
    `;
    return `${pfx}-${String(next).padStart(6, '0')}`;
  }

  /**
   * Best-effort return-refunded notification via NotificationService (email +
   * optional WhatsApp). Resolves the store customer's contact + the frozen refund
   * amount, then fans out. Never throws — the caller invokes it fire-and-forget so
   * a transport failure never unwinds the already-committed settlement.
   */
  private async notifyReturnRefunded(returnId: string): Promise<void> {
    const ret = await this.prisma.return.findUnique({
      where: { id: returnId },
      select: {
        rmaNumber: true,
        refundAmount: true,
        customer: {
          select: { email: true, firstName: true, phone: true },
        },
      },
    });
    if (!ret) return;
    await this.notifications.customerReturnRefunded({
      email: ret.customer?.email,
      firstName: ret.customer?.firstName,
      phone: ret.customer?.phone,
      rmaNumber: ret.rmaNumber,
      refundAmountPaise: ret.refundAmount,
    });
  }

  // ── pure helpers (static, unit-testable) ──────────────────────────────────

  /**
   * Mask an email for the bulk admin list view (PII minimization). Keeps the first
   * char of the local part + the domain: `john.doe@x.com` → `j***@x.com`. Null /
   * malformed inputs degrade to a safe sentinel.
   */
  static maskEmail(email: string | null | undefined): string {
    if (!email) return '';
    const at = email.indexOf('@');
    if (at <= 0) return '***';
    const local = email.slice(0, at);
    const domain = email.slice(at);
    const head = local[0];
    return `${head}***${domain}`;
  }

  /**
   * Pull a courier-supplied delivery instant out of an OrderEvent.metadata blob,
   * if present + parseable. Used to anchor the return window on the ACTUAL delivery
   * time rather than the event's write time. Returns null when absent/invalid.
   */
  static metadataDeliveredAt(metadata: Prisma.JsonValue | null): Date | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }
    const raw = (metadata as Record<string, unknown>)['deliveredAt'];
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * Per-line FULL refund for `returnQty` units of an OrderItem: the proportional
   * taxable share PLUS the proportional cgst/sgst/igst, all summed (no restocking
   * fee). Integer-paise proportional split by returned/ordered ratio; each
   * component rounded half-up independently (matches the credit-note's
   * per-component `Math.round` so the Return.refundAmount and the credit-note
   * grand total agree). Returning the full ordered qty refunds the full line.
   */
  static proportionalLineRefund(
    oi: {
      taxableValue: number;
      cgstAmount: number;
      sgstAmount: number;
      igstAmount: number;
      quantity: number;
    },
    returnQty: number,
  ): number {
    if (oi.quantity <= 0) return 0;
    if (returnQty >= oi.quantity) {
      // Full-line return: refund the entire frozen line amount exactly (no
      // rounding drift) — the whole taxable + whole tax.
      return oi.taxableValue + oi.cgstAmount + oi.sgstAmount + oi.igstAmount;
    }
    const share = (total: number) =>
      Math.round((total * returnQty) / oi.quantity);
    return (
      share(oi.taxableValue) +
      share(oi.cgstAmount) +
      share(oi.sgstAmount) +
      share(oi.igstAmount)
    );
  }
}
