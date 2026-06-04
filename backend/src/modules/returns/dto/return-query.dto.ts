import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ReturnStatus } from '@prisma/client';

/**
 * Admin returns-queue filters + pagination (GET /api/admin/store/returns).
 * Pagination is bounded so a caller can never request an unbounded page.
 */
export class ReturnQueryDto {
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
  @IsEnum(ReturnStatus)
  status?: ReturnStatus;

  /** Filter to one order's returns. */
  @IsOptional()
  @IsUUID('4')
  orderId?: string;

  /** Filter to one customer's returns. */
  @IsOptional()
  @IsUUID('4')
  customerId?: string;
}
