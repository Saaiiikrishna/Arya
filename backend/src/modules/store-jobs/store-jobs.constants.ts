/**
 * store-jobs constants (architecture Section 7).
 *
 * All money is integer paise; all timing constants are milliseconds. Crons run in
 * Asia/Kolkata where the architecture pins an IST clock time (analytics rollup,
 * reorder digest); interval crons (reservation expiry, courier sync, view-count
 * sync) are timezone-agnostic.
 */

import type { StockActor } from '../inventory/inventory.service';

/** BullMQ queue backing the store-jobs async work (analytics rollup, view-count sync). */
export const STORE_QUEUE = 'store-queue';

/**
 * SYSTEM actor for cron-initiated, non-principal mutations (audit trail). Typed
 * as the inventory module's StockActor (structurally identical to OrdersService
 * OrderActor / PurchasingService's actor param), so the same singleton is passed
 * to releaseReservation / transitionStatus / reorderToDraftPo without redefining
 * the sentinel — or its shape — per call site. Mirrors inventory.service's own
 * private SYSTEM_ACTOR; a type-only import keeps store-jobs in its edit lane
 * (no mutation of inventory.service.ts).
 */
export const SYSTEM_ACTOR: StockActor = { id: 'SYSTEM', role: 'SYSTEM' };

/** IANA timezone all wall-clock store crons + the analytics IST-day window use. */
export const STORE_CRON_TZ = 'Asia/Kolkata';

// ─── Job names on STORE_QUEUE ───────────────────────────────────────────────
export const STORE_JOB_ANALYTICS_ROLLUP = 'store-analytics-rollup';
export const STORE_JOB_VIEWCOUNT_SYNC = 'store-viewcount-sync';

/**
 * Stable BullMQ jobId for the view-count sync. Because the job is parameterless
 * and absolute-SET (a re-run converges), a CONSTANT jobId coalesces duplicate
 * hourly fires (clock skew / overlapping replicas) to a single queued job —
 * mirroring the per-day jobId pin on the analytics rollup.
 */
export const STORE_JOB_VIEWCOUNT_SYNC_ID = STORE_JOB_VIEWCOUNT_SYNC;

/**
 * Total age at which the reservation-expiry cron cancels a still-unpaid order.
 * The reservation TTL itself (OrdersService RESERVATION_TTL_MS) is 30 min; we
 * deliberately wait LONGER than the TTL — TTL (30 min) + 15 min grace = 45 min —
 * before cancelling an order that is STILL PENDING_PAYMENT, so a customer whose
 * capture is in flight near the 30-min TTL boundary is never cancelled out from
 * under an in-progress payment. This grace MUST stay strictly greater than
 * RESERVATION_TTL_MS; if the TTL changes, bump this in lockstep.
 */
export const STALE_UNPAID_ORDER_MS = 45 * 60 * 1000; // 30-min TTL + 15-min grace

/** Hard cap on rows processed per reservation-expiry cron pass (bounds one run). */
export const RESERVATION_EXPIRY_BATCH_LIMIT = 500;
/** Hard cap on stale unpaid orders cancelled per cron pass. */
export const STALE_ORDER_CANCEL_BATCH_LIMIT = 500;
