import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';

/**
 * Purchasing module — owns Supplier + PurchaseOrder + PurchaseOrderLine and the
 * receiving flow (architecture 4.3). Receiving composes InventoryService's stock
 * primitives, so InventoryModule (which exports InventoryService) is imported.
 *
 * PrismaModule is @Global() so PrismaService is injectable without importing it
 * (matches the inventory/catalog module pattern). PurchasingService is exported
 * so later modules (checkout/returns/reorder-cron) can compose it.
 */
@Module({
  imports: [InventoryModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
