import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { StoreAuthModule } from '../store-auth';
import { ReturnsService } from './returns.service';
import { ReturnsController } from './returns.controller';
import { ReturnsAdminController } from './returns-admin.controller';

/**
 * Returns / RMA module (architecture 4.10; returns decision: 7-day window, FULL
 * refund incl. proportional tax, no restocking fee).
 *
 * Composes the already-built primitives WITHOUT forking them:
 *  - OrdersModule    → OrdersService.refundOrder (Razorpay refund OUTSIDE the tx,
 *                      cumulative-cap + razorpayRefundId @unique idempotency).
 *  - InventoryModule → InventoryService.restock (onHand += , StockMovement RETURN,
 *                      under the (sku,warehouse) advisory lock).
 *  - InvoicingModule → InvoicingService.generateCreditNote (idempotent credit-note
 *                      PDF). The credit-note ISSUE endpoint stays in the invoicing
 *                      controller — this module calls the SERVICE, never duplicates
 *                      the route or the numbering.
 *  - StoreAuthModule → JwtModule (ReturnsService verifies the CUSTOMER bearer on
 *                      the dual-auth store routes; the guest path hashes
 *                      X-Order-Token directly). Identity resolution lives in the
 *                      service, so the store controller injects no PrismaService.
 *  - AuthModule      → registers the platform 'jwt' strategy AdminGuard extends.
 *
 * PrismaService + ConfigService are global (@Global PrismaModule / ConfigModule),
 * and NotificationService is global (@Global NotificationModule — used for the
 * best-effort return-refunded customer notification), so all three are injectable
 * without an import.
 *
 * EXPORTS ReturnsService so future siblings (store-jobs / store-realtime) can
 * compose it.
 */
@Module({
  imports: [
    AuthModule,
    OrdersModule,
    InventoryModule,
    InvoicingModule,
    StoreAuthModule,
  ],
  controllers: [ReturnsController, ReturnsAdminController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
