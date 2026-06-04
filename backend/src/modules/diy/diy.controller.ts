import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Cart } from '@prisma/client';
import { AdminGuard } from '../auth/guards';
import { CartOwner } from '../cart/cart.service';
import { DiyService, DiyActor } from './diy.service';
import { AddDiyBundleDto, CreateBundleDto, UpsertDiyDto } from './dto';
import { DiyCartAccessGuard } from './guards';
import { ParseSlugPipe } from './pipes/slug.pipe';

@Controller('api')
export class DiyController {
  constructor(private readonly diy: DiyService) {}

  // ─── PUBLIC READ (no guard) ───────────────────────────────
  // Rate-limited per-IP across BOTH the burst (medium) and hourly (long) tiers so
  // the build view — which surfaces live BOM/bundle availability and fires several
  // DB queries per request — can't be scraped at the global standard allowance.
  // The long-tier cap is overridden too, otherwise a single IP could exhaust the
  // 30/min burst and keep going under the unmodified 1000/hr long tier.

  @Throttle({
    medium: { limit: 30, ttl: 60000 },
    long: { limit: 300, ttl: 3600000 },
  })
  @Get('store/products/:slug/build')
  getBuildView(@Param('slug', ParseSlugPipe) slug: string) {
    return this.diy.getBuildView(slug);
  }

  // ─── PUBLIC: add a guide's bundle / components to the cart ─
  // Guarded by DiyCartAccessGuard: authorizes EITHER a CUSTOMER JWT or a guest
  // X-Cart-Token and pins the resolved cart to req.cart (never a bare Cart.id from
  // the body → no IDOR). Identity flows from the guard, not the request body.

  @UseGuards(DiyCartAccessGuard)
  @Post('store/diy/:guideId/add-to-cart')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ medium: { limit: 60, ttl: 60000 } })
  addToCart(
    @Req() req: Request,
    @Param('guideId', new ParseUUIDPipe()) guideId: string,
    @Body() dto: AddDiyBundleDto,
  ) {
    const cart = this.requireResolvedCart(req);
    return this.diy.addToCart(guideId, dto.mode, cart.id, this.ownerOf(req));
  }

  // ─── ADMIN: DIY GUIDE ─────────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/store/products/:id/diy')
  // Upsert: 200 (the service returns { created, guide } and may create OR update;
  // a plain 200 is honest for both, where a fixed 201 would mislead on update).
  @HttpCode(HttpStatus.OK)
  @Throttle({ medium: { limit: 30, ttl: 60000 } })
  upsertGuide(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) productId: string,
    @Body() dto: UpsertDiyDto,
  ) {
    return this.diy.upsertGuide(productId, dto, this.adminActor(req));
  }

  // ─── ADMIN: BUNDLES ───────────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/store/bundles')
  @Throttle({ medium: { limit: 30, ttl: 60000 } })
  createBundle(@Req() req: Request, @Body() dto: CreateBundleDto) {
    return this.diy.createBundle(dto, this.adminActor(req));
  }

  // ── internal ────────────────────────────────────────────────

  /** The DiyCartAccessGuard always pins req.cart on success; assert defensively. */
  private requireResolvedCart(req: Request): Cart {
    const cart = (req as Request & { cart?: Cart }).cart;
    if (!cart) {
      throw new NotFoundException(
        'No active cart found — create a cart first (POST /api/store/cart)',
      );
    }
    return cart;
  }

  /** Build the CartOwner from the guard-pinned identity (JWT/guest), never the body. */
  private ownerOf(req: Request): CartOwner {
    const r = req as Request & {
      customerId?: string;
      user?: { id?: string; email?: string | null };
    };
    const customerId = r.customerId ?? r.user?.id;
    if (customerId) {
      return { customerId, email: r.user?.email ?? null, isGuest: false };
    }
    return { isGuest: true };
  }

  /** Admin actor pinned from the JWT (AdminGuard sets req.user to the admin row). */
  private adminActor(req: Request): DiyActor {
    const user = (req as Request & { user?: { id?: string; role?: string } })
      .user;
    return { id: user?.id ?? 'SYSTEM', role: user?.role };
  }
}
