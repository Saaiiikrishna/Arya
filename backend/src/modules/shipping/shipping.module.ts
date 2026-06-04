import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { StoreAuthModule } from '../store-auth';
import { ShippingService } from './shipping.service';
import { ShippingController } from './shipping.controller';
import { ShippingAdminController } from './shipping-admin.controller';
import { COURIER_PROVIDER } from './shipping.constants';
import {
  CourierProviderFactory,
  ManualCourierProvider,
  ShiprocketCourierProvider,
} from './courier';

/**
 * Shipping / fulfillment module (architecture 4.9 + courier abstraction 8.4).
 *
 * Composes the already-built primitives without forking them:
 *  - OrdersModule    → OrdersService.transitionStatus (order→DELIVERED on the
 *                      delivery webhook; the PACKED→SHIPPED hop is driven inline
 *                      inside the ship() tx so the shipment + order commit atomically)
 *  - SettingsModule  → SettingsService (active courier provider key)
 *  - StoreAuthModule → JwtModule (verify CUSTOMER bearer on the dual-auth tracking
 *                      route) — the same dual-auth pattern OrdersController uses
 *  - AuthModule      → registers the platform 'jwt' strategy AdminGuard extends
 *
 * NotificationService (@Global NotificationModule), PrismaService (@Global
 * PrismaModule) and ConfigService (@Global ConfigModule) are injectable without
 * an import.
 *
 * The active CourierProvider is bound to the COURIER_PROVIDER DI token via the
 * CourierProviderFactory, which resolves manual|shiprocket from SiteSettings/env
 * at runtime (default 'manual'). Both concrete providers are registered so the
 * factory can switch without a redeploy.
 *
 * EXPORTS ShippingService so the store-jobs sibling (courier-sync cron) can call
 * its tracking-ingest path, and ShippingModule for app wiring.
 */
@Module({
  imports: [AuthModule, OrdersModule, SettingsModule, StoreAuthModule],
  controllers: [ShippingController, ShippingAdminController],
  providers: [
    ShippingService,
    ManualCourierProvider,
    ShiprocketCourierProvider,
    CourierProviderFactory,
    // Bind the active-provider DI token to the factory. Consumers inject
    // COURIER_PROVIDER and call resolve() for the currently-configured provider.
    { provide: COURIER_PROVIDER, useExisting: CourierProviderFactory },
  ],
  exports: [ShippingService],
})
export class ShippingModule {}
