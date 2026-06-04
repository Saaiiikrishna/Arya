import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminGuard } from '../auth/guards';
import { CouponService, CouponContext } from './coupons.service';
import { OptionalCustomerGuard } from './guards';
import {
  CreateCouponDto,
  UpdateCouponDto,
  CouponQueryDto,
  ValidateCouponDto,
} from './dto';
import { rupeesToPaise } from './dto/money';

/**
 * Coupons HTTP surface. Thin by design (route → service → return): all coupon
 * business logic, money conversion rules, and validation context resolution live
 * in CouponService / OptionalCustomerGuard, not here. The class-level
 * ThrottlerGuard mirrors the CartController/StoreAuthController convention so
 * rate limiting is explicit on this controller and survives a future refactor of
 * the global APP_GUARD; every route additionally declares its tier so the intent
 * is unambiguous and test-verifiable.
 */
@UseGuards(ThrottlerGuard)
@Controller('api')
export class CouponsController {
  constructor(private readonly coupons: CouponService) {}

  // ─── ADMIN CRUD (AdminGuard) ──────────────────────────────

  @UseGuards(AdminGuard)
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  @Get('admin/store/coupons')
  list(@Query() query: CouponQueryDto) {
    return this.coupons.listCoupons(query);
  }

  @UseGuards(AdminGuard)
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  @Get('admin/store/coupons/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.coupons.getCoupon(id);
  }

  @UseGuards(AdminGuard)
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  @Post('admin/store/coupons')
  create(@Body() dto: CreateCouponDto) {
    return this.coupons.createCoupon(dto);
  }

  @UseGuards(AdminGuard)
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  @Patch('admin/store/coupons/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.coupons.updateCoupon(id, dto);
  }

  // ─── PUBLIC: validate (optional customer auth) ─────────────
  // OptionalCustomerGuard resolves req.couponContext from a CUSTOMER bearer token
  // if present (via the jwt-customer strategy) or a guest context otherwise — it
  // never blocks. Stricter per-IP limit: this unauthenticated endpoint probes
  // coupon existence/state, so cap brute-force code enumeration.

  @UseGuards(OptionalCustomerGuard)
  @Throttle({ short: { limit: 6, ttl: 60000 } })
  @Post('store/coupons/validate')
  async validate(@Body() dto: ValidateCouponDto, @Req() req: Request) {
    // Context is resolved server-side by the guard from the verified JWT only —
    // never from the request body (repo security rule 4ebf502). Fall back to a
    // guest context defensively in case the guard did not attach one.
    const ctx: CouponContext = req.couponContext ?? { isGuest: true };
    const subtotalPaise = rupeesToPaise(dto.subtotal, 'subtotal');
    const result = await this.coupons.validateCoupon(
      dto.code,
      ctx,
      subtotalPaise,
    );
    // Echo the discount back in both units for the storefront (display in
    // rupees, charge in paise).
    return {
      ...result,
      discountRupees: result.discountPaise / 100,
    };
  }
}
