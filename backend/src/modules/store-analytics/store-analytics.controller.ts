import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards';
import { StoreAnalyticsService } from './store-analytics.service';
import {
  AnalyticsRangeDto,
  LowStockQueryDto,
  TopProductsQueryDto,
} from './dto';

/**
 * Admin store-analytics surface (architecture Section 8.8). All routes are
 * read-only and AdminGuard-protected. Money is returned as integer paise; the
 * frontend formats paise→rupees — this layer converts nothing.
 *
 * Mounted under `/api` (global convention) → effective paths
 * `/api/admin/store/analytics/*`.
 */
@Controller('api')
@UseGuards(AdminGuard)
export class StoreAnalyticsController {
  constructor(private readonly analytics: StoreAnalyticsService) {}

  /** KPI tiles: orders, revenue, AOV, units, refunds, returns (paise). */
  @Get('admin/store/analytics/summary')
  summary(@Query() query: AnalyticsRangeDto) {
    return this.analytics.summary(query.range);
  }

  /** Per-day revenue time-series for the chart UI (paise), continuous axis. */
  @Get('admin/store/analytics/revenue')
  revenue(@Query() query: AnalyticsRangeDto) {
    return this.analytics.revenueSeries(query.range);
  }

  /** Best-selling products by units/revenue (PAID orders only). */
  @Get('admin/store/analytics/top-products')
  topProducts(@Query() query: TopProductsQueryDto) {
    return this.analytics.topProducts(query);
  }

  /** SKUs at/under reorder point (available = on_hand - reserved), paginated. */
  @Get('admin/store/analytics/low-stock')
  lowStock(@Query() query: LowStockQueryDto) {
    return this.analytics.lowStock(query);
  }

  /** Returns count / orders count + refund value over the range. */
  @Get('admin/store/analytics/returns-rate')
  returnsRate(@Query() query: AnalyticsRangeDto) {
    return this.analytics.returnsRate(query.range);
  }

  /** Total on-hand inventory valued at SKU base price (paise). */
  @Get('admin/store/analytics/inventory-value')
  inventoryValue() {
    return this.analytics.inventoryValue();
  }

  /** Combined inventory health: low-stock count, total value (paise), reorder-pending POs. */
  @Get('admin/store/analytics/inventory-health')
  inventoryHealth() {
    return this.analytics.inventoryHealth();
  }
}
