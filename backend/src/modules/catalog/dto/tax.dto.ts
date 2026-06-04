import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsEnum,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { TaxRateType } from '@prisma/client';

/**
 * GST rates are INTEGER BASIS POINTS (1800 = 18%). They are NOT money, so they
 * are accepted as basis points directly (no rupee conversion).
 */
export class CreateTaxClassDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEnum(TaxRateType)
  type?: TaxRateType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hsnCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  cgstBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sgstBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  igstBps?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
