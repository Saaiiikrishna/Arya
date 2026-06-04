import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { CouponsModule } from '../coupons/coupons.module';
import { InventoryModule } from '../inventory/inventory.module';
import { TaxModule } from '../tax/tax.module';
import { StoreAuthModule } from '../store-auth';
import { SettingsModule } from '../settings/settings.module';
import { DocumentModule } from '../document/document.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrdersAdminController } from './orders-admin.controller';

/**
 * Orders / checkout — THE transactional core (architecture 4.6 / 4.10 / 4.11 /
 * 5.1 / 5.2 / 8.1 / 8.3).
 *
 * Composes the already-built primitives without forking them:
 *  - CartModule        → CartService.getCartForCheckout / markConverted
 *  - CouponsModule     → CouponService.validateCoupon / redeemCoupon
 *  - InventoryModule   → allocateWarehouse / reserveMany / commitReservation /
 *                        releaseReservation / restock (globally lock-ordered)
 *  - TaxModule         → TaxService.computeTax (single computation point)
 *  - StoreAuthModule   → GuestTokenService (mint guest order token) + JwtModule
 *                        (verify CUSTOMER bearer on the dual-auth routes)
 *  - SettingsModule    → SettingsService (single seller GSTIN / state)
 *  - DocumentModule    → DocumentService (order-detail invoice link presign)
 *  - InvoicingModule   → THE single InvoicingService (generateInvoice) consumed
 *                        by the payment webhook. There is exactly ONE invoicing
 *                        implementation (the standalone `invoicing` module) — the
 *                        former duplicate orders-level service was removed so the
 *                        webhook path and the admin endpoint apply identical
 *                        business rules + S3 key scheme on the same Invoice table.
 *  - AuthModule        → registers the platform 'jwt' strategy AdminGuard extends
 *
 * PrismaService + ConfigService are global (@Global PrismaModule / ConfigModule),
 * so they are injectable without an import.
 *
 * EXPORTS OrdersService so the returns / shipping / jobs siblings can call
 * refundOrder / transitionStatus.
 */
@Module({
  imports: [
    AuthModule,
    CartModule,
    CouponsModule,
    InventoryModule,
    TaxModule,
    StoreAuthModule,
    SettingsModule,
    DocumentModule,
    InvoicingModule,
  ],
  controllers: [OrdersController, OrdersAdminController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
