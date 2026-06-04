import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma';
import {
  STORE_JOB_ANALYTICS_ROLLUP,
  STORE_JOB_VIEWCOUNT_SYNC,
  STORE_QUEUE,
} from './store-jobs.constants';
import { isIsoDateString, previousIstDay } from './store-jobs.utils';

/**
 * store-queue worker (architecture Section 7). Hosts the heavy, raw-SQL store
 * jobs the scheduler enqueues:
 *  - store-analytics-rollup  — nightly upsert of one StoreDailyStat row for the
 *    previous IST day, computed entirely in SQL (no Node-side row iteration —
 *    Section 8.8).
 *  - store-viewcount-sync    — hourly refresh of Product/Article.viewCount from
 *    DailyPageStat path aggregates, via raw UPDATE … FROM grouped subqueries.
 *
 * Every job is IDEMPOTENT against LIVE state: the rollup is an upsert keyed on
 * stat_date; the view-count sync overwrites counters from the authoritative
 * DailyPageStat totals (absolute SET, not additive), so a re-run converges.
 *
 * Errors are caught per job and logged; BullMQ retries per the enqueue opts. We
 * never throw the scheduler down.
 */
@Processor(STORE_QUEUE)
export class StoreJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(StoreJobsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case STORE_JOB_ANALYTICS_ROLLUP:
        return this.analyticsRollup(job);
      case STORE_JOB_VIEWCOUNT_SYNC:
        return this.viewCountSync();
      default:
        this.logger.warn(`Unknown store-queue job: ${job.name}`);
        return undefined;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  store-analytics-rollup (Section 7 / 8.8) — raw-SQL upsert, prior IST day
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Upsert one StoreDailyStat row for an IST day (default: yesterday IST).
   *
   * Everything is computed in SQL via $executeRaw — orders count, paid-orders
   * count, gross revenue (sum grandTotal where paymentStatus=PAID), net revenue
   * (gross − refunds), units sold (sum order_items.quantity on paid orders),
   * refunds total, discount total, new customers, and rolled-up visitors from
   * DailyPageStat. No order/orderItem rows are loaded into Node (Section 8.8: a
   * Node loop over ~50k rows/day is unacceptable).
   *
   * DAY BUCKETING: orders / units / new-customers are bucketed by the IST
   * calendar date of their own `created_at`. REFUNDS are a DISTINCT EVENT — a
   * refund happens (and must be counted) on the day the money goes back, not the
   * day the order was placed. They are therefore aggregated from `returns` by the
   * IST date of `refunded_at` (COMPLETED refunds only), so an order placed on D1
   * and refunded on D2 contributes its refund to D2's bucket — and `net_revenue`
   * here is same-day gross minus same-day refunds (a daily cash-flow view).
   *
   * IDEMPOTENT: `INSERT … ON CONFLICT (stat_date) DO UPDATE` keyed on the unique
   * stat_date, so a re-run for the same day overwrites the row with freshly
   * recomputed aggregates (and bumps updated_at).
   */
  async analyticsRollup(job: Job): Promise<{ statDate: string }> {
    // The IST calendar date to roll up. `job.data.statDate` (YYYY-MM-DD) lets a
    // manual backfill target a specific day; default is "yesterday" in IST.
    const data = (job.data ?? {}) as { statDate?: string };
    const statDate: string = data.statDate ?? previousIstDay();

    // Validate the inbound day BEFORE it reaches the raw SQL. Prisma's tagged
    // template parameterizes ${statDate} (so this is NOT an injection vector),
    // but a malformed value would fail the Postgres `::date` cast on every one of
    // the 3 BullMQ attempts. Throw UnrecoverableError so the queue classifies it
    // as non-retriable instead of burning the backoff on a guaranteed-bad input.
    if (!isIsoDateString(statDate)) {
      throw new UnrecoverableError(
        `store-analytics-rollup: invalid statDate "${statDate}" (expected YYYY-MM-DD)`,
      );
    }

    // One statement. All sub-aggregates are scalar subqueries over the IST-day
    // window so the planner runs each once; nothing is iterated in Node.
    //
    // IST-day window: an orders.created_at falls in `statDate` iff its date in
    // Asia/Kolkata equals statDate. We compare on the converted date so the
    // index-friendly half-open range [day 00:00 IST, next-day 00:00 IST) is used.
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO store_daily_stats AS sds (
        id, stat_date, orders_count, paid_orders, gross_revenue, net_revenue,
        units_sold, refunds_total, discount_total, new_customers, visitors,
        created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        ${statDate}::date,
        COALESCE(o.orders_count, 0),
        COALESCE(o.paid_orders, 0),
        COALESCE(o.gross_revenue, 0),
        COALESCE(o.gross_revenue, 0) - COALESCE(r.refunds_total, 0),
        COALESCE(u.units_sold, 0),
        COALESCE(r.refunds_total, 0),
        COALESCE(o.discount_total, 0),
        COALESCE(c.new_customers, 0),
        COALESCE(v.visitors, 0),
        now(),
        now()
      FROM
        (
          SELECT
            COUNT(*)::int AS orders_count,
            COUNT(*) FILTER (WHERE payment_status = 'PAID')::int AS paid_orders,
            COALESCE(SUM(grand_total) FILTER (WHERE payment_status = 'PAID'), 0)::int AS gross_revenue,
            COALESCE(SUM(discount_total) FILTER (WHERE payment_status = 'PAID'), 0)::int AS discount_total
          FROM orders
          WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = ${statDate}::date
        ) o
        CROSS JOIN (
          SELECT COALESCE(SUM(oi.quantity), 0)::int AS units_sold
          FROM order_items oi
          JOIN orders ord ON ord.id = oi.order_id
          WHERE ord.payment_status = 'PAID'
            AND (ord.created_at AT TIME ZONE 'Asia/Kolkata')::date = ${statDate}::date
        ) u
        CROSS JOIN (
          -- Refunds are bucketed by the IST date the refund COMPLETED (refunded_at),
          -- not the order's created_at, so a refund lands in the day it happened.
          SELECT COALESCE(SUM(refund_amount), 0)::int AS refunds_total
          FROM returns
          WHERE refund_status = 'COMPLETED'
            AND refunded_at IS NOT NULL
            AND (refunded_at AT TIME ZONE 'Asia/Kolkata')::date = ${statDate}::date
        ) r
        CROSS JOIN (
          SELECT COUNT(*)::int AS new_customers
          FROM customers
          WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = ${statDate}::date
        ) c
        CROSS JOIN (
          SELECT COALESCE(SUM(views), 0)::int AS visitors
          FROM daily_page_stats
          WHERE date = ${statDate}::date
            AND (path LIKE '/store%' OR path LIKE '/articles%')
        ) v
      ON CONFLICT (stat_date) DO UPDATE SET
        orders_count   = EXCLUDED.orders_count,
        paid_orders    = EXCLUDED.paid_orders,
        gross_revenue  = EXCLUDED.gross_revenue,
        net_revenue    = EXCLUDED.net_revenue,
        units_sold     = EXCLUDED.units_sold,
        refunds_total  = EXCLUDED.refunds_total,
        discount_total = EXCLUDED.discount_total,
        new_customers  = EXCLUDED.new_customers,
        visitors       = EXCLUDED.visitors,
        updated_at     = now()
    `);

    this.logger.log(
      `store-analytics-rollup upserted StoreDailyStat ${statDate}`,
    );
    return { statDate };
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  store-viewcount-sync (Section 8.12) — raw-SQL UPDATE … FROM aggregates
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Refresh Product.viewCount + Article.viewCount from the authoritative
   * DailyPageStat path aggregates, in two raw `UPDATE … FROM (grouped subquery)`
   * statements (Section 8.12 — never inline per-request to avoid hot-row
   * contention). Paths are matched by slug:
   *   `/store/products/<slug>`  → products.slug
   *   `/articles/<slug>`        → articles.slug
   *
   * IDEMPOTENT: viewCount is SET to the absolute aggregate total (not
   * incremented), so a re-run converges to the same value. NOT swallowed here: an
   * exception from either $executeRaw propagates to process() and is retried by
   * BullMQ per STORE_JOB_OPTS (attempts: 3, exponential backoff) — counters are a
   * display nicety, so a transient failure simply retries rather than corrupting
   * anything. Only rows whose total actually differs are written, to avoid
   * needless `updated_at` churn on every product/article hourly.
   */
  async viewCountSync(): Promise<{ products: number; articles: number }> {
    // Products: aggregate views per '/store/products/<slug>' path. split_part on
    // the 4th '/'-segment yields the slug; an empty slug (trailing-slash path)
    // is excluded. The WHERE p.view_count <> agg guard skips unchanged rows.
    const productRows = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE products p
      SET view_count = agg.total, updated_at = now()
      FROM (
        SELECT split_part(path, '/', 4) AS slug, COALESCE(SUM(views), 0)::int AS total
        FROM daily_page_stats
        WHERE path LIKE '/store/products/%'
        GROUP BY split_part(path, '/', 4)
      ) agg
      WHERE p.slug = agg.slug
        AND agg.slug <> ''
        AND p.view_count <> agg.total
    `);

    const articleRows = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE articles a
      SET view_count = agg.total, updated_at = now()
      FROM (
        SELECT split_part(path, '/', 3) AS slug, COALESCE(SUM(views), 0)::int AS total
        FROM daily_page_stats
        WHERE path LIKE '/articles/%'
        GROUP BY split_part(path, '/', 3)
      ) agg
      WHERE a.slug = agg.slug
        AND agg.slug <> ''
        AND a.view_count <> agg.total
    `);

    if (productRows > 0 || articleRows > 0) {
      this.logger.log(
        `store-viewcount-sync updated ${productRows} products + ${articleRows} articles`,
      );
    }
    return { products: productRows, articles: articleRows };
  }
}
