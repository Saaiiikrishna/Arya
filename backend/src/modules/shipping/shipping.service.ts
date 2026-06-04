import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Courier, OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { OrdersService, OrderActor } from '@/modules/orders/orders.service';
import { NotificationService } from '@/modules/notifications/notification.service';
import {
  COURIER_PROVIDER,
  COURIER_EVENT_DESCRIPTION_MAX,
  COURIER_EVENT_ID_MAX,
  COURIER_EVENT_LOCATION_MAX,
  COURIER_WEBHOOK_SECRET_KEY,
  SHIPMENT_SEQUENCE_PREFIX,
  SHIPMENT_SEQUENCE_SCOPE,
  courierWebhookSecretKey,
} from './shipping.constants';
import { CourierProviderFactory } from './courier';
import type { CourierTrackingEvent } from './courier';
import type {
  CreateShipmentDto,
  ShipmentQueryDto,
  CourierWebhookDto,
} from './dto';

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

/**
 * Bounds for an untrusted courier-supplied event timestamp (see `toDate`). A
 * delivery instant far in the past would retroactively open the 7-day returns
 * window; far in the future would close it early. Out-of-range values clamp to now.
 */
const MAX_EVENT_FUTURE_MS = 5 * 60 * 1000; // 5 minutes (clock skew tolerance)
const MAX_EVENT_PAST_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Forward-progress rank for ShipmentStatus. Tracking events can arrive out of
 * order (courier feeds are not monotonic), so the service NEVER regresses a
 * shipment's status to a lower rank — it records every event in the timeline but
 * only advances `Shipment.status` when the new event ranks strictly higher.
 * FAILED/RETURNED are terminal-exception states ranked above DELIVERED so a
 * genuine failure/return after transit is reflected, but they do NOT trigger the
 * order DELIVERED transition.
 */
const STATUS_RANK: Readonly<Record<ShipmentStatus, number>> = {
  PENDING: 0,
  LABEL_CREATED: 1,
  PICKED_UP: 2,
  IN_TRANSIT: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERED: 5,
  FAILED: 6,
  RETURNED: 7,
};

/**
 * Terminal shipment states the courier-sync cron skips: once a shipment is
 * DELIVERED / FAILED / RETURNED there is nothing left to poll, so the cron never
 * re-fetches tracking for it (matches architecture Section 7 "shipments not in
 * {DELIVERED,FAILED,RETURNED}").
 */
const TERMINAL_SHIPMENT_STATUSES: ReadonlySet<ShipmentStatus> = new Set([
  ShipmentStatus.DELIVERED,
  ShipmentStatus.FAILED,
  ShipmentStatus.RETURNED,
]);

/** A shipment is "stale" (eligible for a courier re-poll) after this long without a sync. */
const SHIPMENT_SYNC_STALE_MS = 12 * 60 * 1000; // 12 minutes (< the 15-min store-courier-sync cron cadence, Section 7)
/** Hard cap on shipments synced in one cron pass so a backlog can't run unbounded. */
const SHIPMENT_SYNC_BATCH_LIMIT = 200;

/**
 * Map a courier-supplied status/code string to our canonical ShipmentStatus.
 * Unknown strings map to IN_TRANSIT (a safe non-terminal "something happened")
 * so an unrecognized checkpoint still records progress without falsely
 * delivering/failing the shipment.
 */
const STATUS_KEYWORDS: ReadonlyArray<[ShipmentStatus, readonly string[]]> = [
  [ShipmentStatus.RETURNED, ['return', 'rto', 'returned']],
  [ShipmentStatus.FAILED, ['fail', 'undeliver', 'cancel', 'exception', 'lost']],
  [ShipmentStatus.DELIVERED, ['deliver', 'dlvd', 'completed']],
  [
    ShipmentStatus.OUT_FOR_DELIVERY,
    ['out for delivery', 'ofd', 'out_for_delivery'],
  ],
  [
    ShipmentStatus.IN_TRANSIT,
    ['transit', 'in_transit', 'shipped', 'dispatched', 'manifest'],
  ],
  [ShipmentStatus.PICKED_UP, ['pick', 'picked', 'collected']],
  [ShipmentStatus.LABEL_CREATED, ['label', 'created', 'booked', 'awb']],
];

/** The order shape the shipping service reads when creating a shipment. */
type ShippableOrder = Prisma.OrderGetPayload<{
  include: {
    items: {
      select: {
        skuCodeSnapshot: true;
        nameSnapshot: true;
        quantity: true;
      };
    };
  };
}>;

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationService,
    @Inject(COURIER_PROVIDER)
    private readonly couriers: CourierProviderFactory,
  ) {}

  // ════════════════════════════════════════════════════════════════════════
  //  ADMIN: create a shipment for an order (POST /admin/store/orders/:id/ship)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Create a shipment for an order and advance the order to SHIPPED.
   *
   * Two paths:
   *  - PROVIDER (`dto.useProvider`): call the active courier provider to mint the
   *    AWB. The external call runs OUTSIDE any DB transaction (a held tx + network
   *    round-trip would pin a Postgres connection). If the provider is gated /
   *    unconfigured it throws COURIER_NOT_CONFIGURED — we fall back to the manual
   *    path, which then REQUIRES `dto.awb`.
   *  - MANUAL: the admin supplies `courier` + `awb` directly.
   *
   * Then, in ONE transaction: allocate the gapless shipment number, create the
   * Shipment + an initial ShipmentEvent, and call OrdersService.transitionStatus
   * to move the order PACKED→SHIPPED (validated state machine + OrderEvent audit).
   * The order transition runs inside the SAME tx so a Shipment is never created
   * without its order being advanced (and vice-versa). Notification is fired
   * best-effort AFTER commit.
   */
  async ship(orderId: string, dto: CreateShipmentDto, actor: OrderActor) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          select: {
            skuCodeSnapshot: true,
            nameSnapshot: true,
            quantity: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    // Only a PACKED order can be shipped — the only state from which SHIPPED is a
    // legal hop (ship() drives straight to SHIPPED). This early check is advisory
    // UX (a fast 409 before the provider round-trip); it is RE-ASSERTED inside the
    // tx under the advisory lock via transitionStatus, where it is authoritative.
    if (order.status !== OrderStatus.PACKED) {
      throw new ConflictException(
        `ORDER_NOT_SHIPPABLE: order ${order.orderNumber} is ${order.status}; it must be PACKED before shipping`,
      );
    }

    // Single-warehouse-per-order fulfillment (architecture 8.4): an order with no
    // fulfilling warehouse at ship time is a data inconsistency — fail loudly
    // rather than create a warehouse-less shipment that silently breaks the
    // Shipment→Warehouse provenance the restock / returns flow relies on.
    if (!order.fulfilledFromWarehouseId) {
      throw new ConflictException(
        `ORDER_NO_WAREHOUSE: order ${order.orderNumber} has no fulfillment warehouse assigned`,
      );
    }

    // ── Resolve AWB / courier / URLs (provider OR manual) BEFORE the tx (the
    // provider call is an external round-trip; never hold a DB tx over it). ──
    let courier: Courier = dto.courier ?? Courier.OTHER;
    let awb = dto.awb?.trim() || undefined;
    let trackingUrl = dto.trackingUrl?.trim() || undefined;
    let labelUrl: string | undefined;

    if (dto.useProvider) {
      const provider = await this.couriers.resolve();
      try {
        const result = await provider.createShipment(order as ShippableOrder);
        awb = result.awb?.trim() || awb;
        trackingUrl = result.trackingUrl ?? trackingUrl;
        labelUrl = result.labelUrl;
        courier = provider.courier;
      } catch (e) {
        // Gated/unconfigured provider → fall back to manual (admin AWB required).
        this.logger.warn(
          `Courier provider createShipment failed for order ${order.orderNumber}: ${(e as Error)?.message}; falling back to manual`,
        );
      }
    }

    if (!awb) {
      throw new BadRequestException(
        'AWB_REQUIRED: supply `awb` (manual) or enable a configured courier provider',
      );
    }
    const resolvedAwb = awb;

    // ── ONE transaction: lock + re-check + number + order→SHIPPED + shipment. ──
    const shippedAt = new Date();
    const shipment = await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent ships of the SAME order: take the per-order advisory
      // lock BEFORE the existing-shipment re-check so two admins shipping the same
      // order simultaneously (TOCTOU) cannot both pass the check and both create a
      // Shipment. This is the SAME lock OrdersService.transitionStatus uses, so we
      // FORWARD this tx to it below (ownLock:false) rather than nest a $transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order_status_${orderId}`}))`;

      // Re-assert under the lock: one active shipment per order in v1
      // (single-warehouse-per-order, no split fulfillment — architecture 8.4).
      // FAILED and RETURNED are excluded: a FAILED shipment can be retried, and a
      // RETURNED (courier RTO) leaves the order undelivered and legitimately
      // re-shippable — neither should permanently block a fresh dispatch.
      const existing = await tx.shipment.findFirst({
        where: {
          orderId,
          status: { notIn: [ShipmentStatus.FAILED, ShipmentStatus.RETURNED] },
        },
        select: { id: true, shipmentNumber: true },
      });
      if (existing) {
        throw new ConflictException(
          `ALREADY_SHIPPED: order ${order.orderNumber} already has shipment ${existing.shipmentNumber ?? existing.id}`,
        );
      }

      const shipmentNumber = await this.nextShipmentNumber(tx);

      // Advance the order PACKED→SHIPPED via the CANONICAL state machine,
      // FORWARDING this tx so the order flip + OrderEvent commit atomically with
      // the shipment insert below. We already hold order_status_{orderId}, so it
      // runs with ownLock:false. If the order is no longer PACKED (lost a race),
      // transitionStatus throws (illegal transition) and the whole tx rolls back —
      // no shipment, number bump, or order flip is ever half-applied. This keeps
      // OrdersService the SINGLE source of truth for the SHIPPED transition.
      await this.orders.transitionStatus(
        orderId,
        OrderStatus.SHIPPED,
        actor,
        `Shipped via ${courier} (AWB ${resolvedAwb}, ${shipmentNumber})`,
        { tx },
      );

      let created;
      try {
        created = await tx.shipment.create({
          data: {
            orderId,
            warehouseId: order.fulfilledFromWarehouseId,
            shipmentNumber,
            courier,
            awb: resolvedAwb,
            trackingUrl: trackingUrl ?? null,
            status: ShipmentStatus.LABEL_CREATED,
            shippingCost: dto.shippingCost ?? 0,
            weightGrams: dto.weightGrams ?? null,
            labelS3Key: labelUrl ?? null,
            shippedAt,
            lastSyncedAt: shippedAt,
          },
        });
      } catch (e) {
        // A duplicate AWB (unique) means this exact shipment was already created
        // — surface a clean 409 rather than a raw P2002.
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          throw new ConflictException(
            `DUPLICATE_AWB: AWB ${resolvedAwb} is already attached to a shipment`,
          );
        }
        throw e;
      }

      // Initial timeline event (synthesized id — courier has not reported yet).
      await tx.shipmentEvent.create({
        data: {
          shipmentId: created.id,
          status: ShipmentStatus.LABEL_CREATED,
          courierEventId: ShippingService.synthEventId(
            created.id,
            ShipmentStatus.LABEL_CREATED,
            shippedAt,
          ),
          description:
            dto.note ?? `Shipment created (${courier}, AWB ${resolvedAwb})`,
          occurredAt: shippedAt,
        },
      });

      return created;
    });

    // Best-effort notification AFTER commit (never throws out of ship()).
    await this.notifyShipped(
      order,
      shipment.awb ?? resolvedAwb,
      shipment.courier,
      shipment.trackingUrl,
    ).catch((e) =>
      this.logger.error(
        `shipment-shipped notify failed for order ${order.orderNumber}: ${(e as Error)?.message}`,
      ),
    );

    return shipment;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  WEBHOOK: courier tracking ingest (POST /store/webhooks/courier)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Ingest courier tracking events. Idempotent end-to-end:
   *  - Optional HMAC-SHA256 verification over the RAW body with
   *    COURIER_WEBHOOK_SECRET (timingSafeEqual). If no secret is configured the
   *    route is accept-from-allowlisted-source (the secret is the recommended
   *    production posture; absence is logged once).
   *  - Resolve the Shipment by AWB.
   *  - For each event: dedupe by (shipmentId, courierEventId); when the courier
   *    supplies no id we synthesize a STABLE one (sha256 of shipmentId+code+
   *    occurredAt) so the @@unique([shipmentId, courierEventId]) never sees NULL
   *    (M2a caveat). Insert; on a unique-violation the event is a duplicate → skip.
   *  - Advance Shipment.status to the highest-ranked event seen (never regress).
   *  - On DELIVERED, advance the order to DELIVERED + stamp Order.deliveredAt
   *    (enables the 7-day returns window).
   *
   * Returns {received:true} for any verified payload so the courier stops
   * retrying — unknown AWBs are acked-and-ignored.
   */
  async ingestWebhook(args: {
    providerKey?: string;
    signature?: string;
    rawBody: Buffer;
  }): Promise<{ received: boolean }> {
    // Sanitize the provider key ONCE for both secret-key derivation and logging
    // (it is a free-text path parameter — never log/interpolate it raw, to avoid
    // env-var-name injection and log forging).
    const safeProviderKey = ShippingService.sanitizeProviderKey(
      args.providerKey,
    );

    // ── Signature verification (fail-closed). In production the secret is
    // MANDATORY: without it an attacker who finds the webhook URL could inject
    // forged DELIVERED events (marking orders delivered, opening the returns
    // window, advancing the order state machine) with no courier involved.
    //
    // Per-provider isolation: the named webhook variant (.../courier/:courier)
    // carries the provider key, so a Delhivery callback is verified with
    // DELHIVERY_WEBHOOK_SECRET while a Shiprocket callback uses
    // SHIPROCKET_WEBHOOK_SECRET; either falls back to the shared
    // COURIER_WEBHOOK_SECRET when its provider-specific value is absent.
    const secret = this.resolveWebhookSecret(safeProviderKey);
    if (!secret) {
      // Fail CLOSED by default: only skip signature verification on an explicit
      // dev/test allowlist. An exact `=== 'production'` check fails OPEN whenever
      // NODE_ENV is 'prod', absent, or empty — so invert it to a known-dev list
      // and reject the unsigned webhook in every other case.
      const isDev = ['development', 'test'].includes(
        this.config.get<string>('NODE_ENV') ?? '',
      );
      if (!isDev) {
        throw new UnauthorizedException(
          'COURIER_WEBHOOK_SECRET is not configured; refusing unsigned courier webhook in production',
        );
      }
      this.logger.warn(
        `COURIER_WEBHOOK_SECRET not configured (provider="${safeProviderKey ?? 'default'}"); accepting courier webhook without signature verification (DEV ONLY — this is rejected outside development/test)`,
      );
    } else {
      const ok = ShippingService.verifyHmac(
        args.rawBody,
        args.signature,
        secret,
      );
      if (!ok) {
        throw new BadRequestException('Invalid courier webhook signature');
      }
    }

    let parsed: CourierWebhookDto;
    try {
      parsed = JSON.parse(args.rawBody.toString('utf8')) as CourierWebhookDto;
    } catch {
      throw new BadRequestException('Malformed courier webhook body');
    }

    const awb = ShippingService.extractAwb(parsed);
    if (!awb) {
      // Nothing to correlate — ack and ignore.
      return { received: true };
    }

    const shipment = await this.prisma.shipment.findUnique({
      where: { awb },
      select: { id: true, orderId: true, status: true },
    });
    if (!shipment) {
      // Unknown AWB (e.g. a shipment from another system) — ack and ignore.
      this.logger.warn(`Courier webhook for unknown AWB ${awb}; ignoring`);
      return { received: true };
    }

    const events = this.normalizeEvents(parsed, shipment.id);
    // Funnel through the SHARED ingest core so the webhook path and the
    // courier-sync cron apply identical dedupe + forward-only advance + deliver
    // semantics. An empty event set still stamps lastSyncedAt (no-op advance).
    await this.ingestNormalizedEvents(shipment, events);
    return { received: true };
  }

  /**
   * SHARED idempotent ingest core for a resolved shipment + already-normalized
   * events. Used by BOTH the inbound courier webhook and the courier-sync cron
   * (store-jobs), so the two paths can never diverge on dedupe / forward-only
   * status advance / DELIVERED handling.
   *
   *  - inserts each event idempotently (`@@unique([shipmentId, courierEventId])`)
   *  - advances Shipment.status to the highest-ranked event seen (never regress)
   *    and always stamps lastSyncedAt (so the cron's staleness filter advances
   *    even on a poll that returned only duplicates / nothing)
   *  - on a freshly-seen DELIVERED event, advances the order + stamps
   *    Order.deliveredAt (opens the 7-day returns window)
   */
  private async ingestNormalizedEvents(
    shipment: { id: string; orderId: string; status: ShipmentStatus },
    events: NormalizedEvent[],
  ): Promise<void> {
    // Insert each event idempotently and compute the highest status seen.
    let highest = STATUS_RANK[shipment.status];
    let highestStatus = shipment.status;
    let sawDelivered = false;
    let latestDeliveredAt: Date | null = null;

    for (const ev of events) {
      const inserted = await this.insertEventIdempotent(shipment.id, ev);
      if (!inserted) continue; // duplicate — already ingested
      if (STATUS_RANK[ev.mappedStatus] > highest) {
        highest = STATUS_RANK[ev.mappedStatus];
        highestStatus = ev.mappedStatus;
      }
      if (ev.mappedStatus === ShipmentStatus.DELIVERED) {
        sawDelivered = true;
        if (!latestDeliveredAt || ev.occurredAt > latestDeliveredAt) {
          latestDeliveredAt = ev.occurredAt;
        }
      }
    }

    // Advance the shipment status forward-only (never regress), stamp sync time.
    await this.advanceShipmentStatus(
      shipment.id,
      highestStatus,
      sawDelivered ? (latestDeliveredAt ?? new Date()) : undefined,
    );

    // On DELIVERED: advance the order + stamp deliveredAt (opens returns window).
    if (sawDelivered) {
      await this.markOrderDelivered(
        shipment.orderId,
        latestDeliveredAt ?? new Date(),
      ).catch((e) =>
        this.logger.error(
          `Failed to mark order ${shipment.orderId} delivered: ${(e as Error)?.message}`,
        ),
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  COURIER SYNC (polled by store-jobs store-courier-sync cron, Section 7)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Poll the active courier for every non-terminal shipment whose tracking has
   * gone stale, and ingest the returned checkpoints through the SAME idempotent
   * dedupe/advance/deliver path the inbound webhook uses (`ingestNormalizedEvents`).
   *
   * Called by the store-jobs `store-courier-sync` cron (architecture Section 7).
   * Fully idempotent: re-running re-reads live shipment state and the
   * `@@unique([shipmentId, courierEventId])` constraint dedupes every event, so a
   * double-fire never double-applies a checkpoint or re-delivers an order.
   *
   * Skips entirely when the active provider is the `manual` courier (no upstream
   * feed to poll — `ManualCourierProvider.getTracking` returns []). For real
   * providers, a per-shipment failure is logged and skipped (one bad AWB never
   * aborts the batch). Returns counts the cron logs.
   *
   * NOTE: only shipments with a non-null AWB and a non-manual `courier` are polled
   * — a manually-keyed shipment (Courier.OTHER, admin-entered AWB) has no provider
   * tracking endpoint and is advanced solely by the inbound webhook.
   */
  async syncActiveShipments(): Promise<{
    polled: number;
    updated: number;
    skipped: number;
    failed: number;
  }> {
    const provider = await this.couriers.resolve();
    // The manual provider has no upstream tracking feed — nothing to poll.
    if (provider.key === this.couriers.fallback.key) {
      return { polled: 0, updated: 0, skipped: 0, failed: 0 };
    }

    const staleBefore = new Date(Date.now() - SHIPMENT_SYNC_STALE_MS);
    const candidates = await this.prisma.shipment.findMany({
      where: {
        status: { notIn: [...TERMINAL_SHIPMENT_STATUSES] },
        awb: { not: null },
        // Only poll this provider's own shipments; a manually-keyed shipment
        // (Courier.OTHER) has no endpoint on a remote provider.
        courier: provider.courier,
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }],
      },
      orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
      take: SHIPMENT_SYNC_BATCH_LIMIT,
      select: { id: true, orderId: true, status: true, awb: true },
    });

    let polled = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const shipment of candidates) {
      const awb = shipment.awb;
      if (!awb) {
        skipped++;
        continue;
      }
      let trackingEvents: CourierTrackingEvent[];
      try {
        polled++;
        trackingEvents = await provider.getTracking(awb);
      } catch (e) {
        // One AWB's courier failure must never abort the whole sweep — log and
        // move on. The shipment stays non-terminal and is retried next pass.
        failed++;
        this.logger.warn(
          `courier-sync getTracking failed for AWB ${awb} (shipment ${shipment.id}): ${(e as Error)?.message}`,
        );
        continue;
      }

      const normalized = this.normalizeProviderEvents(
        trackingEvents,
        shipment.id,
      );
      try {
        await this.ingestNormalizedEvents(
          {
            id: shipment.id,
            orderId: shipment.orderId,
            status: shipment.status,
          },
          normalized,
        );
        updated++;
      } catch (e) {
        failed++;
        this.logger.error(
          `courier-sync ingest failed for shipment ${shipment.id} (AWB ${awb}): ${(e as Error)?.message}`,
        );
      }
    }

    return { polled, updated, skipped, failed };
  }

  /**
   * Map provider-returned {@link CourierTrackingEvent}s into the same canonical
   * {@link NormalizedEvent} shape the webhook path produces, so both feed the one
   * shared ingest core. Mirrors `normalizeEvents`' bounding/synthesis rules: the
   * courier event id is bounded (or a stable id synthesized) and free-text fields
   * are truncated to the DB column widths.
   */
  private normalizeProviderEvents(
    events: CourierTrackingEvent[],
    shipmentId: string,
  ): NormalizedEvent[] {
    const out: NormalizedEvent[] = [];
    for (const ev of events ?? []) {
      const statusStr = String(ev.status ?? ev.code ?? '').trim();
      const codeStr = String(ev.code ?? ev.status ?? '').trim();
      if (!statusStr && !codeStr) continue;

      const occurredAt = this.toDate(ev.occurredAt);
      const mappedStatus = ShippingService.mapStatus(`${statusStr} ${codeStr}`);
      const courierEventId =
        ev.courierEventId !== undefined &&
        ev.courierEventId !== null &&
        String(ev.courierEventId).length > 0
          ? String(ev.courierEventId).slice(0, COURIER_EVENT_ID_MAX)
          : ShippingService.synthEventId(
              shipmentId,
              codeStr || statusStr,
              occurredAt,
            );

      const description = (ev.description ?? (statusStr || codeStr)) || '';
      out.push({
        mappedStatus,
        courierEventId,
        description: description.slice(0, COURIER_EVENT_DESCRIPTION_MAX),
        location:
          ev.location != null
            ? String(ev.location).slice(0, COURIER_EVENT_LOCATION_MAX)
            : undefined,
        occurredAt,
        raw: ev.raw ?? ev,
      });
    }
    return out;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  READ SURFACES
  // ════════════════════════════════════════════════════════════════════════

  /** Admin shipment list with filters + pagination. */
  async listShipments(query: ShipmentQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const skip = (page - 1) * limit;

    const where: Prisma.ShipmentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.courier) where.courier = query.courier;
    if (query.orderId) where.orderId = query.orderId;
    if (query.search) {
      const term = query.search.trim();
      // Both columns are @unique (btree). Use index-friendly predicates rather
      // than a leading-wildcard `contains` (which forces a sequential scan as the
      // table grows): exact-match on the gapless shipmentNumber, prefix-match on
      // the AWB (a btree supports prefix scans). This is a fulfillment ops lookup,
      // not arbitrary substring search.
      where.OR = [
        { shipmentNumber: { equals: term, mode: 'insensitive' } },
        { awb: { startsWith: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          order: {
            select: { id: true, orderNumber: true, status: true },
          },
          _count: { select: { events: true } },
        },
      }),
      this.prisma.shipment.count({ where }),
    ]);

    return {
      data: rows,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Customer/guest tracking view for an order: the shipment(s) + their event
   * timelines. Ownership is enforced by the caller (CustomerJwtGuard owner OR
   * GuestOrderGuard); we re-assert it here defensively.
   */
  async getTrackingForViewer(
    orderId: string,
    viewer: { customerId?: string; guestOrderId?: string },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        customerId: true,
        deliveredAt: true,
        shipments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            shipmentNumber: true,
            courier: true,
            awb: true,
            trackingUrl: true,
            status: true,
            shippedAt: true,
            deliveredAt: true,
            lastSyncedAt: true,
            events: {
              orderBy: { occurredAt: 'desc' },
              select: {
                id: true,
                status: true,
                description: true,
                location: true,
                occurredAt: true,
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (viewer.customerId && order.customerId !== viewer.customerId) {
      throw new ForbiddenException('This order belongs to another account');
    }
    if (viewer.guestOrderId && order.id !== viewer.guestOrderId) {
      throw new ForbiddenException('Order token does not match order');
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      deliveredAt: order.deliveredAt,
      shipments: order.shipments,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  INTERNAL HELPERS
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Advance Shipment.status forward-only under a per-shipment advisory lock,
   * guarded so concurrent webhook deliveries cannot regress the status. Always
   * stamps lastSyncedAt; stamps deliveredAt when delivering.
   */
  private async advanceShipmentStatus(
    shipmentId: string,
    toStatus: ShipmentStatus,
    deliveredAt?: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shipment_status_${shipmentId}`}))`;
      const current = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: { status: true },
      });
      if (!current) return;

      const data: Prisma.ShipmentUpdateInput = { lastSyncedAt: new Date() };
      // Only advance to a strictly-higher rank (never regress on out-of-order feeds).
      if (STATUS_RANK[toStatus] > STATUS_RANK[current.status]) {
        data.status = toStatus;
      }
      if (deliveredAt && STATUS_RANK[toStatus] >= STATUS_RANK.DELIVERED) {
        data.deliveredAt = deliveredAt;
      }
      await tx.shipment.update({ where: { id: shipmentId }, data });
    });
  }

  /**
   * Mark the order DELIVERED via the validated state machine, stamping
   * Order.deliveredAt ATOMICALLY in the same locked transition (the 7-day returns
   * window anchors on it, so it must be written exactly once, under the order
   * lock — never in a separate, unlocked round-trip that a concurrent webhook
   * could race or overwrite). transitionStatus only sets deliveredAt when moving
   * to DELIVERED and when it is currently null.
   *
   * Idempotent: we only call transitionStatus when the order is SHIPPED. If a
   * parallel webhook already delivered it (status DELIVERED) we skip the call —
   * this avoids a spurious "Illegal transition DELIVERED → DELIVERED" Conflict
   * surfacing in logs while remaining a correct no-op for the duplicate delivery.
   */
  private async markOrderDelivered(
    orderId: string,
    deliveredAt: Date,
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!order) return;

    // Only SHIPPED → DELIVERED is a legal hop. If already DELIVERED, a parallel
    // webhook won the race; nothing to do (deliveredAt was stamped by that call).
    if (order.status === OrderStatus.SHIPPED) {
      await this.orders.transitionStatus(
        orderId,
        OrderStatus.DELIVERED,
        { id: 'SYSTEM', role: 'SYSTEM' },
        `Delivery confirmed by courier at ${deliveredAt.toISOString()}`,
        { deliveredAt },
      );
    }
  }

  /**
   * Insert a ShipmentEvent idempotently. The (shipmentId, courierEventId) unique
   * constraint is the real dedupe; we catch P2002 and report "already ingested".
   * @returns true if newly inserted, false if it was a duplicate.
   */
  private async insertEventIdempotent(
    shipmentId: string,
    ev: NormalizedEvent,
  ): Promise<boolean> {
    try {
      await this.prisma.shipmentEvent.create({
        data: {
          shipmentId,
          status: ev.mappedStatus,
          courierEventId: ev.courierEventId,
          description: ev.description ?? null,
          location: ev.location ?? null,
          occurredAt: ev.occurredAt,
          rawPayload: ev.raw as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return false; // duplicate (shipmentId, courierEventId) — idempotent skip
      }
      throw e;
    }
  }

  /** Normalize a courier webhook payload into canonical, deduped events. */
  private normalizeEvents(
    payload: CourierWebhookDto,
    shipmentId: string,
  ): NormalizedEvent[] {
    const rawEvents =
      Array.isArray(payload.events) && payload.events.length > 0
        ? payload.events
        : // Single-status payload form: wrap the top-level fields as one event.
          [
            {
              code: payload.code,
              status: payload.status,
              description: payload.description,
              occurredAt: payload.occurredAt,
              courierEventId: payload.courierEventId,
              location: payload.location,
            },
          ];

    const out: NormalizedEvent[] = [];
    for (const raw of rawEvents) {
      const statusStr = String(raw.status ?? raw.code ?? '').trim();
      const codeStr = String(raw.code ?? raw.status ?? '').trim();
      if (!statusStr && !codeStr) continue; // empty event — skip

      const occurredAt = this.toDate(raw.occurredAt);
      const mappedStatus = ShippingService.mapStatus(`${statusStr} ${codeStr}`);
      // Bound the courier-supplied id BEFORE it is used as a unique key. A courier
      // could otherwise send a multi-megabyte id and bloat the index / row.
      const courierEventId =
        raw.courierEventId !== undefined &&
        raw.courierEventId !== null &&
        String(raw.courierEventId).length > 0
          ? String(raw.courierEventId).slice(0, COURIER_EVENT_ID_MAX)
          : ShippingService.synthEventId(
              shipmentId,
              codeStr || statusStr,
              occurredAt,
            );

      // Truncate untrusted courier strings to reasonable DB column widths so a
      // single (HMAC-valid) payload cannot amplify into multi-megabyte writes.
      const description = (raw.description ?? (statusStr || codeStr)) || '';
      out.push({
        mappedStatus,
        courierEventId,
        description: description.slice(0, COURIER_EVENT_DESCRIPTION_MAX),
        location:
          raw.location != null
            ? String(raw.location).slice(0, COURIER_EVENT_LOCATION_MAX)
            : undefined,
        occurredAt,
        raw,
      });
    }
    return out;
  }

  /**
   * Allocate the next gapless shipment number INSIDE the caller's tx (advisory
   * lock + SELECT ... FOR UPDATE row lock — the same gapless pattern OrdersService
   * uses for order/PO/RMA numbers). Self-seeds the SHIPMENT scope row.
   */
  private async nextShipmentNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`numseq_${SHIPMENT_SEQUENCE_SCOPE}`}))`;
    await tx.$executeRaw`
      INSERT INTO number_sequences (scope, last_value, prefix, updated_at)
      VALUES (${SHIPMENT_SEQUENCE_SCOPE}, 0, ${SHIPMENT_SEQUENCE_PREFIX}, now())
      ON CONFLICT (scope) DO NOTHING
    `;
    const rows = await tx.$queryRaw<{ last_value: number; prefix: string }[]>(
      Prisma.sql`
        SELECT last_value, prefix FROM number_sequences
        WHERE scope = ${SHIPMENT_SEQUENCE_SCOPE} FOR UPDATE
      `,
    );
    const row = rows[0];
    const next = Number(row?.last_value ?? 0) + 1;
    const prefix = row?.prefix || SHIPMENT_SEQUENCE_PREFIX;
    await tx.$executeRaw`
      UPDATE number_sequences SET last_value = ${next}, updated_at = now()
      WHERE scope = ${SHIPMENT_SEQUENCE_SCOPE}
    `;
    return `${prefix}-${String(next).padStart(6, '0')}`;
  }

  /**
   * Resolve the HMAC secret for a (sanitized) provider key: the provider-specific
   * env var (e.g. DELHIVERY_WEBHOOK_SECRET) when present, otherwise the shared
   * COURIER_WEBHOOK_SECRET. Returns undefined when neither is configured.
   */
  private resolveWebhookSecret(
    safeProviderKey: string | null,
  ): string | undefined {
    const providerSecretKey = courierWebhookSecretKey(
      safeProviderKey ?? undefined,
    );
    const providerSecret = providerSecretKey
      ? this.config.get<string>(providerSecretKey)
      : undefined;
    return (
      providerSecret ||
      this.config.get<string>(COURIER_WEBHOOK_SECRET_KEY) ||
      undefined
    );
  }

  /** Sanitize a free-text provider path param for safe logging / key derivation. */
  private static sanitizeProviderKey(
    providerKey: string | undefined,
  ): string | null {
    if (!providerKey) return null;
    const safe = providerKey.replace(/[^a-z0-9_-]/gi, '').slice(0, 50);
    return safe.length > 0 ? safe : null;
  }

  /**
   * Best-effort "your order has shipped" notification (email + WhatsApp). Resolves
   * the buyer's contact from the order (guest fields, else the linked Customer)
   * and fans out via NotificationService.customerOrderShipped — which is itself
   * non-throwing per channel. The whole call is additionally wrapped by the
   * caller's `.catch`, so a notification failure can NEVER fail the shipment.
   */
  private async notifyShipped(
    order: {
      id: string;
      orderNumber: string;
      guestEmail: string | null;
      guestPhone: string | null;
      customerId: string;
    },
    awb: string,
    courier: Courier,
    trackingUrl: string | null,
  ): Promise<void> {
    // Prefer guest contact fields; fall back to the linked Customer (registered
    // checkout). The Customer lookup is skipped when the guest fields suffice.
    let email = order.guestEmail;
    let phone = order.guestPhone;
    let firstName: string | null = null;
    if (!email || !phone) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: order.customerId },
        select: { email: true, phone: true, firstName: true },
      });
      email = email ?? customer?.email ?? null;
      phone = phone ?? customer?.phone ?? null;
      firstName = customer?.firstName ?? null;
    }

    await this.notifications.customerOrderShipped({
      email,
      firstName,
      phone,
      orderNumber: order.orderNumber,
      courier,
      awb,
      trackingUrl,
    });
  }

  // ── pure static helpers (unit-testable) ──────────────────────────────────

  /** Constant-time HMAC-SHA256 verification over the raw body. */
  private static verifyHmac(
    rawBody: Buffer,
    signature: string | undefined,
    secret: string,
  ): boolean {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    // Some couriers prefix the digest (e.g. 'sha256='); strip a known prefix.
    // Normalize to lowercase: HMAC hex is lowercase by default, but a courier that
    // sends an uppercase digest would otherwise always fail (a false negative).
    const received = (signature ?? '')
      .replace(/^sha256=/i, '')
      .trim()
      .toLowerCase();
    const receivedRaw = Buffer.from(received, 'utf8');
    // Length-equality FIRST. timingSafeEqual requires equal-length buffers, and
    // padding the received value before comparing would let an over-long signature
    // be silently truncated to a (possibly matching) 64-byte slice. A mismatched
    // length is a definitive non-match; the constant-time branch is only reached
    // for the equal-length case (which is the only attack-relevant comparison).
    if (receivedRaw.length !== expectedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuf, receivedRaw);
  }

  /** Pull the AWB out of a (possibly nested) courier payload. */
  private static extractAwb(payload: CourierWebhookDto): string | undefined {
    const candidate =
      payload.awb ??
      (payload['awb_code'] as string | undefined) ??
      (payload['waybill'] as string | undefined) ??
      (payload['tracking_number'] as string | undefined);
    const awb = typeof candidate === 'string' ? candidate.trim() : '';
    return awb.length > 0 ? awb : undefined;
  }

  /** Map a free-text courier status/code to a canonical ShipmentStatus. */
  private static mapStatus(text: string): ShipmentStatus {
    const lower = text.toLowerCase();
    for (const [status, keywords] of STATUS_KEYWORDS) {
      if (keywords.some((k) => lower.includes(k))) {
        return status;
      }
    }
    // Unknown → a safe non-terminal "in transit" so progress is recorded without
    // a false delivery/failure.
    return ShipmentStatus.IN_TRANSIT;
  }

  /**
   * Coerce a courier-supplied timestamp into a valid, BOUNDED Date. The courier
   * payload is untrusted: an arbitrary past `occurredAt` would retroactively open
   * the 7-day returns window, and a future one would close it prematurely (or
   * mis-stamp deliveredAt). So after parsing we clamp:
   *   - reject anything > MAX_EVENT_FUTURE_MS in the future → now
   *   - reject anything > MAX_EVENT_PAST_MS in the past      → now
   * Invalid / absent values also fall back to now. Out-of-range values are logged.
   */
  private toDate(value: string | number | Date | undefined): Date {
    const now = Date.now();
    let d: Date;
    if (value instanceof Date) {
      d = value;
    } else if (value === undefined || value === null) {
      return new Date(now);
    } else {
      d = new Date(value);
    }
    if (Number.isNaN(d.getTime())) return new Date(now);

    const delta = d.getTime() - now;
    if (delta > MAX_EVENT_FUTURE_MS) {
      this.logger.warn(
        `Courier event timestamp ${d.toISOString()} is in the future; clamping to now`,
      );
      return new Date(now);
    }
    if (-delta > MAX_EVENT_PAST_MS) {
      this.logger.warn(
        `Courier event timestamp ${d.toISOString()} is too far in the past; clamping to now`,
      );
      return new Date(now);
    }
    return d;
  }

  /**
   * Synthesize a STABLE dedupe id for events whose courier supplies none, so the
   * @@unique([shipmentId, courierEventId]) constraint never sees NULL (M2a). The
   * same (shipmentId, code, occurredAt) always hashes to the same id, so a
   * re-delivered event with no courier id still dedupes.
   */
  private static synthEventId(
    shipmentId: string,
    code: string,
    occurredAt: Date,
  ): string {
    return crypto
      .createHash('sha256')
      .update(`${shipmentId}|${code}|${occurredAt.toISOString()}`)
      .digest('hex');
  }
}

/** A courier event normalized to our canonical shape + mapped status. */
interface NormalizedEvent {
  mappedStatus: ShipmentStatus;
  courierEventId: string;
  description?: string;
  location?: string;
  occurredAt: Date;
  raw: unknown;
}
