import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { StoreAuthModule } from '../store-auth';
import { DiyController } from './diy.controller';
import { DiyService } from './diy.service';
import { DiyCartAccessGuard } from './guards';

/**
 * DIY & component-bundle module (architecture Section 4.12).
 *
 * Owns DiyGuide / DiyStep / DiyBomItem / ComponentBundle / BundleItem CRUD (admin)
 * and the public `GET /api/store/products/:slug/build` view, plus the public
 * `POST /api/store/diy/:guideId/add-to-cart` purchase path. It references existing
 * Product/Sku rows (owned by `catalog`) and reads StockLevel directly for display —
 * it does NOT duplicate catalog product/sku CRUD, and it does NOT write CartItem
 * rows directly (all cart mutation is delegated to CartService).
 *
 * PrismaModule is @Global() so PrismaService is injectable without importing it.
 *
 * Imports:
 *  - AuthModule: registers the platform 'jwt' Passport strategy that AdminGuard
 *    extends (admin DIY/bundle write endpoints).
 *  - StoreAuthModule: exports CustomerJwtGuard (the 'jwt-customer' strategy) used
 *    by DiyCartAccessGuard for the registered-customer add-to-cart path.
 *  - CartModule: exports CartService, which DiyService delegates to for the
 *    add-to-cart bundle/components flow (single-sourced pricing + line caps).
 *
 * DiyService is exported so later modules (checkout's "buy the full set" / "buy
 * individual" cart flows) can compose bundle/BOM resolution.
 */
@Module({
  imports: [AuthModule, StoreAuthModule, CartModule],
  controllers: [DiyController],
  providers: [DiyService, DiyCartAccessGuard],
  exports: [DiyService],
})
export class DiyModule {}
