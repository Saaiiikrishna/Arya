import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';

/**
 * Inventory module — owns StockLevel / StockMovement / StockReservation and the
 * concurrency-safe stock primitives (reserveMany / releaseReservation /
 * commitReservation / restock / allocateWarehouse). InventoryService is exported
 * so checkout-order, procurement and returns can compose it.
 *
 * PrismaModule is @Global() so PrismaService is injectable here without importing
 * it (matches the equity/payment module pattern).
 */
@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
