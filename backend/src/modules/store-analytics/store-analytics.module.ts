import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StoreAnalyticsService } from './store-analytics.service';
import { StoreAnalyticsController } from './store-analytics.controller';

/**
 * Store analytics — admin KPI read surface (architecture Section 8.8).
 *
 * Read-mostly, aggregation-only. Owns no tables of its own: it reads the
 * `StoreDailyStat` rollup (written nightly by the store-jobs rollup cron) plus
 * narrow live aggregates over `orders`/`order_items`/`stock_levels`/`returns`
 * via raw SQL. It edits NO existing service.
 *
 * AuthModule is imported so the platform 'jwt' strategy that `AdminGuard`
 * extends is registered. PrismaService is global (@Global PrismaModule), so it
 * is injectable without an import.
 *
 * The service is intentionally NOT exported: this is a leaf read surface with no
 * other module injecting it. Keeping it unexported avoids needlessly widening
 * the injectable surface (the module edits no existing service).
 */
@Module({
  imports: [AuthModule],
  controllers: [StoreAnalyticsController],
  providers: [StoreAnalyticsService],
})
export class StoreAnalyticsModule {}
