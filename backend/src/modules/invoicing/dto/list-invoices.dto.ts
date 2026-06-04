import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsEnum,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InvoiceStatus, InvoiceType } from '@prisma/client';

/**
 * Query params for `GET /api/admin/store/invoices` (list / paginate / filter).
 * All filters are optional; pagination is bounded so a caller can never request
 * an unbounded page.
 */
export class ListInvoicesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsEnum(InvoiceType)
  type?: InvoiceType;

  /** Financial year filter, e.g. '2026-27'. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'financialYear must be in the form YYYY-YY (e.g. 2026-27)',
  })
  financialYear?: string;

  /**
   * Free-text search across invoiceNumber / buyerName (case-insensitive). Bounded
   * length so a 100 KB LIKE '%...%' term cannot be used for a DoS by an admin.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
