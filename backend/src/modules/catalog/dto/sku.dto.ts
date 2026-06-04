import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsObject,
  IsUUID,
  IsNumber,
  Min,
  Max,
  MaxLength,
  registerDecorator,
  type ValidationOptions,
  type ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Bounds on the free-form variantAttributes map (anti-bloat / anti-DoS). */
const MAX_VARIANT_KEYS = 20;
const MAX_VARIANT_KEY_LEN = 60;
const MAX_VARIANT_VALUE_LEN = 200;

/**
 * Custom validator for the arbitrary `variantAttributes` map: caps the number of
 * keys and the length of each key and (string) value so an admin cannot store an
 * unbounded / deeply-nested JSON blob in the SKU row. Non-string scalar values
 * (number/boolean) are allowed; nested objects/arrays and oversized strings are
 * rejected. (Security IMPORTANT — variantAttributes bounds.)
 */
function IsBoundedAttributeMap(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isBoundedAttributeMap',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value)
          )
            return false;
          const entries = Object.entries(value as Record<string, unknown>);
          if (entries.length > MAX_VARIANT_KEYS) return false;
          for (const [k, v] of entries) {
            if (typeof k !== 'string' || k.length > MAX_VARIANT_KEY_LEN)
              return false;
            const t = typeof v;
            if (t === 'string') {
              if ((v as string).length > MAX_VARIANT_VALUE_LEN) return false;
            } else if (t !== 'number' && t !== 'boolean') {
              // Reject nested objects/arrays/functions — keep the map flat.
              return false;
            }
          }
          return true;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a flat map of at most ${MAX_VARIANT_KEYS} keys (key ≤ ${MAX_VARIANT_KEY_LEN} chars, string value ≤ ${MAX_VARIANT_VALUE_LEN} chars)`;
        },
      },
    });
  };
}

export class CreateSkuDto {
  @IsString()
  @MaxLength(120)
  skuCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  name?: string;

  /** Arbitrary (bounded) variant attribute map, e.g. { flash: '4MB', color: 'black' }. */
  @IsOptional()
  @IsObject()
  @IsBoundedAttributeMap()
  variantAttributes?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hsnCode?: string;

  @IsOptional()
  @IsUUID()
  taxClassId?: string;

  /** MRP / list price in RUPEES (converted to integer paise at the boundary). */
  @IsNumber()
  @Min(0)
  basePrice!: number;

  /** Sale price in RUPEES, or null for no sale. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number | null;

  @IsOptional()
  @IsString()
  saleStartsAt?: string;

  @IsOptional()
  @IsString()
  saleEndsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  weightGrams?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lengthMm?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  widthMm?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  heightMm?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderPoint?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderQty?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSkuDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  skuCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  barcode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  name?: string;

  @IsOptional()
  @IsObject()
  @IsBoundedAttributeMap()
  variantAttributes?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hsnCode?: string | null;

  @IsOptional()
  @IsUUID()
  taxClassId?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  basePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number | null;

  @IsOptional()
  @IsString()
  saleStartsAt?: string | null;

  @IsOptional()
  @IsString()
  saleEndsAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  weightGrams?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lengthMm?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  widthMm?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  heightMm?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderPoint?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderQty?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreatePriceTierDto {
  /** Minimum quantity for this break to apply. */
  @IsInt()
  @Min(1)
  minQty!: number;

  /** Unit price at this break in RUPEES (converted to integer paise). */
  @IsNumber()
  @Min(0)
  unitPrice!: number;
}

/**
 * Query DTO for the admin SKU typeahead (`GET /admin/store/skus`). Powers the
 * SkuPicker so admin forms select a SKU by code/name rather than pasting a raw
 * UUID. The free-text `search` matches skuCode / name / productName
 * (case-insensitive); `limit` is clamped server-side (see the service) and also
 * bounded here so an unbounded scan can never be requested. Lives in the `dto/`
 * folder (discoverable by the directory scan) and is validated by the global
 * ValidationPipe (whitelist + implicit conversion).
 */
export class SkuSearchQueryDto {
  /** Free-text query over SKU code / name / product name (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  /** Page size cap for the typeahead results (1–50, default applied in service). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
