import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { StockMovementReason, StockMovementType } from '@prisma/client';

/** Valid `referenceType` discriminators written by inventory movements. */
const REFERENCE_TYPES = [
  'ORDER',
  'CART',
  'PO',
  'RETURN',
  'TRANSFER',
  'ADJUSTMENT',
] as const;

/**
 * Coerce a query-string flag into a strict boolean. Only the literal strings
 * 'true'/'false' (and real booleans) are accepted; anything else stays `undefined`
 * so the companion `@IsBoolean()` rejects it instead of silently coercing (e.g.
 * '0' / 'banana' must NOT become `true`).
 */
function toBool({ value }: { value: unknown }): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** Shared page/limit pagination contract (DRY across inventory query DTOs). */
export class BasePaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** Filters for the admin stock matrix (`GET /api/admin/store/inventory`). */
export class InventoryMatrixQueryDto extends BasePaginationDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  skuId?: string;

  /** Free-text search over sku code / name. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  /** Restrict to rows at/under their reorder point. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  belowReorder?: boolean;
}

/** Filters for the stock-movement ledger (`GET /api/admin/store/stock/movements`). */
export class MovementQueryDto extends BasePaginationDto {
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;

  @IsOptional()
  @IsEnum(StockMovementReason)
  reason?: StockMovementReason;

  /** One of the known movement reference discriminators (ORDER, PO, …). */
  @IsOptional()
  @IsString()
  @IsIn(REFERENCE_TYPES)
  referenceType?: string;

  @IsOptional()
  @IsUUID()
  referenceId?: string;
}
