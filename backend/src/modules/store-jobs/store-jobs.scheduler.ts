import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  OrderStatus,
  PurchaseOrderStatus,
  ReservationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma';
import { InventoryService } from '../inventory/inventory.service';
import { OrdersService } from '../orders/orders.service';
import { ShippingService } from '../shipping/shipping.service';
import { PurchasingService } from '../purchasing/purchasing.service';
import { EmailService } from '../email/email.service';
import {
  RESERVATION_EXPIRY_BATCH_LIMIT,
  STALE_ORDER_CANCEL_BATCH_LIMIT,
  STALE_UNPAID_ORDER_MS,
  STORE_CRON_TZ,
  STORE_JOB_ANALYTICS_ROLLUP,
  STORE_JOB_VIEWCOUNT_SYNC,
  STORE_JOB_VIEWCOUNT_SYNC_ID,
  STORE_QUEUE,
  SYSTEM_ACTOR,
} from './store-jobs.constants';
import { previousIstDay } from './store-jobs.utils';

/** Default BullMQ enqueue opts for store-queue jobs (Section 7 WorkerHost pattern). */
const STORE_JOB_OPTS = {
  removeOnComplete: true,
  removeOnFail: 100,
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
} as const;

/**
 * store-jobs scheduler (architecture Section 7). Drives every store background
 * job — either inline (the small, latency-tolerant sweeps) or by enqueuing onto
 * `store-queue` (the heavy raw-SQL jobs handled by {@link StoreJobsProcessor}).
 *
 * Crons that the architecture pins to an IST wall-clock time (analytics rollup,
 * reorder digest) run in Asia/Kolkata; interval crons (reservation expiry,
 * courier sync, view-count sync) are timezone-agnostic.
 *
 * Every job is IDEMPOTENT against LIVE state (never the trigger input): each
 * reservation/order/shipment is re-read before acting, the composed service
 * primitives are themselves CAS-guarded, and a per-row try/catch means one bad
 * row never aborts the batch. A cron handler NEVER throws — it logs and returns
 * so the scheduler keeps ticking and the next run retries.
 */
@Injectable()
export class StoreJobsScheduler {
  private readonly logger = new Logger(StoreJobsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly orders: OrdersService,
    private readonly shipping: ShippingService,
    private readonly purchasing: PurchasingService,
    private readonly email: EmailService,
    @InjectQueue(STORE_QUEUE) private readonly storeQueue: Queue,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  //  reservationExpiry (every 5 min) — release expired holds + cancel stale orders
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Every 5 minutes:
   *  1. Release every StockReservation that is ACTIVE AND past its expiresAt, via
   *     InventoryService.releaseReservation (the coupled status-flip +
   *     reserved-decrement CAS pair — idempotent; a row already flipped is a
   *     no-op). This frees abandoned-cart / unpaid-order holds so inventory is
   *     never permanently leaked (Section 5.2 / 7).
   *  2. Cancel orders still PENDING_PAYMENT older than the reuse-window + grace
   *     (~30 min) via OrdersService.transitionStatus(→CANCELLED, SYSTEM), which
   *     itself releases any remaining ACTIVE reservations and restocks committed
   *     stock. CANCELLED is the only legal hop from PENDING_PAYMENT.
   *
   * IDEMPOTENT: both steps re-check live state — a reservation already
   * EXPIRED/RELEASED/CONSUMED is skipped by releaseReservation; an order no
   * longer PENDING_PAYMENT (paid mid-window, or already cancelled) is skipped by
   * transitionStatus's same-state no-op / illegal-transition guard. Per-row
   * try/catch isolates failures.
   */
  @Cron('0 */5 * * * *', { name: 'store-reservation-expiry' })
  async reservationExpiry(): Promise<void> {
    const now = new Date();

    // ── (1) release expired ACTIVE reservations.
    let released = 0;
    let releaseErrors = 0;
    try {
      const expired = await this.prisma.stockReservation.findMany({
        where: { status: ReservationStatus.ACTIVE, expiresAt: { lt: now } },
        select: { id: true },
        take: RESERVATION_EXPIRY_BATCH_LIMIT,
        orderBy: { expiresAt: 'asc' },
      });
      for (const r of expired) {
        try {
          // expired:true → terminal status EXPIRED; SYSTEM actor for the audit row.
          const did = await this.inventory.releaseReservation(
            this.prisma,
            r.id,
            {
              expired: true,
              actor: SYSTEM_ACTOR,
            },
          );
          if (did) released++;
        } catch (e) {
          releaseErrors++;
          this.logger.error(
            `reservationExpiry: failed to release reservation ${r.id}: ${(e as Error)?.message}`,
          );
        }
      }
    } catch (e) {
      this.logger.error(
        `reservationExpiry: reservation sweep query failed: ${(e as Error)?.message}`,
      );
    }

    // ── (2) cancel stale unpaid orders (releases their remaining stock).
    let cancelled = 0;
    let cancelSkipped = 0; // benign race: order got paid mid-window (ConflictException)
    let cancelErrors = 0; // genuine, unexpected failures
    try {
      const cutoff = new Date(now.getTime() - STALE_UNPAID_ORDER_MS);
      const stale = await this.prisma.order.findMany({
        where: {
          status: OrderStatus.PENDING_PAYMENT,
          createdAt: { lt: cutoff },
        },
        select: { id: true, orderNumber: true },
        take: STALE_ORDER_CANCEL_BATCH_LIMIT,
        orderBy: { createdAt: 'asc' },
      });
      for (const o of stale) {
        try {
          await this.orders.transitionStatus(
            o.id,
            OrderStatus.CANCELLED,
            SYSTEM_ACTOR,
            'Auto-cancelled: payment not completed within the reservation window',
          );
          cancelled++;
        } catch (e) {
          if (e instanceof ConflictException) {
            // The order left PENDING_PAYMENT between our read and the transition —
            // almost always a concurrent capture (it got PAID), surfaced as an
            // illegal-transition Conflict. This is the CORRECT, HEALTHY outcome,
            // not an error: count it as a skip and log at debug so a window where
            // many orders are paid does not masquerade as a wall of warnings.
            cancelSkipped++;
            this.logger.debug(
              `reservationExpiry: skipped stale order ${o.orderNumber} (no longer PENDING_PAYMENT — likely paid mid-window): ${(e as Error)?.message}`,
            );
          } else {
            // Any other exception type is a genuine, unexpected failure.
            cancelErrors++;
            this.logger.error(
              `reservationExpiry: failed to cancel stale order ${o.orderNumber}: ${(e as Error)?.message}`,
            );
          }
        }
      }
    } catch (e) {
      this.logger.error(
        `reservationExpiry: stale-order query failed: ${(e as Error)?.message}`,
      );
    }

    if (
      released > 0 ||
      cancelled > 0 ||
      releaseErrors > 0 ||
      cancelSkipped > 0 ||
      cancelErrors > 0
    ) {
      this.logger.log(
        `reservationExpiry: released=${released} (err=${releaseErrors}), ` +
          `cancelledOrders=${cancelled} (skipped=${cancelSkipped}, err=${cancelErrors})`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  reorderAlerts (daily 06:00 IST) — admin alert + auto-draft POs
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Daily at 06:00 IST: pull the inventory reorder report (SKUs at/below their
   * per-warehouse reorder point with a positive suggested qty). If any:
   *  - best-effort admin alert by email (each active platform ADMIN is emailed;
   *    the Admin model has no phone so WhatsApp is not a channel — never blocks)
   *  - auto-draft replenishment POs via PurchasingService.reorderToDraftPo
   *    (groups by inferred supplier; SKUs with no purchase history are skipped).
   *
   * IDEMPOTENT (architecture Section 7 — "skip SKUs already on an open PO"): the
   * reorder report reflects live stock, and BEFORE drafting we compute the set of
   * SKUs already covered by an open DRAFT/SUBMITTED PO and pass it as the
   * exclusion to reorderToDraftPo. So a second daily run — or two replicas firing
   * together — never drafts a duplicate replenishment PO for the same
   * under-stocked SKU; only genuinely-uncovered SKUs are drafted.
   */
  @Cron('0 0 6 * * *', {
    name: 'store-reorder-alerts',
    timeZone: STORE_CRON_TZ,
  })
  async reorderAlerts(): Promise<void> {
    try {
      const report = await this.inventory.getReorderReport();
      if (report.count === 0) {
        return; // nothing below reorder point
      }

      // Best-effort admin alert by email (non-blocking; EmailService.sendEmail
      // returns false rather than throwing, and the fan-out is allSettled).
      await this.alertAdminsLowStock(report.count).catch((e) =>
        this.logger.error(
          `reorderAlerts: admin alert failed: ${(e as Error)?.message}`,
        ),
      );

      // Dedup gate (Section 7): collect every SKU already on an OPEN
      // (DRAFT/SUBMITTED) PO line so reorderToDraftPo skips it — no duplicate
      // auto-draft for a SKU that already has an open replenishment order.
      const excludeSkuIds = await this.openPoSkuIds();

      // Auto-draft replenishment POs (best-effort; never throws out of the cron).
      try {
        const result = await this.purchasing.reorderToDraftPo(
          SYSTEM_ACTOR,
          undefined,
          { excludeSkuIds },
        );
        this.logger.log(
          `reorderAlerts: ${report.count} SKU(s) below reorder point; ` +
            `${excludeSkuIds.size} already on an open PO; ` +
            `drafted ${result.created.length} PO(s), skipped ${result.skipped?.length ?? 0}`,
        );
      } catch (e) {
        this.logger.error(
          `reorderAlerts: auto-draft PO failed: ${(e as Error)?.message}`,
        );
      }
    } catch (e) {
      this.logger.error(
        `reorderAlerts: reorder report failed: ${(e as Error)?.message}`,
      );
    }
  }

  /**
   * Distinct set of skuIds that appear on at least one OPEN (DRAFT or SUBMITTED)
   * purchase-order line. Used by reorderAlerts to skip auto-drafting a SKU that
   * already has an open replenishment PO (Section 7 dedup). One indexed query;
   * no per-SKU N+1.
   */
  private async openPoSkuIds(): Promise<Set<string>> {
    const lines = await this.prisma.purchaseOrderLine.findMany({
      where: {
        purchaseOrder: {
          status: {
            in: [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.SUBMITTED],
          },
        },
      },
      select: { skuId: true },
      distinct: ['skuId'],
    });
    return new Set(lines.map((l) => l.skuId));
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  courierSync (every 15 min) — poll active courier for non-terminal shipments
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Every 15 minutes (architecture Section 7): poll the active courier provider
   * for tracking updates on non-terminal shipments and ingest them through the
   * shipping module's existing idempotent dedupe/advance/deliver path. The actual
   * work + the manual-provider skip live in ShippingService.syncActiveShipments
   * (its SHIPMENT_SYNC_STALE_MS staleness window is tuned below this 15-min
   * cadence); this cron is the trigger + a thin log.
   *
   * IDEMPOTENT: syncActiveShipments re-reads live shipment state and dedupes every
   * event on `@@unique([shipmentId, courierEventId])`. Skips entirely when the
   * active provider is `manual` (no upstream feed).
   */
  @Cron('0 */15 * * * *', { name: 'store-courier-sync' })
  async courierSync(): Promise<void> {
    try {
      const res = await this.shipping.syncActiveShipments();
      if (res.polled > 0 || res.failed > 0) {
        this.logger.log(
          `courierSync: polled=${res.polled} updated=${res.updated} skipped=${res.skipped} failed=${res.failed}`,
        );
      }
    } catch (e) {
      this.logger.error(`courierSync failed: ${(e as Error)?.message}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  analyticsRollup (daily 01:30 IST) — enqueue raw-SQL StoreDailyStat upsert
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Daily at 01:30 IST (architecture Section 7): enqueue the previous-IST-day
   * StoreDailyStat rollup onto store-queue (handled by
   * StoreJobsProcessor.analyticsRollup, which does the whole aggregate in raw
   * SQL — Section 8.8). Enqueuing (rather than running inline) gives BullMQ
   * retry/backoff if Postgres is briefly unavailable at 01:30. The processor's
   * upsert is idempotent per stat_date, so a retry is safe.
   */
  @Cron('0 30 1 * * *', {
    name: 'store-analytics-rollup',
    timeZone: STORE_CRON_TZ,
  })
  async analyticsRollup(): Promise<void> {
    try {
      // jobId pins one rollup per (job, day) so a duplicate cron fire (clock skew
      // / overlapping replicas) coalesces to a single queued job per day.
      const day = previousIstDay();
      await this.storeQueue.add(
        STORE_JOB_ANALYTICS_ROLLUP,
        { statDate: day },
        { ...STORE_JOB_OPTS, jobId: `${STORE_JOB_ANALYTICS_ROLLUP}:${day}` },
      );
    } catch (e) {
      this.logger.error(
        `analyticsRollup: failed to enqueue: ${(e as Error)?.message}`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  viewCountSync (hourly) — enqueue raw-SQL Product/Article viewCount refresh
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Hourly: enqueue the Product/Article viewCount refresh from DailyPageStat onto
   * store-queue (handled by StoreJobsProcessor.viewCountSync, raw-SQL UPDATE …
   * FROM grouped subqueries — Section 8.12). Best-effort; idempotent (absolute SET
   * from the authoritative aggregate).
   *
   * A CONSTANT jobId coalesces duplicate hourly fires (clock skew / overlapping
   * replicas) to a single queued job — the parameterless absolute-SET semantics
   * make a single run sufficient (mirrors the per-day jobId on analyticsRollup).
   */
  @Cron('0 0 * * * *', { name: 'store-viewcount-sync' })
  async viewCountSync(): Promise<void> {
    try {
      await this.storeQueue.add(
        STORE_JOB_VIEWCOUNT_SYNC,
        {},
        { ...STORE_JOB_OPTS, jobId: STORE_JOB_VIEWCOUNT_SYNC_ID },
      );
    } catch (e) {
      this.logger.error(
        `viewCountSync: failed to enqueue: ${(e as Error)?.message}`,
      );
    }
  }

  // ── internal helpers ────────────────────────────────────────────────────────

  /**
   * Best-effort low-stock alert to every active platform ADMIN. This is an OPS
   * alert (inventory/purchasing is an admin concern), so it targets platform
   * admins by email — the Admin model has no phone, so WhatsApp is not a channel
   * here. EmailService.sendEmail is non-throwing (returns false on failure); we
   * additionally Promise.allSettled the fan-out so one bad recipient never aborts
   * the others, and the whole call is wrapped by the caller's .catch.
   */
  private async alertAdminsLowStock(skuCount: number): Promise<void> {
    const admins = await this.prisma.admin.findMany({
      where: { isActive: true },
      select: { email: true, firstName: true },
    });
    if (admins.length === 0) return;

    const subject = `Low stock alert: ${skuCount} SKU(s) at or below reorder point`;
    await Promise.allSettled(
      admins.map((a) =>
        this.email.sendEmail({
          to: a.email,
          subject,
          htmlBody:
            `<p>Hi ${a.firstName || 'Admin'},</p>` +
            `<p><strong>${skuCount}</strong> SKU(s) are at or below their reorder point. ` +
            `Draft replenishment purchase orders have been generated for your review in the admin store dashboard.</p>` +
            `<p>— Aryavartham store automation</p>`,
        }),
      ),
    );
  }
}
