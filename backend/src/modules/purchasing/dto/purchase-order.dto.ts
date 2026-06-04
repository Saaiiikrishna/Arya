import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PurchaseOrderStatus } from '@prisma/client';

/** Magnitude caps so a single PO cannot overflow Int paise totals. */
export const PO_MAX_QTY = 1_000_000;
export const PO_MAX_UNIT_COST_PAISE = 1_000_000_000; // ₹10,000,000 / unit
export const PO_MAX_LINES = 500;
export const PO_MAX_LOT_NO = 100_000;
/** Hard cap on admin list page size (mirrors inventory's MAX_PAGE_LIMIT). */
export const PO_LIST_MAX_LIMIT = 200;

/**
 * One purchase-order line. The schema keys uniqueness on (po, sku, lotNo), so the
 * same SKU may appear on several lines as separate lots at different unit costs.
 *
 * Money is integer PAISE on the wire here (`unitCostPaise`) — this is an internal
 * admin surface, not a rupee-facing customer DTO, so no rupee→paise boundary
 * conversion is performed; the value is persisted verbatim into `unit_cost`.
 */
export class CreatePurchaseOrderLineDto {
  @IsUUID()
  skuId!: string;

  /**
   * Optional per-line warehouse. The schema models warehouse at the PO HEADER
   * (one fulfilment/receiving warehouse per PO), so if supplied this MUST equal
   * the header warehouseId — the service rejects a mismatch. Receiving always
   * targets the header warehouse.
   */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsInt()
  @Min(1)
  @Max(PO_MAX_QTY)
  orderedQty!: number;

  @IsInt()
  @Min(0)
  @Max(PO_MAX_UNIT_COST_PAISE)
  unitCostPaise!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PO_MAX_LOT_NO)
  lotNo?: number;

  /** GST basis points for this lot (1800 = 18%); used only for PO-total display. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  taxBps?: number;
}

/** Admin create-PO payload (status starts DRAFT). */
export class CreatePurchaseOrderDto {
  @IsUUID()
  supplierId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PO_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines!: CreatePurchaseOrderLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Receive a single PO line: bump receivedQty by `receivedQty` (≤ remaining). */
export class ReceivePoLineDto {
  @IsUUID()
  lineId!: string;

  @IsInt()
  @Min(1)
  @Max(PO_MAX_QTY)
  receivedQty!: number;
}

/** Batched receive — one or more lines in a single idempotent receipt. */
export class ReceivePoLinesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PO_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => ReceivePoLineDto)
  lines!: ReceivePoLineDto[];
}

/** PO list filter. */
export class ListPurchaseOrdersQueryDto {
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  status?: PurchaseOrderStatus;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  /** 1-based page number (defaults to 1 in the service). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Page size; the service hard-caps this at MAX_PAGE_LIMIT. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PO_LIST_MAX_LIMIT)
  limit?: number;
}

/**
 * Auto-reorder draft query. `warehouseId` is validated as a UUID at the boundary
 * so a malformed value can never reach the raw-SQL `${warehouseId}::uuid` cast in
 * InventoryService.getReorderReport (which would surface as an uncontrolled 500).
 */
export class ReorderDraftQueryDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
