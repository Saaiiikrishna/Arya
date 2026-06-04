import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';
import { StockMovementReason } from '@prisma/client';

/** Magnitude cap on a single manual adjustment (and transfer) — see DTOs. */
export const STOCK_QTY_CAP = 1_000_000;

/**
 * Manual stock adjustment for a single (sku, warehouse).
 *
 * `quantityDelta` is a SIGNED onHand delta in whole units (+ receive / − write-off),
 * never rupees — inventory is unit-counted, not money. It must be non-zero.
 * The actor is sourced from the JWT in the controller, NEVER from the body.
 */
export class StockAdjustDto {
  @IsUUID()
  skuId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsInt()
  @NotEquals(0)
  @Min(-STOCK_QTY_CAP)
  @Max(STOCK_QTY_CAP)
  quantityDelta!: number;

  @IsOptional()
  @IsEnum(StockMovementReason)
  reason?: StockMovementReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
