import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsEnum,
  Min,
  Max,
  MaxLength,
  Matches,
} from 'class-validator';
import { TaxRateType } from '@prisma/client';

/**
 * Create/update a TaxClass. GST rates are INTEGER basis points (1800 = 18%).
 * A TaxClass is assigned directly to a SKU and is the FIRST resolver in the
 * rate-resolution chain (TaxClass → HSN TaxRate → SiteSettings default).
 *
 * Important: persist the FULL total rate split as cgstBps/sgstBps/igstBps with
 * cgst = sgst = total/2 and igst = total. computeTax() chooses which pair to
 * apply at runtime from buyer-vs-seller state; it does NOT re-derive the split
 * from these columns — it derives the split from the resolved total. These
 * columns exist so the class is self-describing, but the engine treats the
 * resolved total as authoritative.
 */
export class UpsertTaxClassDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEnum(TaxRateType)
  type?: TaxRateType;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^[0-9]{2,8}$/, { message: 'hsnCode must be 2–8 numeric digits' })
  hsnCode?: string;

  @IsInt()
  @Min(0)
  @Max(10000)
  cgstBps!: number;

  @IsInt()
  @Min(0)
  @Max(10000)
  sgstBps!: number;

  @IsInt()
  @Min(0)
  @Max(10000)
  igstBps!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
