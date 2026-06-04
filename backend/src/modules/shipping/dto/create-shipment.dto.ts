import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { Courier } from '@prisma/client';

/**
 * Create a shipment for an order (POST /api/admin/store/orders/:id/ship).
 *
 * Two modes:
 *  - MANUAL (default): the admin supplies `courier` + `awb` directly.
 *  - PROVIDER: `useProvider=true` asks the active courier provider to create the
 *    shipment and mint the AWB. If the provider is gated/unconfigured the service
 *    falls back to the manual path, which then REQUIRES `awb`.
 */
export class CreateShipmentDto {
  /** Courier carrier. Optional when useProvider=true (provider sets its own). */
  @IsOptional()
  @IsEnum(Courier)
  courier?: Courier;

  /** Air-waybill / tracking number. Required for the manual path. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  awb?: string;

  /** Public tracking URL (manual path). */
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  trackingUrl?: string;

  /** Shipping cost in integer paise. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  shippingCost?: number;

  /** Package weight in grams. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  weightGrams?: number;

  /** When true, call the active courier provider to create + label the shipment. */
  @IsOptional()
  @IsBoolean()
  useProvider?: boolean;

  /** Optional audit note recorded on the initial ShipmentEvent. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
