import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsRange, LowStockQueryDto, TopProductsQueryDto } from './dto';

/**
 * Store analytics — admin KPIs (architecture Section 8.8).
 *
 * Read-mostly and aggregation-only. EVERY figure is produced with raw SQL
 * (`Prisma.$queryRaw` with `Prisma.sql` parameterisation) so the database does
 * the `SUM`/`COUNT`/`GROUP BY` — there is NEVER a Node-side loop over order or
 * order-item rows (Section 8.8 forbids it: at 10k orders/day × ~5 items a Node
 * loop over 50k rows is unacceptable). Historical ranges read the precomputed
 * `StoreDailyStat` rollup; the current IST day reads a narrow live aggregate as
 * a fallback because the nightly rollup has not yet written today's row.
 *
 * Money is integer paise throughout — this service converts NOTHING; the
 * frontend formats paise→rupees at the boundary.
 */
@Injectable()
export class StoreAnalyticsService {
  private readonly logger = new Logger(StoreAnalyticsService.name);

  /**
   * Hard cap on the low-stock page size, independent of the DTO `@Max`, so the
   * endpoint can never materialise an unbounded slice even if the DTO guard is
   * ever loosened.
   */
  private static readonly LOW_STOCK_MAX_LIMIT = 200;
  private static readonly LOW_STOCK_DEFAULT_LIMIT = 50;

  /**
   * Orders are timestamped in UTC; the programme operates on IST (Asia/Kolkata,
   * fixed +05:30, no DST). Day windows are therefore computed by shifting into
   * IST, truncating to the day, and shifting back — all inside SQL via
   * `AT TIME ZONE`, never with a JS Date arithmetic that could drift.
   */
  private static readonly IST_TZ = 'Asia/Kolkata';

  /**
   * The set of order states that count as "paid" for revenue/units. A fully
   * REFUNDED order was still paid (its revenue is recognised then netted by the
   * refund figure), and PARTIALLY_REFUNDED is obviously paid. We key off
   * `payment_status` (not `status`) because that is the money-truth column and
   * survives fulfilment-state churn (PROCESSING/SHIPPED/DELIVERED…).
   */
  private static readonly PAID_PAYMENT_STATUSES = [
    'PAID',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
  ];

  constructor(private readonly prisma: PrismaService) {}

  // ─── range resolution ────────────────────────────────────────

  /** Number of whole IST days a range spans, anchored on "today". */
  private rangeDays(range: AnalyticsRange | undefined): number {
    switch (range) {
      case 'today':
        return 1;
      case '30d':
        return 30;
      case '7d':
      default:
        return 7;
    }
  }

  /**
   * `[start, end)` half-open UTC instants for the IST day window covering
   * `rangeDays` days up to and including the current IST day. Computed in SQL so
   * the IST boundary is authoritative and matches the nightly rollup's windows.
   *
   * `end` is the start of *tomorrow* (IST) → strictly excludes future rows and
   * makes "today" a half-open [00:00 today, 00:00 tomorrow) window.
   */
  private async resolveWindow(
    days: number,
  ): Promise<{ start: Date; end: Date; startDate: string; endDate: string }> {
    const rows = await this.prisma.$queryRaw<
      { start: Date; end: Date; start_date: string; end_date: string }[]
    >(Prisma.sql`
      WITH today_ist AS (
        SELECT (now() AT TIME ZONE ${StoreAnalyticsService.IST_TZ})::date AS d
      )
      SELECT
        ((SELECT d FROM today_ist) - make_interval(days => ${days - 1}))::timestamp
          AT TIME ZONE ${StoreAnalyticsService.IST_TZ} AS start,
        ((SELECT d FROM today_ist) + make_interval(days => 1))::timestamp
          AT TIME ZONE ${StoreAnalyticsService.IST_TZ} AS end,
        ((SELECT d FROM today_ist) - make_interval(days => ${days - 1}))::date AS start_date,
        (SELECT d FROM today_ist)::date AS end_date
    `);
    const r = rows[0];
    if (!r) {
      this.logger.error('resolveWindow: IST window query returned no rows');
      throw new InternalServerErrorException(
        'Analytics window query returned no rows',
      );
    }
    return {
      start: r.start,
      end: r.end,
      startDate: this.toDateString(r.start_date),
      endDate: this.toDateString(r.end_date),
    };
  }

  /** Normalise a DATE coming back from pg (Date | string) to 'YYYY-MM-DD'. */
  private toDateString(v: Date | string): string {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  }

  /** Coerce a pg numeric/bigint aggregate (string | bigint | number | null) to a JS number. */
  private num(v: unknown): number {
    if (v === null || v === undefined) return 0;
    return Number(v);
  }

  /**
   * SQL fragment selecting orders that are "paid" by payment_status, for a given
   * table alias. Single source of truth for the paid-order predicate — every
   * query (outer or joined) must use this so the set of "paid" statuses can
   * never silently diverge between two parts of the same query (e.g. revenue vs
   * units). `alias` is a hard-coded server-side string, never client input.
   */
  private paidFilter(alias: string): Prisma.Sql {
    return Prisma.sql`${Prisma.raw(alias)}.payment_status IN (${Prisma.join(
      StoreAnalyticsService.PAID_PAYMENT_STATUSES,
    )})`;
  }

  /** Paid-order predicate for the conventional `o` order alias. */
  private get paidFilterSql(): Prisma.Sql {
    return this.paidFilter('o');
  }

  /**
   * Shared low-stock predicate over `stock_levels sl` / `skus s`: available
   * (`on_hand - reserved`) at/under the reorder point, the SKU is reorderable
   * (a non-zero reorder point or qty), and the SKU is active. Single source of
   * truth so the `low-stock` list, its count, and the `inventory-health`
   * low-stock signal all agree on the same definition.
   */
  private get lowStockPredicate(): Prisma.Sql {
    return Prisma.sql`(sl.on_hand - sl.reserved) <= sl.reorder_point
      AND (sl.reorder_point > 0 OR sl.reorder_qty > 0)
      AND s.is_active = true`;
  }

  // ─── 1. summary ──────────────────────────────────────────────

  /**
   * KPI summary for the range. Historical days are summed from the precomputed
   * `StoreDailyStat` rollup (one indexed row per day → fast); the current IST
   * day, whose rollup row does not exist yet, is computed live from a narrow
   * indexed aggregate and added on top. The two never double-count because the
   * rollup only ever contains *completed* prior days.
   *
   * @returns all monetary fields in integer paise.
   */
  async summary(range: AnalyticsRange | undefined): Promise<{
    range: AnalyticsRange;
    orders: number;
    revenuePaise: number;
    aovPaise: number;
    units: number;
    refundsPaise: number;
    returns: number;
  }> {
    const resolved: AnalyticsRange = range ?? '7d';
    const days = this.rangeDays(resolved);
    const { end, startDate, endDate } = await this.resolveWindow(days);

    // Prior, completed IST days from the rollup. For 'today' (days=1) the rollup
    // window is empty (start_date === end_date === today) and only the live
    // fallback contributes.
    const rollup =
      days > 1
        ? await this.summaryFromRollup(startDate, endDate)
        : this.emptyRollupAgg();

    // Current IST day, live (the rollup has not written today yet).
    const live = await this.summaryLiveToday(end, endDate);

    const orders = rollup.orders + live.orders;
    const revenuePaise = rollup.revenuePaise + live.revenuePaise;
    const units = rollup.units + live.units;
    const refundsPaise = rollup.refundsPaise + live.refundsPaise;
    const returns = rollup.returns + live.returns;

    return {
      range: resolved,
      orders,
      revenuePaise,
      aovPaise: orders > 0 ? Math.round(revenuePaise / orders) : 0,
      units,
      refundsPaise,
      returns,
    };
  }

  private emptyRollupAgg() {
    return {
      orders: 0,
      revenuePaise: 0,
      units: 0,
      refundsPaise: 0,
      returns: 0,
    };
  }

  /**
   * Sum the rollup over [startDate, endDate) — i.e. all completed prior days in
   * the range, EXCLUDING the current day (endDate), which is handled live. Uses
   * `paid_orders` / `gross_revenue` / `units_sold` / `refunds_total` from the
   * `store_daily_stats` table.
   */
  private async summaryFromRollup(startDate: string, endDate: string) {
    const rows = await this.prisma.$queryRaw<
      {
        orders: bigint | null;
        revenue: bigint | null;
        units: bigint | null;
        refunds: bigint | null;
      }[]
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(paid_orders), 0)   AS orders,
        COALESCE(SUM(gross_revenue), 0) AS revenue,
        COALESCE(SUM(units_sold), 0)    AS units,
        COALESCE(SUM(refunds_total), 0) AS refunds
      FROM store_daily_stats
      WHERE stat_date >= ${startDate}::date
        AND stat_date <  ${endDate}::date
    `);
    const r = rows[0];
    // Returns count is not in the rollup schema; derive it for the prior window
    // straight from the returns table (cheap, indexed on created_at via PK scan
    // bounded by the window). Kept separate so the rollup stays the money source.
    const returns = await this.returnsCountBetween(startDate, endDate);
    return {
      orders: this.num(r?.orders),
      revenuePaise: this.num(r?.revenue),
      units: this.num(r?.units),
      refundsPaise: this.num(r?.refunds),
      returns,
    };
  }

  /** Live aggregate for the current IST day only: [endDate 00:00 IST, end). */
  private async summaryLiveToday(end: Date, endDate: string) {
    // Start of the current IST day (= endDate at 00:00 IST), as a UTC instant.
    const dayStart = await this.istDayStart(endDate);

    // Single pass over the day's paid orders. Units come from a per-order
    // pre-aggregate of order_items (LEFT JOIN onto a derived sum) so the
    // order-level grand_total/refunded_total SUMs are NOT multiplied by the
    // line-item fan-out. The paid predicate is the shared `paidFilter` helper
    // (same set of statuses as revenue) — no correlated re-scan, no divergent
    // status literal (Section 8.8 "no N+1").
    const orderRows = await this.prisma.$queryRaw<
      {
        orders: bigint | null;
        revenue: bigint | null;
        refunds: bigint | null;
        units: bigint | null;
      }[]
    >(Prisma.sql`
      SELECT
        COUNT(*)::bigint                       AS orders,
        COALESCE(SUM(o.grand_total), 0)        AS revenue,
        COALESCE(SUM(o.refunded_total), 0)     AS refunds,
        COALESCE(SUM(oiu.units), 0)::bigint    AS units
      FROM orders o
      LEFT JOIN (
        SELECT oi.order_id AS order_id, SUM(oi.quantity) AS units
        FROM order_items oi
        GROUP BY oi.order_id
      ) oiu ON oiu.order_id = o.id
      WHERE ${this.paidFilterSql}
        AND o.created_at >= ${dayStart}
        AND o.created_at <  ${end}
    `);
    const r = orderRows[0];

    const returnRows = await this.prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS c
      FROM returns
      WHERE created_at >= ${dayStart}
        AND created_at <  ${end}
    `);

    return {
      orders: this.num(r?.orders),
      revenuePaise: this.num(r?.revenue),
      units: this.num(r?.units),
      refundsPaise: this.num(r?.refunds),
      returns: this.num(returnRows[0]?.c),
    };
  }

  /** UTC instant for 00:00 IST of the given 'YYYY-MM-DD' IST date. */
  private async istDayStart(istDate: string): Promise<Date> {
    const rows = await this.prisma.$queryRaw<{ ts: Date }[]>(Prisma.sql`
      SELECT (${istDate}::date)::timestamp
        AT TIME ZONE ${StoreAnalyticsService.IST_TZ} AS ts
    `);
    if (!rows[0]) {
      this.logger.error('istDayStart: IST day-start query returned no rows');
      throw new InternalServerErrorException(
        'Analytics day-start query returned no rows',
      );
    }
    return rows[0].ts;
  }

  /** Returns created in the half-open IST date window [startDate, endDate). */
  private async returnsCountBetween(
    startDate: string,
    endDate: string,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS c
      FROM returns r
      WHERE (r.created_at AT TIME ZONE ${StoreAnalyticsService.IST_TZ})::date >= ${startDate}::date
        AND (r.created_at AT TIME ZONE ${StoreAnalyticsService.IST_TZ})::date <  ${endDate}::date
    `);
    return this.num(rows[0]?.c);
  }

  // ─── 2. top products ─────────────────────────────────────────

  /**
   * Best sellers over the range by units and revenue. Joins `order_items` →
   * `orders` (paid only, by created_at window) → `skus` → `products`, grouped by
   * product in SQL. The aggregation is entirely in the database (no N+1): one
   * grouped scan, ordered by units desc, capped by `limit`.
   *
   * Revenue here is `taxable_value` (pre-tax line value after discount) summed
   * per product, in paise — the comparable "sales" figure for a leaderboard.
   * Falls back to skuId join when a product was deleted (sku_id SetNull on the
   * order item) by left-joining and bucketing orphans under their name snapshot.
   */
  async topProducts(query: TopProductsQueryDto): Promise<{
    range: AnalyticsRange;
    limit: number;
    data: {
      productId: string | null;
      productName: string;
      productSlug: string | null;
      units: number;
      revenuePaise: number;
      orders: number;
    }[];
  }> {
    const resolved: AnalyticsRange = query.range ?? '7d';
    const days = this.rangeDays(resolved);
    const limit = Math.min(Math.max(query.limit ?? 10, 1), 50);
    const { start, end } = await this.resolveWindow(days);

    const rows = await this.prisma.$queryRaw<
      {
        product_id: string | null;
        product_name: string;
        product_slug: string | null;
        units: bigint | null;
        revenue: bigint | null;
        orders: bigint | null;
      }[]
    >(Prisma.sql`
      SELECT
        p.id                                   AS product_id,
        COALESCE(p.name, oi.name_snapshot)     AS product_name,
        p.slug                                 AS product_slug,
        SUM(oi.quantity)::bigint               AS units,
        SUM(oi.taxable_value)::bigint          AS revenue,
        COUNT(DISTINCT oi.order_id)::bigint    AS orders
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN skus s     ON s.id = oi.sku_id
      LEFT JOIN products p ON p.id = s.product_id
      WHERE ${this.paidFilterSql}
        AND o.created_at >= ${start}
        AND o.created_at <  ${end}
      GROUP BY p.id, p.slug, COALESCE(p.name, oi.name_snapshot)
      ORDER BY units DESC, revenue DESC
      LIMIT ${limit}
    `);

    return {
      range: resolved,
      limit,
      data: rows.map((r) => ({
        productId: r.product_id,
        productName: r.product_name,
        productSlug: r.product_slug,
        units: this.num(r.units),
        revenuePaise: this.num(r.revenue),
        orders: this.num(r.orders),
      })),
    };
  }

  // ─── 3. low stock ────────────────────────────────────────────

  /**
   * SKUs whose available stock (`on_hand - reserved`) has fallen to or below the
   * per-warehouse reorder point. The column-to-column predicate cannot be
   * expressed in Prisma's typed `where`, so the whole filter + pagination is
   * pushed into SQL (page-of-rows and total share the SAME predicate, keeping
   * pagination consistent — the inventory module uses the identical idiom).
   *
   * Capped, paginated. Returns paise for `basePrice`.
   */
  async lowStock(query: LowStockQueryDto): Promise<{
    data: {
      stockLevelId: string;
      skuId: string;
      skuCode: string;
      skuName: string | null;
      warehouseId: string;
      warehouseCode: string;
      warehouseName: string;
      onHand: number;
      reserved: number;
      available: number;
      reorderPoint: number;
      reorderQty: number;
      shortfall: number;
      basePricePaise: number;
    }[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(
      Math.max(query.limit ?? StoreAnalyticsService.LOW_STOCK_DEFAULT_LIMIT, 1),
      StoreAnalyticsService.LOW_STOCK_MAX_LIMIT,
    );
    const skip = (page - 1) * limit;

    const predicate = this.lowStockPredicate;

    const dataRows = await this.prisma.$queryRaw<
      {
        stock_level_id: string;
        sku_id: string;
        sku_code: string;
        sku_name: string | null;
        warehouse_id: string;
        warehouse_code: string;
        warehouse_name: string;
        on_hand: number;
        reserved: number;
        available: number;
        reorder_point: number;
        reorder_qty: number;
        base_price: number;
      }[]
    >(Prisma.sql`
      SELECT
        sl.id            AS stock_level_id,
        sl.sku_id        AS sku_id,
        s.sku_code       AS sku_code,
        s.name           AS sku_name,
        sl.warehouse_id  AS warehouse_id,
        w.code           AS warehouse_code,
        w.name           AS warehouse_name,
        sl.on_hand       AS on_hand,
        sl.reserved      AS reserved,
        (sl.on_hand - sl.reserved) AS available,
        sl.reorder_point AS reorder_point,
        sl.reorder_qty   AS reorder_qty,
        s.base_price     AS base_price
      FROM stock_levels sl
      JOIN skus s      ON s.id = sl.sku_id
      JOIN warehouses w ON w.id = sl.warehouse_id
      WHERE ${predicate}
      ORDER BY (sl.on_hand - sl.reserved) ASC, sl.sku_id ASC, sl.warehouse_id ASC
      LIMIT ${limit} OFFSET ${skip}
    `);

    const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM stock_levels sl
        JOIN skus s      ON s.id = sl.sku_id
        JOIN warehouses w ON w.id = sl.warehouse_id
        WHERE ${predicate}
      `,
    );
    const total = this.num(countRows[0]?.count);

    return {
      data: dataRows.map((r) => ({
        stockLevelId: r.stock_level_id,
        skuId: r.sku_id,
        skuCode: r.sku_code,
        skuName: r.sku_name,
        warehouseId: r.warehouse_id,
        warehouseCode: r.warehouse_code,
        warehouseName: r.warehouse_name,
        onHand: this.num(r.on_hand),
        reserved: this.num(r.reserved),
        available: this.num(r.available),
        reorderPoint: this.num(r.reorder_point),
        reorderQty: this.num(r.reorder_qty),
        shortfall: Math.max(
          0,
          this.num(r.reorder_point) - this.num(r.available),
        ),
        basePricePaise: this.num(r.base_price),
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  // ─── 4. returns rate ─────────────────────────────────────────

  /**
   * Returns rate over the range: returns count / paid-orders count, plus total
   * refund value (paise). Two narrow SQL aggregates, both windowed by the IST
   * day boundary on `created_at`. Rate is returned as a basis-points-free ratio
   * (0..1) AND a pre-rounded percentage for convenience; money stays paise.
   */
  async returnsRate(range: AnalyticsRange | undefined): Promise<{
    range: AnalyticsRange;
    orders: number;
    returns: number;
    ratePercent: number;
    refundValuePaise: number;
  }> {
    const resolved: AnalyticsRange = range ?? '7d';
    const days = this.rangeDays(resolved);
    const { start, end } = await this.resolveWindow(days);

    const orderRows = await this.prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS c
      FROM orders o
      WHERE ${this.paidFilterSql}
        AND o.created_at >= ${start}
        AND o.created_at <  ${end}
    `);
    const orders = this.num(orderRows[0]?.c);

    const returnRows = await this.prisma.$queryRaw<
      { c: bigint; refunds: bigint | null }[]
    >(Prisma.sql`
      SELECT
        COUNT(*)::bigint                  AS c,
        COALESCE(SUM(r.refund_amount), 0) AS refunds
      FROM returns r
      WHERE r.created_at >= ${start}
        AND r.created_at <  ${end}
    `);
    const returns = this.num(returnRows[0]?.c);
    const refundValuePaise = this.num(returnRows[0]?.refunds);

    return {
      range: resolved,
      orders,
      returns,
      ratePercent:
        orders > 0 ? Math.round((returns / orders) * 10000) / 100 : 0,
      refundValuePaise,
    };
  }

  // ─── 5. inventory value ──────────────────────────────────────

  /**
   * Total on-hand inventory valued at SKU base price, across active SKUs only:
   * `SUM(on_hand * base_price)` in paise, computed entirely in SQL (one grouped
   * scan, no Node iteration). Also returns the contributing line/SKU counts so
   * the dashboard can show coverage.
   */
  async inventoryValue(): Promise<{
    totalValuePaise: number;
    totalOnHand: number;
    skuCount: number;
    stockLevelCount: number;
  }> {
    const rows = await this.prisma.$queryRaw<
      {
        value: bigint | null;
        on_hand: bigint | null;
        sku_count: bigint | null;
        level_count: bigint | null;
      }[]
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(sl.on_hand::bigint * s.base_price::bigint), 0) AS value,
        COALESCE(SUM(sl.on_hand), 0)                               AS on_hand,
        COUNT(DISTINCT sl.sku_id)::bigint                          AS sku_count,
        COUNT(*)::bigint                                           AS level_count
      FROM stock_levels sl
      JOIN skus s ON s.id = sl.sku_id
      WHERE s.is_active = true
        AND sl.on_hand > 0
    `);
    const r = rows[0];
    return {
      totalValuePaise: this.num(r?.value),
      totalOnHand: this.num(r?.on_hand),
      skuCount: this.num(r?.sku_count),
      stockLevelCount: this.num(r?.level_count),
    };
  }

  // ─── 6. revenue time-series ──────────────────────────────────

  /**
   * Per-IST-day revenue breakdown for the range (architecture Section 4.13
   * `revenue`) — distinct from the aggregate `summary`. Prior, completed days
   * are read straight from the `StoreDailyStat` rollup (one indexed row per
   * day); the current IST day, whose rollup row does not exist yet, is appended
   * from the same narrow live aggregate `summary` uses. Days with no orders are
   * filled with zeroes so the chart has a continuous x-axis.
   *
   * @returns one point per day, ascending by date; all monetary fields paise.
   */
  async revenueSeries(range: AnalyticsRange | undefined): Promise<{
    range: AnalyticsRange;
    data: {
      date: string;
      orders: number;
      revenuePaise: number;
      refundsPaise: number;
      netRevenuePaise: number;
      units: number;
    }[];
  }> {
    const resolved: AnalyticsRange = range ?? '7d';
    const days = this.rangeDays(resolved);
    const { end, startDate, endDate } = await this.resolveWindow(days);

    // Prior completed days from the rollup, keyed by 'YYYY-MM-DD'. For 'today'
    // (days=1) the window [startDate, endDate) is empty and only live applies.
    const rollupByDate = new Map<
      string,
      {
        orders: number;
        revenuePaise: number;
        refundsPaise: number;
        netRevenuePaise: number;
        units: number;
      }
    >();
    if (days > 1) {
      const rollupRows = await this.prisma.$queryRaw<
        {
          stat_date: Date | string;
          orders: bigint | null;
          revenue: bigint | null;
          refunds: bigint | null;
          net: bigint | null;
          units: bigint | null;
        }[]
      >(Prisma.sql`
        SELECT
          stat_date            AS stat_date,
          paid_orders          AS orders,
          gross_revenue        AS revenue,
          refunds_total        AS refunds,
          net_revenue          AS net,
          units_sold           AS units
        FROM store_daily_stats
        WHERE stat_date >= ${startDate}::date
          AND stat_date <  ${endDate}::date
        ORDER BY stat_date ASC
      `);
      for (const row of rollupRows) {
        rollupByDate.set(this.toDateString(row.stat_date), {
          orders: this.num(row.orders),
          revenuePaise: this.num(row.revenue),
          refundsPaise: this.num(row.refunds),
          netRevenuePaise: this.num(row.net),
          units: this.num(row.units),
        });
      }
    }

    // Current IST day, live.
    const live = await this.summaryLiveToday(end, endDate);
    rollupByDate.set(endDate, {
      orders: live.orders,
      revenuePaise: live.revenuePaise,
      refundsPaise: live.refundsPaise,
      netRevenuePaise: live.revenuePaise - live.refundsPaise,
      units: live.units,
    });

    // Build the continuous ascending date axis [startDate .. endDate].
    const data = this.eachIstDate(startDate, endDate).map((date) => {
      const v = rollupByDate.get(date);
      return {
        date,
        orders: v?.orders ?? 0,
        revenuePaise: v?.revenuePaise ?? 0,
        refundsPaise: v?.refundsPaise ?? 0,
        netRevenuePaise: v?.netRevenuePaise ?? 0,
        units: v?.units ?? 0,
      };
    });

    return { range: resolved, data };
  }

  /**
   * Inclusive ascending list of 'YYYY-MM-DD' strings from `startDate` to
   * `endDate`. Pure UTC-noon arithmetic on the calendar date (no timezone
   * involved — the dates are already IST calendar days resolved in SQL), so DST
   * cannot perturb the day count.
   */
  private eachIstDate(startDate: string, endDate: string): string[] {
    const out: string[] = [];
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    for (
      let d = start;
      d.getTime() <= end.getTime();
      d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
    ) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  // ─── 7. inventory health ─────────────────────────────────────

  /**
   * Combined inventory health signal for the admin dashboard (architecture
   * Section 4.13 `inventory-health`): the low-stock SKU count (same predicate as
   * the `low-stock` report), total on-hand inventory value in paise, and the
   * count of reorder-pending purchase orders (POs not yet fully received and not
   * cancelled). Three narrow indexed aggregates, all DB-side (no N+1).
   *
   * @returns `totalValuePaise` in integer paise.
   */
  async inventoryHealth(): Promise<{
    lowStockCount: number;
    totalValuePaise: number;
    totalOnHand: number;
    skuCount: number;
    reorderPendingCount: number;
  }> {
    const lowStockRows = await this.prisma.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM stock_levels sl
        JOIN skus s ON s.id = sl.sku_id
        WHERE ${this.lowStockPredicate}
      `,
    );
    const lowStockCount = this.num(lowStockRows[0]?.count);

    const value = await this.inventoryValue();

    const poRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM purchase_orders po
      WHERE po.status IN ('DRAFT', 'SUBMITTED', 'PARTIALLY_RECEIVED')
    `);
    const reorderPendingCount = this.num(poRows[0]?.count);

    return {
      lowStockCount,
      totalValuePaise: value.totalValuePaise,
      totalOnHand: value.totalOnHand,
      skuCount: value.skuCount,
      reorderPendingCount,
    };
  }
}
