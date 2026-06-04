import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/guards';
import { InventoryService, StockActor } from './inventory.service';
import {
  CreateWarehouseDto,
  InventoryMatrixQueryDto,
  ListWarehousesQueryDto,
  MovementQueryDto,
  StockAdjustDto,
  StockTransferDto,
  UpdateWarehouseDto,
} from './dto';

/**
 * Roles permitted to MUTATE inventory. AdminGuard also admits MODERATOR (content
 * moderation), but a moderator must NOT be able to drain or inflate stock — that
 * is least-privilege. Mutation routes additionally assert this narrower set.
 */
const STOCK_MUTATOR_ROLES = ['ADMIN', 'SUPER_ADMIN'];

// AdminGuard is applied at the CLASS level (CLAUDE.md convention) so a new method
// added without its own decorator is secure by default — never silently public.
// Mutation routes narrow further to ADMIN/SUPER_ADMIN via this.mutator(req).
@UseGuards(AdminGuard)
@Controller('api')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  /** Pin the audit actor to the verified JWT — never accept it from the body. */
  private actor(req: any): StockActor {
    const id = req.user?.id || req.user?.sub;
    if (!id) {
      // A guard-bypassing or malformed token must never silently degrade into a
      // SYSTEM-attributed movement — the audit chain has to stay accurate.
      throw new InternalServerErrorException('Actor identity missing from JWT');
    }
    return { id, role: req.user?.role };
  }

  /**
   * Mutation guard beyond AdminGuard: AdminGuard admits MODERATOR, but stock
   * mutations (adjust/transfer/warehouse CRUD/deactivate) are restricted to
   * ADMIN/SUPER_ADMIN. Returns the pinned actor so callers reuse one read.
   */
  private mutator(req: any): StockActor {
    const actor = this.actor(req);
    if (!actor.role || !STOCK_MUTATOR_ROLES.includes(actor.role)) {
      throw new ForbiddenException(
        'Inventory mutations require ADMIN or SUPER_ADMIN role',
      );
    }
    return actor;
  }

  // ─── Warehouse CRUD (deactivate, never hard-delete) ───────────

  @Get('admin/store/warehouses')
  listWarehouses(@Query() query: ListWarehousesQueryDto) {
    // Least-privilege default: only active warehouses unless explicitly opted in.
    return this.inventory.listWarehouses(query.includeInactive ?? false);
  }

  @Get('admin/store/warehouses/:id')
  getWarehouse(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.getWarehouse(id);
  }

  @Post('admin/store/warehouses')
  createWarehouse(@Body() dto: CreateWarehouseDto, @Req() req: any) {
    this.mutator(req);
    return this.inventory.createWarehouse(dto);
  }

  @Patch('admin/store/warehouses/:id')
  updateWarehouse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
    @Req() req: any,
  ) {
    this.mutator(req);
    return this.inventory.updateWarehouse(id, dto);
  }

  /** Soft-delete: deactivate (isActive=false). FKs are RESTRICT — no hard delete. */
  @Patch('admin/store/warehouses/:id/deactivate')
  deactivateWarehouse(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    this.mutator(req);
    return this.inventory.deactivateWarehouse(id);
  }

  // ─── Stock views ──────────────────────────────────────────────

  @Get('admin/store/inventory')
  getStockMatrix(@Query() query: InventoryMatrixQueryDto) {
    return this.inventory.getStockMatrix(query);
  }

  @Get('admin/store/inventory/:skuId')
  getSkuInventory(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.inventory.getSkuInventory(skuId);
  }

  @Get('admin/store/stock/movements')
  listMovements(@Query() query: MovementQueryDto) {
    return this.inventory.listMovements(query);
  }

  @Get('admin/store/stock/reorder')
  getReorderReport(@Query('warehouseId') warehouseId?: string) {
    return this.inventory.getReorderReport(warehouseId);
  }

  // ─── Mutations ────────────────────────────────────────────────

  @Post('admin/store/inventory/adjust')
  adjust(@Body() dto: StockAdjustDto, @Req() req: any) {
    return this.inventory.adjust(dto, this.mutator(req));
  }

  @Post('admin/store/inventory/transfer')
  transfer(@Body() dto: StockTransferDto, @Req() req: any) {
    return this.inventory.transfer(dto, this.mutator(req));
  }
}
