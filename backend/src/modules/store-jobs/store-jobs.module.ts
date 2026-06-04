import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { ShippingModule } from '../shipping/shipping.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { EmailModule } from '../email/email.module';
import { StoreJobsScheduler } from './store-jobs.scheduler';
import { StoreJobsProcessor } from './store-jobs.processor';
import { STORE_QUEUE } from './store-jobs.constants';

/**
 * store-jobs — all store/commerce background work (architecture Section 7).
 *
 * Composes the already-built service primitives without forking them; it owns NO
 * domain state of its own:
 *  - InventoryModule  → InventoryService.releaseReservation / getReorderReport
 *  - OrdersModule     → OrdersService.transitionStatus (cancel stale unpaid orders)
 *  - ShippingModule   → ShippingService.syncActiveShipments (courier-sync poll)
 *  - PurchasingModule → PurchasingService.reorderToDraftPo (auto-draft replenishment)
 *  - EmailModule      → EmailService (best-effort admin low-stock alert)
 *
 * PrismaService is global (@Global PrismaModule), injectable without an import.
 * ScheduleModule is registered globally at app bootstrap (ScheduleModule.forRoot
 * in jobs.module), so @Cron decorators here are discovered without re-registering
 * it. The BullMQ `store-queue` is registered here for the heavy raw-SQL jobs
 * (analytics rollup, view-count sync) handled by StoreJobsProcessor; the BullMQ
 * root connection is configured globally in app.module (BullModule.forRootAsync).
 *
 * EXPORTS StoreJobsScheduler + StoreJobsProcessor (concrete providers) so a test
 * harness / admin trigger can invoke a job on demand. It deliberately does NOT
 * re-export BullModule: leaking the `store-queue` registration would let any
 * importer inject the raw Queue and enqueue arbitrary jobs, bypassing this
 * module's ownership of store-queue work. A sibling that legitimately needs to
 * enqueue should get a thin, intention-revealing enqueue method here rather than
 * the raw queue — no such consumer exists today.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: STORE_QUEUE }),
    InventoryModule,
    OrdersModule,
    ShippingModule,
    PurchasingModule,
    EmailModule,
  ],
  providers: [StoreJobsScheduler, StoreJobsProcessor],
  exports: [StoreJobsScheduler, StoreJobsProcessor],
})
export class StoreJobsModule {}
