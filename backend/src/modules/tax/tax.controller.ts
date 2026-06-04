import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TaxService, TaxActor } from './tax.service';
import { AdminGuard } from '../auth/guards';
import { UpsertTaxClassDto, UpsertTaxRateDto, TaxQuoteDto } from './dto';

/**
 * Reads the canonical actor identity from the JWT-populated request. Identity is
 * ALWAYS sourced from the token (never the request body) so every audit log line
 * is attributable to the authenticated admin (CLAUDE.md security constraint
 * `4ebf502`).
 */
function actorOf(req: { user?: { id?: string; sub?: string; role?: string } }): TaxActor {
  const user = req.user ?? {};
  return { id: user.id ?? user.sub ?? 'unknown', role: user.role };
}

/**
 * PUBLIC tax surface. Kept in a SEPARATE controller from the admin routes so the
 * admin controller can apply `AdminGuard` at the class level — a single missed
 * per-route decorator can therefore never silently expose an admin mutation.
 */
@Controller('api/store/tax')
export class TaxController {
  constructor(private readonly taxService: TaxService) {}

  /**
   * Live tax quote for the storefront (cart/checkout estimate). The
   * authoritative tax is recomputed and frozen onto OrderItem at checkout; this
   * endpoint is for display only.
   *
   * Strictly throttled: the global tier would permit 1000 req/hr, enough to
   * probe rate tables and seller state. 30 req/min/IP is ample for cart preview.
   */
  @Throttle({ short: { ttl: 60000, limit: 30 } })
  @Post('quote')
  async quote(@Body() dto: TaxQuoteDto) {
    // The public path supplies ONLY hsnCode; taxClassId is never accepted from
    // anonymous callers (see TaxQuoteLineDto). Seller state is always resolved
    // server-side from SiteSettings — never from the client — so the intra/
    // inter-state result cannot be forced by the caller.
    const lines = await this.taxService.computeTax(
      dto.lines.map((l) => ({
        taxableValuePaise: l.taxableValuePaise,
        hsnCode: l.hsnCode,
      })),
      dto.buyerStateCode,
      undefined,
      { publicQuote: true },
    );

    // Sum per-component totals from the per-line amounts WITHOUT re-rounding
    // (Section 8.3 — round per line, then sum).
    const totals = lines.reduce(
      (acc, l) => {
        acc.cgstTotal += l.cgstAmount;
        acc.sgstTotal += l.sgstAmount;
        acc.igstTotal += l.igstAmount;
        return acc;
      },
      { cgstTotal: 0, sgstTotal: 0, igstTotal: 0 },
    );
    const taxTotal = totals.cgstTotal + totals.sgstTotal + totals.igstTotal;

    return { lines, ...totals, taxTotal };
  }
}

/**
 * ADMIN tax surface. `AdminGuard` is applied at the CLASS level so every route
 * here is guarded by construction. Do not move the public quote into this class.
 */
@UseGuards(AdminGuard)
@Controller('api/admin/store')
export class TaxAdminController {
  constructor(private readonly taxService: TaxService) {}

  // ─── TaxClass CRUD ────────────────────────────────────────
  @Get('tax-classes')
  listTaxClasses() {
    return this.taxService.listTaxClasses();
  }

  @Get('tax-classes/:id')
  getTaxClass(@Param('id') id: string) {
    return this.taxService.getTaxClass(id);
  }

  @Post('tax-classes')
  createTaxClass(@Body() dto: UpsertTaxClassDto, @Req() req: any) {
    return this.taxService.createTaxClass(dto, actorOf(req));
  }

  @Patch('tax-classes/:id')
  updateTaxClass(
    @Param('id') id: string,
    @Body() dto: UpsertTaxClassDto,
    @Req() req: any,
  ) {
    return this.taxService.updateTaxClass(id, dto, actorOf(req));
  }

  @Delete('tax-classes/:id')
  deactivateTaxClass(@Param('id') id: string, @Req() req: any) {
    return this.taxService.deactivateTaxClass(id, actorOf(req));
  }

  // ─── TaxRate (HSN → bps) CRUD ─────────────────────────────
  @Get('tax-rates')
  listTaxRates() {
    return this.taxService.listTaxRates();
  }

  @Get('tax-rates/:id')
  getTaxRate(@Param('id') id: string) {
    return this.taxService.getTaxRate(id);
  }

  // Create-or-update by the unique hsnCode (the documented GET/POST surface).
  @Post('tax-rates')
  upsertTaxRate(@Body() dto: UpsertTaxRateDto, @Req() req: any) {
    return this.taxService.upsertTaxRate(dto, actorOf(req));
  }

  // Targeted update of a specific row by UUID (no overwrite-by-guessing-hsn).
  @Patch('tax-rates/:id')
  updateTaxRate(
    @Param('id') id: string,
    @Body() dto: UpsertTaxRateDto,
    @Req() req: any,
  ) {
    return this.taxService.updateTaxRate(id, dto, actorOf(req));
  }

  @Delete('tax-rates/:id')
  deleteTaxRate(@Param('id') id: string, @Req() req: any) {
    return this.taxService.deleteTaxRate(id, actorOf(req));
  }
}
