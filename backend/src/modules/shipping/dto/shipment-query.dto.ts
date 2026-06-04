import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Courier, ShipmentStatus } from '@prisma/client';

/**
 * Admin shipment-list filters + pagination (GET /api/admin/store/shipments).
 * Matches the repo-wide list convention ({page, limit} → {data, meta}).
 */
export class ShipmentQueryDto {
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

  @IsOptional()
  @IsEnum(ShipmentStatus)
  status?: ShipmentStatus;

  @IsOptional()
  @IsEnum(Courier)
  courier?: Courier;

  @IsOptional()
  @IsUUID('4')
  orderId?: string;

  /** Free-text search over shipmentNumber / awb. Bounded to avoid slow-query DoS. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
