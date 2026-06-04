import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SupplierStatus } from '@prisma/client';

/** Hard cap on admin supplier list page size (mirrors inventory's MAX_PAGE_LIMIT). */
export const SUPPLIER_LIST_MAX_LIMIT = 200;

/** Trim a string query param; coerce a whitespace-only value to undefined. */
const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

/**
 * Canonical 15-char Indian GSTIN (same shape catalog/inventory validate). A
 * supplier GSTIN ends up on purchase documents, so reject malformed values at
 * the boundary rather than persisting an invalid tax id.
 */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Valid Indian GST state codes (01–37, plus 97 Other Territory, 99 Centre). */
export const INDIAN_STATE_CODES: string[] = [
  ...Array.from({ length: 37 }, (_, i) => String(i + 1).padStart(2, '0')),
  '97',
  '99',
];

/** Admin create-supplier payload. Suppliers are deactivated, never hard-deleted. */
export class CreateSupplierDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(GSTIN_REGEX, { message: 'Invalid GSTIN format' })
  gstin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[0-9]{2}$/, { message: 'Invalid Indian GST state code' })
  stateCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Admin update-supplier payload — all fields optional; status togglable. */
export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(GSTIN_REGEX, { message: 'Invalid GSTIN format' })
  gstin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[0-9]{2}$/, { message: 'Invalid Indian GST state code' })
  stateCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsEnum(SupplierStatus)
  status?: SupplierStatus;
}

/** Supplier list filter. */
export class ListSuppliersQueryDto {
  @IsOptional()
  @IsEnum(SupplierStatus)
  status?: SupplierStatus;

  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(120)
  search?: string;

  /** 1-based page number (defaults to 1 in the service). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Page size; the service hard-caps this at SUPPLIER_LIST_MAX_LIMIT. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SUPPLIER_LIST_MAX_LIMIT)
  limit?: number;
}
