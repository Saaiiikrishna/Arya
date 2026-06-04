import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StoreAuthModule } from '../store-auth';
import { CouponService } from './coupons.service';
import { CouponsController } from './coupons.controller';
import { CouponsScheduler } from './coupons.scheduler';

/**
 * Coupons: admin CRUD + public validate + the cross-module redeem contract + the
 * daily expiry cron.
 *
 * PrismaService is provided by the @Global() PrismaModule, so it is injectable
 * without an import. AuthModule registers the platform 'jwt' strategy that
 * AdminGuard extends. StoreAuthModule registers the dedicated 'jwt-customer'
 * Passport strategy that OptionalCustomerGuard activates on the public validate
 * route to OPTIONALLY recognise a CUSTOMER bearer token (so the allowGuest gate +
 * per-email pre-check apply for signed-in customers); guests still validate. The
 * guard delegates verification to that strategy — there is no inline JWT verify
 * in this module — so JwtService/ConfigService are no longer controller deps.
 *
 * CouponService is exported for the checkout/cart modules, which call
 * validateCoupon() at quote time and redeemCoupon(tx, …) inside the checkout
 * transaction. CouponsScheduler runs the `store-coupon-expiry` cron (Section 7)
 * via the app-wide ScheduleModule.forRoot(); when the dedicated store-jobs module
 * lands, the cron can move there and call CouponService.expireStaleCoupons().
 */
@Module({
  imports: [AuthModule, StoreAuthModule],
  controllers: [CouponsController],
  providers: [CouponService, CouponsScheduler],
  exports: [CouponService],
})
export class CouponsModule {}
