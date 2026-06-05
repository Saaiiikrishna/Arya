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
 * Coerce a query-string flag into a strict boolean for the companion
 * `@IsBoolean()` guard.
 *
 * IMPORTANT: the global ValidationPipe runs with
 * `transformOptions.enableImplicitConversion: true`. Implicit conversion coerces
 * the property to its reflected `boolean` design-type BEFORE a `@Transform`
 * inspects the value, and its coercion is permissive — every non-empty string
 * (`'banana'`, `'0'`, `'1'`) becomes `true`. Reading the already-converted
 * `value` would therefore see a bogus `true` and the strict check would be a
 * no-op. We instead read the ORIGINAL plain value from `obj[key]`, which is
 * untouched by implicit conversion, and:
 *   - map the literal strings 'true'/'false' (and real booleans) to booleans,
 *   - leave absent/null as `undefined` so `@IsOptional()` skips it,
 *   - return any OTHER value unchanged so `@IsBoolean()` REJECTS it (rather than
 *     silently coercing '0'/'banana' to `true` or dropping it to `undefined`).
 */
function toBool({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown {
  const raw = obj?.[key];
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === undefined || raw === null) return undefined;
  return raw; // invalid input preserved so @IsBoolean() fails validation
}

/**
 * Filter for the warehouse list (`GET /api/admin/store/warehouses`). The
 * `includeInactive` flag is coerced via the same strict `toBool` transform used
 * by every other inventory query DTO — no raw string comparison in the controller.
 */
export class ListWarehousesQueryDto {
  /** Opt in to include deactivated warehouses (default: active only). */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeInactive?: boolean;
}

/**
 * Coerce an absent/blank pagination value to a default, otherwise pass the value
 * through UNCHANGED so the companion `@IsInt()`/`@Min()`/`@Max()` guards still
 * reject garbage (e.g. `page=banana`, `page=0`, `limit=999`). We read the ORIGINAL
 * plain value from `obj[key]` (not the implicitly-converted `value`) for the same
 * reason `toBool` does — `enableImplicitConversion` would otherwise have already
 * turned an absent value into `NaN`/`0` before this transform runs. Only `undefined`
 * / `null` / `''` map to the default; every other input is preserved verbatim.
 */
function defaultPositiveInt(
  fallback: number,
): ({ obj, key }: { obj: Record<string, unknown>; key: string }) => unknown {
  return ({ obj, key }) => {
    const raw = obj?.[key];
    if (raw === undefined || raw === null || raw === '') return fallback;
    // Query params arrive as strings. Coerce a NUMERIC string to a number so the
    // companion @IsInt()/@Min()/@Max() see a number (a bare string fails @IsInt()
    // even for "50" — and this transform runs alongside @Type(()=>Number), so we
    // must not hand back a string). Non-numeric garbage (e.g. "banana") is left
    // as-is so @IsInt() correctly REJECTS it; "0"/"1.5"/"999" coerce to numbers
    // and are then caught by @Min()/@IsInt()/@Max() as intended.
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed);
    }
    return raw; // non-numeric → preserved so @IsInt()/@Min()/@Max() reject it
  };
}

/**
 * Shared page/limit pagination contract (DRY across inventory query DTOs).
 * Defaults are applied AT THE DTO LEVEL (page→1, limit→50) via `@Transform`, so the
 * resolved value is self-documenting from the DTO alone — callers (getStockMatrix,
 * listMovements) receive a guaranteed-present, validated positive integer rather
 * than `undefined` they must defensively default themselves.
 */
export class BasePaginationDto {
  @IsOptional()
  @Transform(defaultPositiveInt(1))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(defaultPositiveInt(50))
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
