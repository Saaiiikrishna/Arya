import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CartStatus,
  CouponStatus,
  CouponType,
  Prisma,
  ProductStatus,
  ProductType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { GuestTokenService } from '../store-auth/guest-token.service';
import { TaxService, TaxLineInput } from '../tax/tax.service';
import { COUPON_SERVICE } from './coupon.contract';
import type {
  CouponValidator,
  CouponValidationContext,
} from './coupon.contract';
import { MAX_CART_ITEM_QTY } from './dto/add-cart-item.dto';
import { AddDiyMode } from './dto/add-diy-bundle.dto';

/** Guest cart lifetime: 7 days from creation (architecture 4.5). */
const CART_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Max distinct line items in one cart (anti-bloat / bounded totals computation). */
const MAX_CART_LINES = 100;

/** The owner of a cart operation, resolved from the guard (JWT or guest token). */
export interface CartOwner {
  /** Present for a registered customer (CUSTOMER JWT). */
  customerId?: string;
  /** Buyer email if known (registered customer) — used for coupon anti-farming. */
  email?: string | null;
  /** True when the request is authorized purely by a guest cart token. */
  isGuest: boolean;
}

/** A SKU snapshot needed to (re)price a cart line. */
interface PricingSku {
  id: string;
  basePrice: number;
  salePrice: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  taxClassId: string | null;
  hsnCode: string | null;
  isActive: boolean;
  product: { status: ProductStatus; type: ProductType };
  priceTiers: { minQty: number; unitPrice: number }[];
}

/** Display-only SKU fields needed to serialize a cart line for the client. */
interface CartLineDisplaySku {
  skuCode: string;
  name: string | null;
  product: { id: string; slug: string; name: string };
}

/** A cart line loaded ONCE with everything needed to price AND serialize it. */
interface CartLineWithSku {
  id: string;
  skuId: string;
  quantity: number;
  unitPriceSnapshot: number;
  sku: PricingSku & CartLineDisplaySku;
}

/** The server-authoritative, fully-priced view of a cart (all INTEGER PAISE). */
interface CartTotals {
  currency: string;
  lines: CartLineView[];
  subtotal: number;
  couponId: string | null;
  couponCode: string | null;
  couponDiscount: number;
  couponValid: boolean;
  taxable: number;
  tax: number;
  grandTotal: number;
}

/** Per-line computed view carried inside {@link CartTotals}. */
interface CartLineView {
  itemId: string;
  skuId: string;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  taxClassId: string | null;
  hsnCode: string | null;
  purchasable: boolean;
  available: number;
  inStock: boolean;
}

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly guestTokens: GuestTokenService,
    private readonly tax: TaxService,
    // The coupon module is built in parallel and registers CouponService under
    // COUPON_SERVICE. Optional so the cart module boots even before coupon is
    // wired; the coupon endpoints fail closed with a clear 503 if it is absent.
    @Optional()
    @Inject(COUPON_SERVICE)
    private readonly coupon?: CouponValidator,
  ) {}

  // ───────────────────────────────────────────────────────────
  //  CART CREATION (guest)
  // ───────────────────────────────────────────────────────────

  /**
   * Create a fresh guest cart and mint its session token. Only the SHA-256 hash
   * is persisted (Cart.sessionTokenHash); the RAW token is returned ONCE in the
   * body for the client to keep and send back via the X-Cart-Token header. The
   * cart UUID alone never authorizes access (IDOR fix). expiresAt is now+7d.
   */
  async createGuestCart() {
    // Generate the UUID application-side so the session token can be minted BEFORE
    // the first write. This collapses cart-create into a single INSERT that already
    // carries the sessionTokenHash — eliminating the create-then-update race window
    // where a row could momentarily exist with a null hash (or the patch could fail
    // and leave an unreachable ghost row).
    const cartId = randomUUID();
    const { token, hash } = this.guestTokens.mintCartToken(cartId);

    const cart = await this.prisma.cart.create({
      data: {
        id: cartId,
        status: CartStatus.ACTIVE,
        expiresAt: new Date(Date.now() + CART_TTL_MS),
        sessionTokenHash: hash,
      },
    });

    // A freshly created cart has no items, so every total is a known zero — skip
    // the item/stock/coupon/tax round-trips entirely.
    return {
      cartToken: token, // raw token — client persists this, never sent again by us
      cart: this.serializeCart(cart, [], this.emptyTotals()),
    };
  }

  // ───────────────────────────────────────────────────────────
  //  READ
  // ───────────────────────────────────────────────────────────

  /**
   * Return the current cart (the one the guard resolved) with freshly recomputed
   * server-side totals + per-line availability flags. Prices are NEVER trusted
   * from the client: every line is re-priced from the live SKU here.
   */
  async getCart(cartId: string, owner: CartOwner) {
    const cart = await this.requireActiveCart(cartId);
    const items = await this.loadCartLines(cart.id);
    const totals = await this.computeTotals(items, cart.couponId, owner);
    return this.serializeCart(cart, items, totals);
  }

  // ───────────────────────────────────────────────────────────
  //  ITEMS
  // ───────────────────────────────────────────────────────────

  /**
   * Add a SKU to the cart, or merge into the existing line for that SKU. Validates
   * (via the catalog read model) that the SKU is ACTIVE, its product is ACTIVE and
   * NON-DIGITAL, then snapshots the unit price (sale/base or the applicable
   * PriceTier for the resulting quantity) onto the CartItem for display. Stock is
   * NEVER reserved here — availability is read for an advisory flag only; the
   * authoritative under-lock check happens at checkout.
   */
  async addItem(cartId: string, owner: CartOwner, skuId: string, qty: number) {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new BadRequestException('qty must be a positive integer');
    }
    const cart = await this.requireActiveCart(cartId);

    await this.addSkuToCart(cart.id, skuId, qty);

    await this.touchCart(cart.id);
    const items = await this.loadCartLines(cart.id);
    const totals = await this.computeTotals(items, cart.couponId, owner);
    return this.serializeCart(cart, items, totals);
  }

  /**
   * Update the quantity of an existing line. Re-snapshots the unit price from the
   * live SKU for the NEW quantity (tier may change). qty must be >= 1; removal is
   * a DELETE.
   */
  async updateItem(
    cartId: string,
    owner: CartOwner,
    itemId: string,
    qty: number,
  ) {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new BadRequestException('qty must be a positive integer');
    }
    if (qty > MAX_CART_ITEM_QTY) {
      throw new BadRequestException(
        `Quantity for a single item cannot exceed ${MAX_CART_ITEM_QTY}`,
      );
    }
    const cart = await this.requireActiveCart(cartId);

    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
    });
    // Ownership: the item must belong to THIS cart (no cross-cart item edits).
    if (!item || item.cartId !== cart.id) {
      throw new NotFoundException('Cart item not found');
    }

    const sku = await this.loadPricingSku(item.skuId);
    const unitPrice = this.resolveUnitPrice(sku, qty);

    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: qty, unitPriceSnapshot: unitPrice },
    });

    await this.touchCart(cart.id);
    const items = await this.loadCartLines(cart.id);
    const totals = await this.computeTotals(items, cart.couponId, owner);
    return this.serializeCart(cart, items, totals);
  }

  /** Remove a line from the cart. */
  async removeItem(cartId: string, owner: CartOwner, itemId: string) {
    const cart = await this.requireActiveCart(cartId);

    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
    });
    if (!item || item.cartId !== cart.id) {
      throw new NotFoundException('Cart item not found');
    }

    await this.prisma.cartItem.delete({ where: { id: item.id } });

    await this.touchCart(cart.id);
    const items = await this.loadCartLines(cart.id);
    const totals = await this.computeTotals(items, cart.couponId, owner);
    return this.serializeCart(cart, items, totals);
  }

  // ───────────────────────────────────────────────────────────
  //  DIY BUNDLE / COMPONENTS (architecture 4.5 / 4.12)
  // ───────────────────────────────────────────────────────────

  /**
   * Add a DIY guide's purchase set to the cart (architecture 4.5):
   *  - BUNDLE     → add the single sellable BUNDLE Sku of the guide's linked,
   *                 ACTIVE ComponentBundle at quantity 1.
   *  - COMPONENTS → add every purchasable SKU-backed BOM line of the guide at its
   *                 declared quantity (free-text / product-only BOM rows skipped).
   *
   * Each added SKU is validated + priced exactly like the normal add-item path
   * (active SKU, ACTIVE non-DIGITAL product, server-side snapshot price; quantities
   * merge into any existing line and respect the per-line / per-cart caps). Stock
   * is NEVER reserved here — checkout reserves under lock. The guide must be
   * published (an unpublished guide is treated as not found, mirroring /build).
   */
  async addDiyBundle(
    cartId: string,
    owner: CartOwner,
    guideId: string,
    mode: AddDiyMode,
  ) {
    const cart = await this.requireActiveCart(cartId);

    const guide = await this.prisma.diyGuide.findUnique({
      where: { id: guideId },
      select: {
        id: true,
        isPublished: true,
        bundle: {
          select: {
            id: true,
            isActive: true,
            bundleSkuId: true,
          },
        },
        bomItems: {
          where: { skuId: { not: null } },
          orderBy: { sortOrder: 'asc' },
          select: { skuId: true, quantity: true },
        },
      },
    });
    if (!guide || !guide.isPublished) {
      throw new NotFoundException('Build guide not found');
    }

    // Resolve the (skuId, qty) lines to add for the chosen mode.
    let additions: Array<{ skuId: string; qty: number }>;
    if (mode === AddDiyMode.BUNDLE) {
      if (
        !guide.bundle ||
        !guide.bundle.isActive ||
        !guide.bundle.bundleSkuId
      ) {
        throw new BadRequestException(
          'This guide does not have a purchasable bundle',
        );
      }
      additions = [{ skuId: guide.bundle.bundleSkuId, qty: 1 }];
    } else {
      // COMPONENTS: collapse duplicate sku references (a sku could appear on more
      // than one BOM row) into a single summed quantity so the merge math is right.
      const summed = new Map<string, number>();
      for (const b of guide.bomItems) {
        if (!b.skuId) continue;
        summed.set(
          b.skuId,
          (summed.get(b.skuId) ?? 0) + Math.max(1, b.quantity),
        );
      }
      additions = [...summed.entries()].map(([skuId, qty]) => ({ skuId, qty }));
      if (additions.length === 0) {
        throw new BadRequestException(
          'This guide has no purchasable components to add',
        );
      }
    }

    // Apply each addition with the same validation/merge/cap rules as addItem.
    for (const add of additions) {
      await this.addSkuToCart(cart.id, add.skuId, add.qty);
    }

    await this.touchCart(cart.id);
    const items = await this.loadCartLines(cart.id);
    const totals = await this.computeTotals(items, cart.couponId, owner);
    return this.serializeCart(cart, items, totals);
  }

  /**
   * Validate + merge a single SKU into the cart (shared by addItem and addDiyBundle).
   * Snapshots the server-side unit price for the resulting quantity, enforces the
   * per-line quantity cap and the per-cart distinct-line cap, and merges into an
   * existing line for the same SKU. Does NOT touch the cart's updatedAt / totals —
   * the caller batches those once after all additions.
   */
  private async addSkuToCart(
    cartId: string,
    skuId: string,
    qty: number,
  ): Promise<void> {
    const sku = await this.loadPricingSku(skuId);

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_skuId: { cartId, skuId } },
    });
    const newQty = (existing?.quantity ?? 0) + qty;
    if (newQty > MAX_CART_ITEM_QTY) {
      throw new BadRequestException(
        `Quantity for a single item cannot exceed ${MAX_CART_ITEM_QTY}`,
      );
    }
    const unitPrice = this.resolveUnitPrice(sku, newQty);

    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: newQty, unitPriceSnapshot: unitPrice },
      });
      return;
    }

    const lineCount = await this.prisma.cartItem.count({ where: { cartId } });
    if (lineCount >= MAX_CART_LINES) {
      throw new BadRequestException(
        `A cart cannot hold more than ${MAX_CART_LINES} distinct items`,
      );
    }
    try {
      await this.prisma.cartItem.create({
        data: { cartId, skuId, quantity: qty, unitPriceSnapshot: unitPrice },
      });
    } catch (e) {
      // A concurrent add of the same SKU raced us to create the @@unique row.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'This item was just added to the cart — refresh and try again',
        );
      }
      throw e;
    }
  }

  // ───────────────────────────────────────────────────────────
  //  COUPON (validate + attach / detach) — NEVER redeems
  // ───────────────────────────────────────────────────────────

  /**
   * Validate a coupon against the CURRENT subtotal + buyer context and, if valid,
   * attach its id to the cart (preview only — redemption is atomic in checkout).
   * Guests are gated by coupon.allowGuest inside the validator; the per-email cap
   * also applies there.
   */
  async applyCoupon(cartId: string, owner: CartOwner, code: string) {
    const validator = this.requireCoupon();
    const cart = await this.requireActiveCart(cartId);

    // Load lines ONCE and reuse them for the subtotal pre-check, the coupon
    // validation, and the final totals — no second item+SKU fetch.
    const items = await this.loadCartLines(cart.id);

    // Subtotal must be computed from the live snapshots, not a client value.
    const subtotal = this.subtotalOf(items);
    if (subtotal <= 0) {
      throw new BadRequestException(
        'Add at least one item before applying a coupon',
      );
    }

    const ctx: CouponValidationContext = {
      customerId: owner.customerId,
      email: owner.email ?? undefined,
      isGuest: owner.isGuest,
    };

    // Throws BadRequest on invalid/expired/min-not-met/guest-not-allowed/exhausted.
    const validated = await validator.validateCoupon(code, ctx, subtotal);

    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { couponId: validated.couponId },
    });

    // If totals computation fails AFTER the coupon was attached (e.g. a transient
    // dependency error), roll the couponId back so the cart never persists an
    // attached-but-never-previewed coupon that would render as couponValid:false.
    let totals: CartTotals;
    try {
      totals = await this.computeTotals(items, validated.couponId, owner);
    } catch (e) {
      await this.prisma.cart
        .update({ where: { id: cart.id }, data: { couponId: null } })
        .catch(() => undefined);
      throw e;
    }
    return this.serializeCart(cart, items, totals);
  }

  /** Detach any coupon from the cart. Idempotent. */
  async removeCoupon(cartId: string, owner: CartOwner) {
    const cart = await this.requireActiveCart(cartId);
    if (cart.couponId) {
      await this.prisma.cart.update({
        where: { id: cart.id },
        data: { couponId: null },
      });
    }
    const items = await this.loadCartLines(cart.id);
    const totals = await this.computeTotals(items, null, owner);
    return this.serializeCart(cart, items, totals);
  }

  // ───────────────────────────────────────────────────────────
  //  CROSS-MODULE CONTRACT (consumed by checkout-order)
  // ───────────────────────────────────────────────────────────

  /**
   * Return the cart + its items (each carrying a live SKU snapshot) + the
   * attached couponId, for the checkout transaction to re-price and reserve
   * against. The cart must be ACTIVE and unexpired and hold at least one line.
   *
   * This is a READ used to seed checkout; checkout re-prices and re-validates
   * everything authoritatively under its own locks. Per the CONTRACT signature.
   */
  async getCartForCheckout(cartId: string): Promise<{
    cart: {
      id: string;
      customerId: string | null;
      couponId: string | null;
      status: CartStatus;
      expiresAt: Date | null;
    };
    items: Array<{
      id: string;
      skuId: string;
      quantity: number;
      unitPriceSnapshot: number;
      sku: PricingSku;
    }>;
    couponId: string | null;
  }> {
    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            sku: {
              select: this.pricingSkuSelect(),
            },
          },
        },
      },
    });
    if (!cart) throw new NotFoundException('Cart not found');
    if (cart.status !== CartStatus.ACTIVE) {
      throw new ConflictException('Cart is no longer active');
    }
    if (cart.expiresAt && cart.expiresAt < new Date()) {
      throw new ConflictException('Cart has expired');
    }
    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Gate any line that would be UNCONDITIONALLY blocked at checkout (inactive
    // SKU, inactive product, or DIGITAL — none of which can ever become valid by
    // re-pricing). Surfacing it here returns a clean 400 at the checkout gate
    // instead of letting the error surface deep inside the lock path and wasting
    // reservation/lock contention (architecture: never a generic 500 on user paths).
    const blocked = cart.items.filter((it) => {
      const sku = it.sku as PricingSku;
      return (
        !sku.isActive ||
        sku.product.status !== ProductStatus.ACTIVE ||
        sku.product.type === ProductType.DIGITAL
      );
    });
    if (blocked.length > 0) {
      throw new BadRequestException(
        'One or more items in your cart are no longer available for purchase — please remove them and try again',
      );
    }

    return {
      cart: {
        id: cart.id,
        customerId: cart.customerId,
        couponId: cart.couponId,
        status: cart.status,
        expiresAt: cart.expiresAt,
      },
      items: cart.items.map((it) => ({
        id: it.id,
        skuId: it.skuId,
        quantity: it.quantity,
        unitPriceSnapshot: it.unitPriceSnapshot,
        sku: it.sku as PricingSku,
      })),
      couponId: cart.couponId,
    };
  }

  /**
   * Mark a cart CONVERTED (called inside the checkout transaction once the order
   * is created). Idempotent + CAS-guarded: only flips a cart that is still ACTIVE,
   * so a double-checkout cannot convert the same cart twice. Also nulls the guest
   * session token hash so a kept X-Cart-Token can no longer reach the cart. Per
   * the CONTRACT signature (runs in the caller's transaction).
   */
  async markConverted(
    tx: Prisma.TransactionClient,
    cartId: string,
  ): Promise<void> {
    const flipped = await tx.cart.updateMany({
      where: { id: cartId, status: CartStatus.ACTIVE },
      data: { status: CartStatus.CONVERTED, sessionTokenHash: null },
    });
    if (flipped.count !== 1) {
      // Another checkout already converted (or otherwise finalised) this cart.
      throw new ConflictException(
        'Cart has already been checked out or is no longer active',
      );
    }
  }

  // ───────────────────────────────────────────────────────────
  //  TOTALS
  // ───────────────────────────────────────────────────────────

  /**
   * Recompute every monetary figure server-side (all INTEGER PAISE):
   *   subtotal       = Σ (live unit price × qty)              [client prices ignored]
   *   couponDiscount = capped discount from the attached coupon (validate-only)
   *   taxable        = subtotal − couponDiscount (never < 0)
   *   tax            = GST via TaxService over per-line taxable shares
   *   grandTotal     = taxable + tax
   *
   * Pricing is re-derived from the live SKU (sale/base/PriceTier) so a stale
   * CartItem.unitPriceSnapshot can never inflate or deflate the real total. The
   * discount is apportioned across lines pro-rata so per-line GST stays correct.
   */
  private async computeTotals(
    items: CartLineWithSku[],
    couponId: string | null,
    owner?: CartOwner,
  ): Promise<CartTotals> {
    // Empty cart: every figure is a known zero. Skip the stock/coupon/tax work
    // entirely (the seller-state lookup in previewTax is a settings round-trip).
    if (items.length === 0) {
      return this.emptyTotals();
    }

    // Batch ALL per-line availability in a SINGLE groupBy keyed on skuId, then
    // resolve each line from the map in O(1). Never an aggregate-per-line N+1
    // (architecture Section 4.13/8.8: read paths must not loop one query per row).
    const skuIds = [...new Set(items.map((it) => it.sku.id))];
    const availBySku = await this.availabilityForSkus(skuIds);

    // Per-line live re-price + availability flag.
    const lines: CartLineView[] = [];
    let subtotal = 0;
    for (const it of items) {
      const sku = it.sku;
      const purchasable =
        sku.isActive &&
        sku.product.status === ProductStatus.ACTIVE &&
        sku.product.type !== ProductType.DIGITAL;
      const unitPrice = purchasable
        ? this.resolveUnitPrice(sku, it.quantity)
        : 0;
      const lineSubtotal = unitPrice * it.quantity;
      subtotal += lineSubtotal;

      const available = availBySku.get(sku.id) ?? 0;
      lines.push({
        itemId: it.id,
        skuId: sku.id,
        quantity: it.quantity,
        unitPrice,
        lineSubtotal,
        taxClassId: sku.taxClassId,
        hsnCode: sku.hsnCode,
        purchasable,
        available,
        inStock: available >= it.quantity,
      });
    }

    // Coupon discount (preview). If the attached coupon no longer validates for
    // the current subtotal/buyer, we surface discount=0 + a flag rather than
    // throwing — the cart still renders; checkout will re-validate authoritatively.
    let couponDiscount = 0;
    let couponCode: string | null = null;
    let couponValid = false;
    if (couponId && subtotal > 0) {
      const preview = await this.previewCouponDiscount(
        couponId,
        subtotal,
        owner,
      );
      if (preview) {
        couponDiscount = Math.min(preview.discountPaise, subtotal);
        couponCode = preview.code;
        couponValid = true;
      }
    }

    const taxableTotal = Math.max(0, subtotal - couponDiscount);

    // Apportion the discount across lines pro-rata on lineSubtotal so each line's
    // taxable value (and therefore its GST) is correct and the per-line shares
    // sum back to taxableTotal (largest-remainder distributes the rounding).
    const lineTaxables = this.apportion(
      lines.map((l) => l.lineSubtotal),
      taxableTotal,
    );

    // Tax via the shared engine. Buyer state is unknown in the cart preview, so
    // we quote intra-state at the seller's own state (CGST/SGST) as the canonical
    // preview; checkout recomputes with the real shipping state. If tax cannot be
    // resolved (e.g. seller state unconfigured), the preview degrades to tax=0
    // rather than failing the whole cart read.
    let tax = 0;
    if (taxableTotal > 0) {
      tax = await this.previewTax(lines, lineTaxables);
    }

    const grandTotal = taxableTotal + tax;

    return {
      currency: 'INR',
      lines,
      subtotal,
      couponId: couponValid ? couponId : null,
      couponCode,
      couponDiscount,
      couponValid,
      taxable: taxableTotal,
      tax,
      grandTotal,
    };
  }

  /**
   * Σ of live re-priced line subtotals over ALREADY-LOADED lines (used for coupon
   * min-order validation). Pure (no I/O) — the caller passes the lines it loaded
   * once, so applyCoupon does not pay for a second item+SKU fetch.
   */
  private subtotalOf(items: CartLineWithSku[]): number {
    let subtotal = 0;
    for (const it of items) {
      const sku = it.sku;
      const purchasable =
        sku.isActive &&
        sku.product.status === ProductStatus.ACTIVE &&
        sku.product.type !== ProductType.DIGITAL;
      if (!purchasable) continue;
      subtotal += this.resolveUnitPrice(sku, it.quantity) * it.quantity;
    }
    return subtotal;
  }

  /**
   * Best-effort coupon discount preview for the ATTACHED coupon (display only).
   * Returns null if the coupon module is unavailable or the coupon no longer
   * qualifies for the current subtotal/buyer, so the cart still renders. Never
   * throws out of the totals path.
   *
   * This is a LIGHTWEIGHT preview: it reads a single narrow coupon row and applies
   * the SAME window/status/min/guest/usage gating + discount math the validator
   * uses, computed locally — it does NOT call validateCoupon (which would re-do the
   * coupon lookup and the per-email/customer redemption COUNT on every cart read,
   * a heavy chain on a hot path). The per-customer anti-farming cap is deliberately
   * NOT evaluated here: it is advisory in preview and authoritatively enforced
   * under the advisory lock in CouponService.redeemCoupon at checkout. Section 8.13.
   */
  private async previewCouponDiscount(
    couponId: string,
    subtotal: number,
    owner?: CartOwner,
  ): Promise<{ code: string; discountPaise: number } | null> {
    // Gate on coupon-module presence to keep the contract: when coupon is absent
    // the cart shows no discount rather than a stale/unverifiable one.
    if (!this.coupon) return null;

    const coupon = await this.prisma.coupon.findUnique({
      where: { id: couponId },
      select: {
        code: true,
        type: true,
        value: true,
        maxDiscount: true,
        minOrderValue: true,
        status: true,
        allowGuest: true,
        usageLimit: true,
        usedCount: true,
        startsAt: true,
        expiresAt: true,
      },
    });
    if (!coupon) return null;

    // Same gating the validator applies (minus the per-identity count, see doc).
    if (coupon.status !== CouponStatus.ACTIVE) return null;
    const now = new Date();
    if (coupon.startsAt && now < coupon.startsAt) return null;
    if (coupon.expiresAt && now > coupon.expiresAt) return null;
    if (subtotal < coupon.minOrderValue) return null;
    if (!coupon.allowGuest && (owner?.isGuest ?? true)) return null;
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      return null;
    }

    const discountPaise = this.computeCouponDiscount(coupon, subtotal);
    return { code: coupon.code, discountPaise };
  }

  /**
   * Pure coupon discount math, byte-aligned with CouponService.computeDiscount so
   * the cart preview never drifts from the authoritative checkout quote:
   *  - PERCENT: round-half-up(subtotal * bps / 10000), capped at maxDiscount.
   *  - FIXED:   the stored paise value.
   * Then clamped to [0, subtotal] (a discount can never exceed the order).
   */
  private computeCouponDiscount(
    coupon: { type: CouponType; value: number; maxDiscount: number | null },
    subtotalPaise: number,
  ): number {
    let discount: number;
    if (coupon.type === CouponType.PERCENT) {
      discount = Math.floor((subtotalPaise * coupon.value + 5000) / 10000);
      if (coupon.maxDiscount !== null) {
        discount = Math.min(discount, coupon.maxDiscount);
      }
    } else {
      discount = coupon.value;
    }
    discount = Math.min(discount, subtotalPaise);
    return Math.max(0, discount);
  }

  /**
   * GST preview over the apportioned per-line taxable values. Buyer state is not
   * known in the cart, so we quote at the seller's own state (intra-state) as the
   * canonical preview. Degrades to 0 if the engine cannot resolve a rate/state.
   */
  private async previewTax(
    lines: CartLineView[],
    lineTaxables: number[],
  ): Promise<number> {
    try {
      const sellerState = await this.tax.resolveSellerStateCode();
      const taxLines: TaxLineInput[] = lines.map((l, i) => ({
        taxableValuePaise: lineTaxables[i] ?? 0,
        taxClassId: l.taxClassId,
        hsnCode: l.hsnCode,
      }));
      const results = await this.tax.computeTax(
        taxLines,
        sellerState,
        sellerState,
        {
          publicQuote: true,
        },
      );
      return results.reduce(
        (sum, r) => sum + r.cgstAmount + r.sgstAmount + r.igstAmount,
        0,
      );
    } catch (e) {
      this.logger.warn(
        `Cart tax preview unavailable; returning tax=0: ${(e as Error)?.message}`,
      );
      return 0;
    }
  }

  /**
   * Largest-remainder apportionment of `total` across weights so the parts are
   * non-negative integers summing EXACTLY to `total`. Used to split the coupon
   * discount (and thus the taxable base) across lines without paise drift.
   */
  private apportion(weights: number[], total: number): number[] {
    const sumW = weights.reduce((a, b) => a + b, 0);
    if (sumW <= 0 || total <= 0) return weights.map(() => 0);

    const raw = weights.map((w) => (w * total) / sumW);
    const floored = raw.map((r) => Math.floor(r));
    let remaining = total - floored.reduce((a, b) => a + b, 0);

    // Distribute the leftover paise to the largest fractional remainders first.
    const order = raw
      .map((r, i) => ({ i, frac: r - Math.floor(r) }))
      .sort((a, b) => b.frac - a.frac);
    const result = [...floored];
    for (const { i } of order) {
      if (remaining <= 0) break;
      result[i] += 1;
      remaining -= 1;
    }
    return result;
  }

  // ───────────────────────────────────────────────────────────
  //  PRICING + SKU VALIDATION
  // ───────────────────────────────────────────────────────────

  /** The minimal SKU + product + tiers projection used for (re)pricing. */
  private pricingSkuSelect() {
    return {
      id: true,
      basePrice: true,
      salePrice: true,
      saleStartsAt: true,
      saleEndsAt: true,
      taxClassId: true,
      hsnCode: true,
      isActive: true,
      product: { select: { status: true, type: true } },
      priceTiers: {
        select: { minQty: true, unitPrice: true },
        orderBy: { minQty: 'asc' as const },
      },
    } satisfies Prisma.SkuSelect;
  }

  /**
   * The pricing projection PLUS the display fields (skuCode, name, product id/slug/
   * name) so one load can both re-price AND serialize a cart line — the cart row's
   * items are fetched exactly once per request, never re-queried for display.
   */
  private cartLineSkuSelect() {
    return {
      id: true,
      skuCode: true,
      name: true,
      basePrice: true,
      salePrice: true,
      saleStartsAt: true,
      saleEndsAt: true,
      taxClassId: true,
      hsnCode: true,
      isActive: true,
      product: {
        select: { id: true, slug: true, name: true, status: true, type: true },
      },
      priceTiers: {
        select: { minQty: true, unitPrice: true },
        orderBy: { minQty: 'asc' as const },
      },
    } satisfies Prisma.SkuSelect;
  }

  /**
   * Load a SKU for pricing and assert it is purchasable: SKU active, product
   * ACTIVE, product NON-DIGITAL (DIGITAL is not purchasable in v1 — Section 8.10).
   */
  private async loadPricingSku(skuId: string): Promise<PricingSku> {
    const sku = await this.prisma.sku.findUnique({
      where: { id: skuId },
      select: this.pricingSkuSelect(),
    });
    if (!sku || !sku.isActive) {
      throw new NotFoundException('SKU not found');
    }
    if (sku.product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException(
        'This product is not available for purchase',
      );
    }
    if (sku.product.type === ProductType.DIGITAL) {
      throw new BadRequestException(
        'Digital products cannot be purchased at this time',
      );
    }
    return sku as PricingSku;
  }

  /**
   * Resolve the unit price (paise) for a SKU at a given quantity:
   *   1. The best (lowest) qualifying PriceTier whose minQty <= qty, if any tier
   *      beats the effective non-tier price.
   *   2. Otherwise the effective price: an ACTIVE sale price (within its window
   *      and below base) else base price.
   * Tiers and sale never stack ambiguously — we simply take the lowest price the
   * buyer qualifies for, which is the customer-favourable, defensible rule.
   */
  private resolveUnitPrice(sku: PricingSku, qty: number): number {
    const effective = this.effectivePrice(sku);
    let best = effective;
    for (const tier of sku.priceTiers) {
      if (qty >= tier.minQty && tier.unitPrice < best) {
        best = tier.unitPrice;
      }
    }
    return best;
  }

  /** ACTIVE sale price (in-window, below base) else base price, in paise. */
  private effectivePrice(sku: PricingSku): number {
    const now = Date.now();
    const startsOk = !sku.saleStartsAt || sku.saleStartsAt.getTime() <= now;
    const endsOk = !sku.saleEndsAt || sku.saleEndsAt.getTime() >= now;
    if (
      sku.salePrice !== null &&
      sku.salePrice < sku.basePrice &&
      startsOk &&
      endsOk
    ) {
      return sku.salePrice;
    }
    return sku.basePrice;
  }

  /**
   * Aggregate available = sum(onHand) − sum(reserved), clamped at 0, for EVERY
   * sku in ONE groupBy query (no aggregate-per-line N+1). SKUs with no StockLevel
   * rows are absent from the map → treated as 0 available by callers.
   */
  private async availabilityForSkus(
    skuIds: string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (skuIds.length === 0) return result;

    const grouped = await this.prisma.stockLevel.groupBy({
      by: ['skuId'],
      where: { skuId: { in: skuIds } },
      _sum: { onHand: true, reserved: true },
    });
    for (const row of grouped) {
      const onHand = row._sum.onHand ?? 0;
      const reserved = row._sum.reserved ?? 0;
      result.set(row.skuId, Math.max(0, onHand - reserved));
    }
    return result;
  }

  // ───────────────────────────────────────────────────────────
  //  INTERNAL HELPERS
  // ───────────────────────────────────────────────────────────

  /**
   * Load every cart line ONCE with the pricing+display SKU projection. Reused for
   * the totals computation AND serialization, so a single cart read/mutation
   * fetches its items exactly once (not the 2–3 times the old flow did).
   */
  private async loadCartLines(cartId: string): Promise<CartLineWithSku[]> {
    const items = await this.prisma.cartItem.findMany({
      where: { cartId },
      orderBy: { createdAt: 'asc' },
      include: { sku: { select: this.cartLineSkuSelect() } },
    });
    return items.map((it) => ({
      id: it.id,
      skuId: it.skuId,
      quantity: it.quantity,
      unitPriceSnapshot: it.unitPriceSnapshot,
      sku: it.sku as PricingSku & CartLineDisplaySku,
    }));
  }

  /** The all-zero totals for an empty cart (no items, no coupon, no tax). */
  private emptyTotals(): CartTotals {
    return {
      currency: 'INR',
      lines: [],
      subtotal: 0,
      couponId: null,
      couponCode: null,
      couponDiscount: 0,
      couponValid: false,
      taxable: 0,
      tax: 0,
      grandTotal: 0,
    };
  }

  /** Load + assert an ACTIVE, unexpired cart (refuse CONVERTED/expired mutations). */
  private async requireActiveCart(cartId: string) {
    const cart = await this.prisma.cart.findUnique({ where: { id: cartId } });
    if (!cart) throw new NotFoundException('Cart not found');
    if (cart.expiresAt && cart.expiresAt < new Date()) {
      throw new ConflictException('Cart has expired');
    }
    if (cart.status !== CartStatus.ACTIVE) {
      throw new ConflictException('Cart is no longer active');
    }
    return cart;
  }

  /** Bump updatedAt so an active cart's TTL/abandonment age reflects activity. */
  private async touchCart(cartId: string): Promise<void> {
    await this.prisma.cart.update({
      where: { id: cartId },
      data: { updatedAt: new Date() },
    });
  }

  /**
   * Assemble the serialized cart payload from the ALREADY-LOADED cart row + items +
   * computed totals. Pure (no DB I/O): the items were loaded once by the caller
   * (loadCartLines) and re-priced by computeTotals, so serialization adds no extra
   * query (the old flow re-fetched the cart + items a third time here).
   */
  private serializeCart(
    cart: { id: string; status: CartStatus; expiresAt: Date | null },
    items: CartLineWithSku[],
    totals: CartTotals,
  ) {
    const lineById = new Map(totals.lines.map((l) => [l.itemId, l]));
    return {
      id: cart.id,
      status: cart.status,
      currency: totals.currency,
      expiresAt: cart.expiresAt,
      items: items.map((it) => {
        const computed = lineById.get(it.id);
        return {
          id: it.id,
          skuId: it.skuId,
          skuCode: it.sku.skuCode,
          name: it.sku.name,
          product: {
            id: it.sku.product.id,
            slug: it.sku.product.slug,
            name: it.sku.product.name,
          },
          quantity: it.quantity,
          unitPrice: computed?.unitPrice ?? it.unitPriceSnapshot,
          lineSubtotal:
            computed?.lineSubtotal ?? it.unitPriceSnapshot * it.quantity,
          purchasable: computed?.purchasable ?? true,
          available: computed?.available ?? 0,
          inStock: computed?.inStock ?? false,
        };
      }),
      coupon: totals.couponId
        ? {
            couponId: totals.couponId,
            code: totals.couponCode,
            valid: totals.couponValid,
            // Carry the discount so a client can attribute it to the coupon
            // directly, without re-deriving it from totals.couponDiscount.
            discountPaise: totals.couponDiscount,
          }
        : null,
      totals: {
        subtotal: totals.subtotal,
        couponDiscount: totals.couponDiscount,
        taxable: totals.taxable,
        tax: totals.tax,
        grandTotal: totals.grandTotal,
      },
    };
  }

  /** Coupon module presence gate — fail closed with a clear 503 when absent. */
  private requireCoupon(): CouponValidator {
    if (!this.coupon) {
      throw new ServiceUnavailableException(
        'Coupons are temporarily unavailable',
      );
    }
    return this.coupon;
  }
}
