import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderStatus } from '@prisma/client';

/**
 * Admin order state-machine transition (POST /api/admin/store/orders/:id/transition).
 * The target status is validated against the allowed transition graph in
 * OrdersService.transitionStatus; an illegal hop is a 409, never a silent no-op.
 */
export class OrderStatusTransitionDto {
  @IsEnum(OrderStatus)
  toStatus!: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
