import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import type { OrderActor } from '@/modules/orders/orders.service';
import { ShippingService } from './shipping.service';
import { CreateShipmentDto, ShipmentQueryDto } from './dto';

/**
 * Admin fulfillment surface (architecture 4.9):
 *  - POST /api/admin/store/orders/:id/ship   create shipment + order→SHIPPED
 *  - GET  /api/admin/store/shipments         list/paginate
 *
 * All routes are AdminGuard-protected. The actor for every audited transition is
 * sourced from the JWT (req.user), NEVER the request body (security rule 4ebf502).
 */
@Controller('api/admin/store')
@UseGuards(AdminGuard, ThrottlerGuard)
export class ShippingAdminController {
  constructor(private readonly shipping: ShippingService) {}

  /**
   * Create a shipment for an order. Manual (admin supplies courier+awb) or via the
   * active courier provider (`useProvider=true`); on a gated provider it falls
   * back to manual and then requires `awb`. Drives the order PACKED→SHIPPED.
   */
  @Post('orders/:id/ship')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  ship(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateShipmentDto,
  ) {
    return this.shipping.ship(id, dto, this.actorOf(req));
  }

  /** List shipments with filters + pagination. */
  @Get('shipments')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  list(@Query() query: ShipmentQueryDto) {
    return this.shipping.listShipments(query);
  }

  /** Build the audited actor from the JWT-pinned req.user (never the body). */
  private actorOf(req: Request): OrderActor {
    const user = (
      req as Request & {
        user?: { id?: string; sub?: string; role?: string };
      }
    ).user;
    const id = user?.id ?? user?.sub;
    // AdminGuard must have populated req.user. An absent identity on an admin
    // route is a guard misconfiguration — fail closed rather than corrupt the
    // audit trail (OrderEvent.triggeredBy is server-pinned, security rule 4ebf502).
    if (!id) {
      throw new UnauthorizedException('Admin identity could not be resolved');
    }
    return { id, role: user?.role };
  }
}
