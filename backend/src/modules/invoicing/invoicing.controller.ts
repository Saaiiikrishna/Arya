import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Order } from '@prisma/client';
import { AdminGuard } from '../auth/guards';
import { InvoicingService } from './invoicing.service';
import { InvoiceAccessGuard } from './guards';
import { IssueInvoiceDto, ListInvoicesDto } from './dto';

interface OwnerInvoiceRequest extends Request {
  order?: Order;
}

/**
 * Invoicing HTTP surface (architecture 4.11). Follows the project-wide
 * `@Controller('api')` convention; the sub-path is qualified per route.
 *
 * Admin routes are guarded by AdminGuard. The owner download route is guarded by
 * {@link InvoiceAccessGuard}, which authorizes EITHER a registered customer
 * (CUSTOMER JWT, order-ownership checked) OR a guest (X-Order-Token) — never a
 * bare order id (IDOR fix). No identity is ever read from the request body;
 * financial fields (number/tax) are entirely server-derived.
 *
 * Throttle tiers use the NAMED tiers configured in ThrottlerModule (short =
 * 6/min, medium = 100/min). The owner-facing presigned-download route uses the
 * strict `short` tier so a leaked guest token cannot hammer it to mint unlimited
 * presigned URLs (information exposure via URL leakage in transit logs).
 */
@Controller('api')
export class InvoicingController {
  constructor(private readonly invoicing: InvoicingService) {}

  /**
   * Issue (idempotent) an order's GST tax invoice. Consumes a gapless sequence
   * number on first issue; subsequent calls return the same invoice. A fresh
   * presigned download URL is always returned.
   */
  @UseGuards(AdminGuard)
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  @Post('admin/store/orders/:orderId/invoice')
  issue(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() _dto: IssueInvoiceDto,
  ) {
    // The body is validated (and rejects unknown identity/financial fields) but
    // carries no field that can influence number/tax/identity — generation is
    // fully server-derived and always returns a fresh link.
    void _dto;
    return this.invoicing.issueForAdmin(orderId);
  }

  /**
   * Issue (idempotent) a CREDIT_NOTE for a received return (architecture 4.11).
   * Consumed by the admin return-received flow; safe to call repeatedly.
   */
  @UseGuards(AdminGuard)
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  @Post('admin/store/returns/:id/credit-note')
  creditNote(@Param('id', ParseUUIDPipe) returnId: string) {
    return this.invoicing.generateCreditNote(returnId);
  }

  /** List / paginate / filter invoices (admin back-office). */
  @UseGuards(AdminGuard)
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  @Get('admin/store/invoices')
  list(@Query() query: ListInvoicesDto) {
    return this.invoicing.listInvoices(query);
  }

  /**
   * Owner-facing presigned invoice download. InvoiceAccessGuard has already
   * resolved + authorized the order (customer-owns OR guest-token) and attached
   * it to `req.order`; we pass its id straight through. Strict `short` tier.
   */
  @UseGuards(InvoiceAccessGuard)
  @Throttle({ short: { limit: 6, ttl: 60000 } })
  @Get('store/orders/:orderId/invoice')
  download(@Req() req: OwnerInvoiceRequest) {
    // InvoiceAccessGuard guarantees req.order is set on success (both auth paths
    // assign it), so it is the authoritative, ownership-checked order id.
    return this.invoicing.getDownloadForOrder(req.order!.id);
  }
}
