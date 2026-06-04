import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { Cart } from '@prisma/client';
import { CartService, CartOwner } from './cart.service';
import { CartAccessGuard } from './guards';
import {
  AddCartItemDto,
  UpdateCartItemDto,
  ApplyCouponDto,
  AddDiyBundleDto,
} from './dto';

/**
 * Store cart HTTP surface (architecture 4.5). Follows the project-wide
 * `@Controller('api')` convention (every store + platform controller does the
 * same); the sub-path is qualified per-route. All mutating + read routes resolve
 * the CURRENT cart via {@link CartAccessGuard}, which authorizes EITHER a
 * registered customer (CUSTOMER JWT) OR a guest (X-Cart-Token) — never a bare
 * Cart.id (IDOR fix). The guard attaches the resolved cart to `req.cart` and the
 * customer id (when present) to `req.customerId`.
 *
 * Cart create (POST /store/cart) is intentionally public: it mints a fresh guest
 * cart + its one-time token. Prices are always recomputed server-side;
 * client-supplied prices are never trusted.
 */
@Controller('api')
@UseGuards(ThrottlerGuard)
export class CartController {
  constructor(private readonly cart: CartService) {}

  /** Create a new guest cart; returns the raw X-Cart-Token ONCE + the empty cart. */
  @Post('store/cart')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 6, ttl: 60000 } })
  createCart() {
    return this.cart.createGuestCart();
  }

  /** Current cart with recomputed totals + per-line availability flags. */
  @UseGuards(CartAccessGuard)
  @Get('store/cart')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  getCart(@Req() req: Request) {
    const cart = this.requireResolvedCart(req);
    return this.cart.getCart(cart.id, this.ownerOf(req));
  }

  /** Add (or merge) an item. Unit price is snapshotted server-side. */
  @UseGuards(CartAccessGuard)
  @Post('store/cart/items')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  addItem(@Req() req: Request, @Body() dto: AddCartItemDto) {
    const cart = this.requireResolvedCart(req);
    return this.cart.addItem(cart.id, this.ownerOf(req), dto.skuId, dto.qty);
  }

  /**
   * Add a DIY guide's purchase set to the cart (architecture 4.5):
   * BUNDLE adds the sellable bundle SKU; COMPONENTS adds all purchasable BOM SKUs.
   */
  @UseGuards(CartAccessGuard)
  @Post('store/cart/diy-bundle')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  addDiyBundle(@Req() req: Request, @Body() dto: AddDiyBundleDto) {
    const cart = this.requireResolvedCart(req);
    return this.cart.addDiyBundle(
      cart.id,
      this.ownerOf(req),
      dto.guideId,
      dto.mode,
    );
  }

  /** Update a line's quantity (re-prices from the live SKU). */
  @UseGuards(CartAccessGuard)
  @Patch('store/cart/items/:itemId')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  updateItem(
    @Req() req: Request,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    const cart = this.requireResolvedCart(req);
    return this.cart.updateItem(cart.id, this.ownerOf(req), itemId, dto.qty);
  }

  /** Remove a line. */
  @UseGuards(CartAccessGuard)
  @Delete('store/cart/items/:itemId')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  removeItem(
    @Req() req: Request,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
  ) {
    const cart = this.requireResolvedCart(req);
    return this.cart.removeItem(cart.id, this.ownerOf(req), itemId);
  }

  /** Validate + attach a coupon (preview only — never redeems). */
  @UseGuards(CartAccessGuard)
  @Post('store/cart/coupon')
  @Throttle({ short: { limit: 6, ttl: 60000 } })
  applyCoupon(@Req() req: Request, @Body() dto: ApplyCouponDto) {
    const cart = this.requireResolvedCart(req);
    return this.cart.applyCoupon(cart.id, this.ownerOf(req), dto.code);
  }

  /** Detach the coupon from the cart. */
  @UseGuards(CartAccessGuard)
  @Delete('store/cart/coupon')
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  removeCoupon(@Req() req: Request) {
    const cart = this.requireResolvedCart(req);
    return this.cart.removeCoupon(cart.id, this.ownerOf(req));
  }

  // ── internal ────────────────────────────────────────────────

  /**
   * The guard attaches `req.cart` when an active cart was resolved. For a
   * registered customer with no cart yet it leaves it unset — surface a clean 404
   * here (the customer must add an item via their own cart flow, or the frontend
   * creates one). This keeps the bare-Cart.id IDOR closed: handlers only ever act
   * on the guard-resolved cart, never an id from the request.
   */
  private requireResolvedCart(req: Request): Cart {
    const cart = (req as Request & { cart?: Cart }).cart;
    if (!cart) {
      throw new NotFoundException(
        'No active cart found — create a cart first (POST /api/store/cart)',
      );
    }
    return cart;
  }

  /**
   * Build the CartOwner from the guard-pinned identity (JWT/guest), never the body.
   *
   * CartAccessGuard has already authorized the request via exactly one path: a
   * registered customer (req.customerId / req.user pinned by the customer JWT
   * strategy) or a guest cart token. So if no customer id is present here, the
   * request is necessarily the guest path — there is no third "no identity" state
   * to defend against (the guard throws 401 before the handler runs). We therefore
   * return the guest owner unconditionally rather than re-deriving identity from a
   * header (which would not be a real authorization check anyway).
   */
  private ownerOf(req: Request): CartOwner {
    const r = req as Request & {
      customerId?: string;
      user?: { id?: string; email?: string | null };
    };
    const customerId = r.customerId ?? r.user?.id;
    if (customerId) {
      return {
        customerId,
        email: r.user?.email ?? null,
        isGuest: false,
      };
    }
    return { isGuest: true };
  }
}
