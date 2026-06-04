import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ReturnReason } from '@prisma/client';

/**
 * One line of a return request: how many units of a specific OrderItem to send
 * back and why. The OrderItem (and therefore the Order) is the authoritative
 * source of identity/pricing — the client never supplies an orderId, customerId,
 * sku, price, or refund amount (all server-derived from the OrderItem snapshot).
 */
export class CreateReturnItemDto {
  /** The OrderItem being returned. Its order is resolved + ownership-checked server-side. */
  @IsUUID('4')
  orderItemId!: string;

  /**
   * Units to return. Bounded to a sane per-line max (no realistic single order
   * line exceeds this); the AUTHORITATIVE cap is `orderedQty - alreadyReturnedQty`,
   * enforced in the service against the OrderItem snapshot. This bound is only a
   * payload-size guard.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  qty!: number;

  /** Reason for this line (drives the credit-note + analytics; never affects refund math). */
  @IsEnum(ReturnReason)
  reason!: ReturnReason;
}

/**
 * Body for `POST /api/store/returns` (architecture 4.10). An array of lines, each
 * naming an OrderItem + qty + reason. All lines MUST belong to the SAME order
 * (the service rejects a mixed-order request) so a single Return maps to a single
 * Order, refund, and credit note. Identity (who, which order) is pinned from the
 * resolved OrderItems + the JWT/guest token, never the body.
 */
export class CreateReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateReturnItemDto)
  items!: CreateReturnItemDto[];

  /** Optional free-text customer note attached to the Return header. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
