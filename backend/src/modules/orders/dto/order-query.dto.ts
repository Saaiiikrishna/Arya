import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OrderPaymentStatus, OrderStatus } from '@prisma/client';

/**
 * Admin order-board filters + pagination (GET /api/admin/store/orders).
 * Pagination defaults match the repo-wide list convention ({page, limit} →
 * {data, meta}).
 */
export class OrderQueryDto {
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
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(OrderPaymentStatus)
  paymentStatus?: OrderPaymentStatus;

  /**
   * Free-text search over orderNumber / guestEmail / razorpayOrderId. Bounded to
   * 200 chars: an unbounded term becomes a `LIKE '%term%'` pattern and a huge
   * value forces expensive sequential scans on a large orders table (slow-query
   * DoS), even though Prisma parameterizes the value (no SQL injection).
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  /** Filter to one customer's orders. UUID-validated so a malformed value never
   * reaches the Postgres UUID comparison. */
  @IsOptional()
  @IsUUID('4')
  customerId?: string;
}
