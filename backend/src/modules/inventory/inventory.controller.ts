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

  @UseGuards(AdminGuard)
  @Get('admin/store/warehouses')
  listWarehouses(@Query('includeInactive') includeInactive?: string) {
    // Least-privilege default: only active warehouses unless explicitly opted in.
    return this.inventory.listWarehouses(includeInactive === 'true');
  }

  @UseGuards(AdminGuard)
  @Get('admin/store/warehouses/:id')
  getWarehouse(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.getWarehouse(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/store/warehouses')
  createWarehouse(@Body() dto: CreateWarehouseDto, @Req() req: any) {
    this.mutator(req);
    return this.inventory.createWarehouse(dto);
  }

  @UseGuards(AdminGuard)
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
  @UseGuards(AdminGuard)
  @Patch('admin/store/warehouses/:id/deactivate')
  deactivateWarehouse(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    this.mutator(req);
    return this.inventory.deactivateWarehouse(id);
  }

  // ─── Stock views ──────────────────────────────────────────────

  @UseGuards(AdminGuard)
  @Get('admin/store/inventory')
  getStockMatrix(@Query() query: InventoryMatrixQueryDto) {
    return this.inventory.getStockMatrix(query);
  }

  @UseGuards(AdminGuard)
  @Get('admin/store/inventory/:skuId')
  getSkuInventory(@Param('skuId', ParseUUIDPipe) skuId: string) {
    return this.inventory.getSkuInventory(skuId);
  }

  @UseGuards(AdminGuard)
  @Get('admin/store/stock/movements')
  listMovements(@Query() query: MovementQueryDto) {
    return this.inventory.listMovements(query);
  }

  @UseGuards(AdminGuard)
  @Get('admin/store/stock/reorder')
  getReorderReport(@Query('warehouseId') warehouseId?: string) {
    return this.inventory.getReorderReport(warehouseId);
  }

  // ─── Mutations ────────────────────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/store/inventory/adjust')
  adjust(@Body() dto: StockAdjustDto, @Req() req: any) {
    return this.inventory.adjust(dto, this.mutator(req));
  }

  @UseGuards(AdminGuard)
  @Post('admin/store/inventory/transfer')
  transfer(@Body() dto: StockTransferDto, @Req() req: any) {
    return this.inventory.transfer(dto, this.mutator(req));
  }
}
