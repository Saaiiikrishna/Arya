import { Module } from '@nestjs/common';
import { StoreAuthModule } from '../store-auth';
import { TaxModule } from '../tax/tax.module';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { CartAccessGuard } from './guards';

/**
 * Cart module (architecture 4.5). Owns Cart + CartItem lifecycle for BOTH guests
 * (X-Cart-Token via GuestTokenService/CartAccessGuard) and registered customers
 * (CUSTOMER JWT). Prices are always recomputed server-side; stock is never
 * reserved here (that is checkout's job).
 *
 * Imports:
 *  - StoreAuthModule: exports GuestTokenService (mint guest cart tokens) and
 *    CustomerJwtGuard (used by CartAccessGuard to authorize the customer path).
 *  - TaxModule: exports TaxService for the GST totals preview.
 *
 * PrismaModule is @Global() so PrismaService is injectable without importing it
 * (matches the payment/inventory/tax module pattern).
 *
 * Coupon dependency: CartService injects the coupon validator under the
 * COUPON_SERVICE token with @Optional(). The coupon module (built in parallel)
 * registers its CouponService under that token, so cart wires to it at runtime
 * without a compile-time import of the coupon module's files. If coupon is not
 * yet present, the coupon endpoints fail closed (503) and the rest of the cart
 * works normally.
 *
 * EXPORTS CartService so checkout-order can consume getCartForCheckout() /
 * markConverted() per the cross-module contract.
 */
@Module({
  imports: [StoreAuthModule, TaxModule],
  controllers: [CartController],
  providers: [CartService, CartAccessGuard],
  exports: [CartService],
})
export class CartModule {}
