import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { STOCK_QTY_CAP } from './stock-adjust.dto';

/**
 * Inter-warehouse transfer of a single SKU. Both endpoints' (sku, warehouse)
 * stock-level advisory locks are acquired in the global lock order (Section 5.1)
 * before any mutation, so a transfer A→B and a concurrent B→A cannot deadlock.
 */
export class StockTransferDto {
  @IsUUID()
  skuId!: string;

  @IsUUID()
  fromWarehouseId!: string;

  @IsUUID()
  toWarehouseId!: string;

  /** Whole units to move; must be positive and within the magnitude cap. */
  @IsInt()
  @Min(1)
  @Max(STOCK_QTY_CAP)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
