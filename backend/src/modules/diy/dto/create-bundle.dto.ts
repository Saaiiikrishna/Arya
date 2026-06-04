import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';

const MAX_BUNDLE_MEMBERS = 100;

/** One member SKU of a bundle, with the per-set quantity drawn down on a sale. */
export class BundleMemberDto {
  @IsUUID()
  skuId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

/**
 * Create a ComponentBundle. The bundle is sold via a BUNDLE-type Sku:
 *  - `productId` MUST reference an existing Product of type BUNDLE (the wrapper).
 *  - the service MINTS a new sellable Sku under that product from `sku*` fields.
 * Member SKUs + per-set quantities are recorded in BundleItem rows; the public
 * `/build` view computes VIRTUAL availability = min(floor(memberAvailable/qty)).
 */
export class CreateBundleDto {
  /** The BUNDLE-type Product that wraps this sellable set. */
  @IsUUID()
  productId!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // ─── Sellable BUNDLE Sku (minted by the service) ──────────

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
  skuName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hsnCode?: string;

  @IsOptional()
  @IsUUID()
  taxClassId?: string;

  /** Set price in RUPEES (converted to integer paise at the boundary). */
  @IsNumber()
  @Min(0)
  basePrice!: number;

  /**
   * Optional sale price in RUPEES. `@IsOptional()` must precede `@IsNumber()` so
   * a null/undefined value short-circuits validation (class-validator would
   * otherwise fail `@IsNumber()` on null). The service converts to paise.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number;

  // ─── Members ──────────────────────────────────────────────

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BUNDLE_MEMBERS)
  @ValidateNested({ each: true })
  @Type(() => BundleMemberDto)
  items!: BundleMemberDto[];
}
