import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  IsISO8601,
  Min,
  Max,
  MaxLength,
  Matches,
} from 'class-validator';
import { TaxRateType } from '@prisma/client';

/**
 * Create/update a TaxRate keyed by HSN code. This is the FALLBACK resolver used
 * when a SKU has no TaxClass: the SKU's hsnCode is looked up here.
 * `totalGstBps` is INTEGER basis points (1800 = 18%) for the FULL GST rate;
 * the engine splits it into CGST/SGST (intra-state) or applies it as IGST
 * (inter-state) at compute time.
 */
export class UpsertTaxRateDto {
  @IsString()
  @MaxLength(16)
  @Matches(/^[0-9]{2,8}$/, { message: 'hsnCode must be 2–8 numeric digits' })
  hsnCode!: string;

  @IsOptional()
  @IsEnum(TaxRateType)
  type?: TaxRateType;

  @IsInt()
  @Min(0)
  @Max(10000)
  totalGstBps!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  /**
   * When the new rate takes effect (e.g. a GST council revision). ISO-8601
   * string. Recorded on the TaxRate so historical filings can be reconstructed.
   */
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;
}
