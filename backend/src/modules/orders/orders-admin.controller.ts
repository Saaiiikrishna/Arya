import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminGuard } from '@/modules/auth/guards';
import { OrdersService, OrderActor } from './orders.service';
import { OrderQueryDto, OrderStatusTransitionDto } from './dto';

/**
 * Admin order board (architecture 4.6):
 *  - GET  /api/admin/store/orders                 list/filter/paginate
 *  - GET  /api/admin/store/orders/:id             detail
 *  - POST /api/admin/store/orders/:id/transition  validated state machine
 *
 * All routes are AdminGuard-protected. The actor for every audited transition is
 * sourced from the JWT (req.user), NEVER the request body (security rule 4ebf502).
 */
@Controller('api/admin/store')
@UseGuards(AdminGuard, ThrottlerGuard)
export class OrdersAdminController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  list(@Query() query: OrderQueryDto) {
    return this.orders.listOrders(query);
  }

  @Get('orders/:id')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  getOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.orders.getOrderForAdmin(id);
  }

  /**
   * Transition an order through the validated state machine
   * (CONFIRMED→PACKED→SHIPPED→DELIVERED; CANCELLED from a pre-shipped state
   * releases/restocks stock). An illegal hop is a 409, audited via OrderEvent.
   */
  @Post('orders/:id/transition')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  transition(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: OrderStatusTransitionDto,
  ) {
    return this.orders.transitionStatus(
      id,
      dto.toStatus,
      this.actorOf(req),
      dto.note,
    );
  }

  /** Build the audited actor from the JWT-pinned req.user (never the body). */
  private actorOf(req: Request): OrderActor {
    const user = (
      req as Request & {
        user?: { id?: string; sub?: string; role?: string };
      }
    ).user;
    const id = user?.id ?? user?.sub;
    // AdminGuard must have populated req.user. An absent identity on an admin route
    // is a guard misconfiguration, NOT a record-as-'unknown' situation: OrderEvent
    // .triggeredBy is server-pinned from the JWT (security rule 4ebf502), so we
    // fail closed rather than corrupt the audit trail.
    if (!id) {
      throw new UnauthorizedException('Admin identity could not be resolved');
    }
    return { id, role: user?.role };
  }
}
