import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Canonical 15-char Indian GSTIN: 2-digit state code, 5 letters (PAN entity),
 * 4 digits, 1 letter, 1 alphanumeric, literal 'Z', 1 alphanumeric checksum.
 * A malformed GSTIN flows into Order.sellerGstinSnapshot and the GST invoice PDF
 * (Section 8.3), so it must be rejected at the boundary — a wrong GSTIN there is
 * a legally non-compliant tax document.
 */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Valid Indian GST state codes (01–37, plus 97 Other Territory, 99 Centre). */
export const INDIAN_STATE_CODES: string[] = [
  ...Array.from({ length: 37 }, (_, i) => String(i + 1).padStart(2, '0')),
  '97',
  '99',
];

/**
 * Admin create-warehouse payload. Warehouses are deactivated, never hard-deleted
 * (StockLevel / StockMovement FKs are RESTRICT), so there is no delete DTO.
 */
export class CreateWarehouseDto {
  @IsString()
  @MaxLength(64)
  code!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  /** GST place-of-supply (seller side). Required for a warehouse to be allocatable (Section 8.4 / M2a). */
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @IsIn(INDIAN_STATE_CODES, { message: 'Invalid Indian GST state code' })
  stateCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(GSTIN_REGEX, { message: 'Invalid GSTIN format' })
  gstin?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
