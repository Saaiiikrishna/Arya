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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AdminRole } from '@prisma/client';
import { AdminGuard } from '../auth/guards';
import { StockActor } from '../inventory/inventory.service';
import { PurchasingService } from './purchasing.service';
import {
  CreatePurchaseOrderDto,
  CreateSupplierDto,
  ListPurchaseOrdersQueryDto,
  ListSuppliersQueryDto,
  ReceivePoLinesDto,
  ReorderDraftQueryDto,
  UpdateSupplierDto,
} from './dto';

/**
 * Roles permitted to MUTATE procurement. AdminGuard also admits MODERATOR, but a
 * moderator is read-only here — creating suppliers, raising/receiving POs, and
 * reorder-drafting move money and stock, so they are restricted to ADMIN /
 * SUPER_ADMIN (least privilege, mirrors InventoryController). Sourced from the
 * typed AdminRole enum (not raw strings) so a role rename can never silently
 * widen this gate.
 */
const PURCHASING_MUTATOR_ROLES: string[] = [
  AdminRole.ADMIN,
  AdminRole.SUPER_ADMIN,
];

@UseGuards(ThrottlerGuard)
@Controller('api')
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  /** Pin the audit actor to the verified JWT — never accept it from the body. */
  private actor(req: any): StockActor {
    const id = req.user?.id ?? req.user?.sub;
    if (!id) {
      throw new InternalServerErrorException('Actor identity missing from JWT');
    }
    return { id, role: req.user?.role };
  }

  /** Mutation gate: ADMIN/SUPER_ADMIN only; MODERATOR is read-only. */
  private mutator(req: any): StockActor {
    const actor = this.actor(req);
    if (!actor.role || !PURCHASING_MUTATOR_ROLES.includes(actor.role)) {
      throw new ForbiddenException(
        'Procurement mutations require ADMIN or SUPER_ADMIN role',
      );
    }
    return actor;
  }

  // ─── Suppliers ────────────────────────────────────────────────

  @Throttle({ medium: { limit: 100, ttl: 60_000 } })
  @UseGuards(AdminGuard)
  @Get('admin/store/suppliers')
  listSuppliers(@Query() query: ListSuppliersQueryDto) {
    return this.purchasing.listSuppliers(query);
  }

  @Throttle({ medium: { limit: 100, ttl: 60_000 } })
  @UseGuards(AdminGuard)
  @Get('admin/store/suppliers/:id')
  getSupplier(@Param('id', ParseUUIDPipe) id: string) {
    return this.purchasing.getSupplier(id);
  }

  @Throttle({ medium: { limit: 100, ttl: 60_000 } })
  @UseGuards(AdminGuard)
  @Post('admin/store/suppliers')
  createSupplier(@Body() dto: CreateSupplierDto, @Req() req: any) {
    this.mutator(req);
    return this.purchasing.createSupplier(dto);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/store/suppliers/:id')
  updateSupplier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
    @Req() req: any,
  ) {
    this.mutator(req);
    return this.purchasing.updateSupplier(id, dto);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/store/suppliers/:id/deactivate')
  deactivateSupplier(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    this.mutator(req);
    return this.purchasing.deactivateSupplier(id);
  }

  // ─── Purchase orders ──────────────────────────────────────────

  @Throttle({ medium: { limit: 100, ttl: 60_000 } })
  @UseGuards(AdminGuard)
  @Get('admin/store/purchase-orders')
  listPurchaseOrders(@Query() query: ListPurchaseOrdersQueryDto) {
    return this.purchasing.listPurchaseOrders(query);
  }

  @Throttle({ medium: { limit: 100, ttl: 60_000 } })
  @UseGuards(AdminGuard)
  @Get('admin/store/purchase-orders/:id')
  getPurchaseOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.purchasing.getPurchaseOrder(id);
  }

  @Throttle({ medium: { limit: 100, ttl: 60_000 } })
  @UseGuards(AdminGuard)
  @Post('admin/store/purchase-orders')
  createPurchaseOrder(@Body() dto: CreatePurchaseOrderDto, @Req() req: any) {
    return this.purchasing.createPurchaseOrder(dto, this.mutator(req));
  }

  @UseGuards(AdminGuard)
  @Patch('admin/store/purchase-orders/:id/submit')
  submitPurchaseOrder(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    this.mutator(req);
    return this.purchasing.placePurchaseOrder(id);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/store/purchase-orders/:id/cancel')
  cancelPurchaseOrder(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    this.mutator(req);
    return this.purchasing.cancelPurchaseOrder(id);
  }

  @Throttle({ medium: { limit: 100, ttl: 60_000 } })
  @UseGuards(AdminGuard)
  @Post('admin/store/purchase-orders/:id/receive')
  receivePurchaseOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceivePoLinesDto,
    @Req() req: any,
  ) {
    return this.purchasing.receivePurchaseOrder(id, dto, this.mutator(req));
  }

  // ─── Auto-reorder → DRAFT PO (best-effort builder) ────────────

  @Throttle({ medium: { limit: 100, ttl: 60_000 } })
  @UseGuards(AdminGuard)
  @Post('admin/store/purchase-orders/reorder-draft')
  reorderToDraftPo(@Req() req: any, @Query() query: ReorderDraftQueryDto) {
    return this.purchasing.reorderToDraftPo(this.mutator(req), query.warehouseId);
  }
}
