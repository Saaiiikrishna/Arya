import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductStatus,
  ProductType,
  StockMovementReason,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../../prisma';
import { CartService, CartOwner } from '../cart/cart.service';
import {
  AddDiyMode,
  CreateBundleDto,
  UpsertDiyDto,
  UpsertDiyBomItemDto,
  optionalRupeesToPaise,
  rupeesToPaise,
} from './dto';

/**
 * Identity of the admin performing a DIY mutation — sourced from the JWT by the
 * controller (CLAUDE.md / 4ebf502: triggeredBy is always pinned from the token,
 * never the request body). Threaded into every write path for the audit trail.
 */
export interface DiyActor {
  id: string;
  role?: string;
}

/**
 * DIY & component-bundle module (architecture Section 4.12).
 *
 * Owns DiyGuide / DiyStep / DiyBomItem / ComponentBundle / BundleItem. It does NOT
 * own product/sku CRUD — it references existing Product/Sku rows owned by the
 * `catalog` module, and reads StockLevel directly (read-only) for the public
 * `/build` view, exactly as catalog does for product detail. Keeping the stock
 * read here (rather than calling CatalogService.getAvailability, which throws for
 * inactive products and aggregates a single sku) avoids a circular dependency and
 * lets us resolve many BOM/bundle members in one query.
 */
@Injectable()
export class DiyService {
  private readonly logger = new Logger(DiyService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Cart mutation is OWNED by CartService — the diy module never writes CartItem
    // rows directly. The add-to-cart endpoint delegates here so pricing snapshots,
    // line caps, and merge semantics stay single-sourced (architecture 4.12/4.5).
    private readonly cart: CartService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  //  PUBLIC: /build view
  // ─────────────────────────────────────────────────────────────

  /**
   * Public DIY build page for an ACTIVE product that has a (published) guide.
   *
   * Returns the product, the guide, ordered steps, the resolved BOM (each
   * sku/product reference hydrated with name + effective price + aggregate
   * availability), and the bundle if one is linked (with its sellable-Sku price
   * and a VIRTUAL availability = min(floor(memberAvailable / memberQty)) across
   * members). 404 if the product is not ACTIVE, is DIGITAL, or has no published
   * guide — so unpublished guides never leak via the public route.
   */
  async getBuildView(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: {
        diyGuide: {
          include: {
            steps: { orderBy: { sortOrder: 'asc' } },
            bomItems: { orderBy: { sortOrder: 'asc' } },
            bundle: {
              include: {
                bundleSku: true,
                items: { include: { sku: true } },
              },
            },
          },
        },
      },
    });

    // A build view is served ONLY for an ACTIVE, non-DIGITAL, non-BUNDLE product.
    // DIGITAL has no v1 fulfillment (Section 8.10); a BUNDLE-type product is the
    // sellable wrapper for a ComponentBundle and is not expected to carry its own
    // DIY guide — surfacing one would leak internal bundle structure.
    if (
      !product ||
      product.status !== ProductStatus.ACTIVE ||
      product.type === ProductType.DIGITAL ||
      product.type === ProductType.BUNDLE
    ) {
      throw new NotFoundException('Product not found');
    }

    const guide = product.diyGuide;
    if (!guide || !guide.isPublished) {
      throw new NotFoundException('Build guide not found');
    }

    const bom = await this.resolveBom(guide.bomItems);
    // Inactive bundles are never surfaced publicly (parallels the product-level
    // ACTIVE gate above): an admin-deactivated bundle drops to null on /build.
    const bundle =
      guide.bundle && guide.bundle.isActive
        ? await this.resolveBundle(guide.bundle)
        : null;

    // PUBLIC PROJECTION: only the fields the build page needs. Internal/SEO/admin
    // fields (sortOrder, isFeatured, seoTitle/Description, viewCount, raw
    // createdAt/updatedAt, categoryId, status, type, publishedAt) are NOT leaked.
    return {
      product: {
        id: product.id,
        slug: product.slug,
        name: product.name,
        subtitle: product.subtitle,
        brand: product.brand,
        shortDescription: product.shortDescription,
      },
      guide: {
        id: guide.id,
        title: guide.title,
        summary: guide.summary,
        difficulty: guide.difficulty,
        estimatedMinutes: guide.estimatedMinutes,
        isPublished: guide.isPublished,
      },
      steps: guide.steps.map((s) => ({
        id: s.id,
        sortOrder: s.sortOrder,
        title: s.title,
        body: s.body,
        codeLanguage: s.codeLanguage,
        code: s.code,
        media: s.media ?? [],
      })),
      bom,
      bundle,
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  PUBLIC: add a DIY guide's bundle / components to the cart
  // ─────────────────────────────────────────────────────────────

  /**
   * Add a DIY guide's purchasables to the GUARD-RESOLVED cart (architecture 4.12,
   * "Buy the full set" / "Buy individual components"). Inventory is NOT reserved
   * here — that is checkout's job (Section 8.6); this only stages cart lines.
   *
   * IDENTITY: `cartId` and `owner` are supplied by the controller from the guard
   * (`req.cart` / `req.customerId` / JWT), NEVER from the request body — so a
   * client cannot target a cart it does not own (no IDOR). Cart mutation is fully
   * delegated to CartService (this module never writes CartItem rows directly).
   *
   *  - BUNDLE     → adds the single sellable BUNDLE Sku (qty 1). Requires a linked,
   *                 ACTIVE bundle with a minted sellable sku.
   *  - COMPONENTS → adds each SKU-backed BOM line at its declared quantity. Free-
   *                 text and bare product-cross-link rows are skipped (no sku to
   *                 add). CartService validates each SKU is purchasable + prices it.
   */
  async addToCart(
    guideId: string,
    mode: AddDiyMode,
    cartId: string,
    owner: CartOwner,
  ) {
    const guide = await this.prisma.diyGuide.findUnique({
      where: { id: guideId },
      include: {
        product: { select: { status: true, type: true } },
        bundle: { select: { id: true, isActive: true, bundleSkuId: true } },
        bomItems: {
          where: { skuId: { not: null } },
          select: { skuId: true, quantity: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    // Only a published guide on an ACTIVE, purchasable (non-DIGITAL, non-BUNDLE)
    // product is buyable — mirror the /build view's visibility so a hidden guide
    // can never be a purchase path.
    if (
      !guide ||
      !guide.isPublished ||
      guide.product.status !== ProductStatus.ACTIVE ||
      guide.product.type === ProductType.DIGITAL ||
      guide.product.type === ProductType.BUNDLE
    ) {
      throw new NotFoundException('Build guide not found');
    }

    if (mode === AddDiyMode.BUNDLE) {
      if (
        !guide.bundle ||
        !guide.bundle.isActive ||
        !guide.bundle.bundleSkuId
      ) {
        throw new BadRequestException(
          'This guide has no purchasable bundle to add',
        );
      }
      // Delegate to CartService: it asserts the sku is ACTIVE/purchasable, snapshots
      // the price, enforces caps, and recomputes totals.
      return this.cart.addItem(cartId, owner, guide.bundle.bundleSkuId, 1);
    }

    // COMPONENTS: add every SKU-backed BOM line at its quantity. The DB query
    // already filtered to skuId IS NOT NULL.
    const lines = guide.bomItems
      .filter((b): b is { skuId: string; quantity: number } => b.skuId !== null)
      .map((b) => ({ skuId: b.skuId, quantity: Math.max(1, b.quantity) }));
    if (lines.length === 0) {
      throw new BadRequestException(
        'This guide has no purchasable components to add',
      );
    }

    // Add each line in turn through CartService (single-sourced pricing/validation).
    // The last call returns the fully recomputed cart, which we return to the caller.
    let cartView: Awaited<ReturnType<CartService['addItem']>> | undefined;
    for (const line of lines) {
      cartView = await this.cart.addItem(
        cartId,
        owner,
        line.skuId,
        line.quantity,
      );
    }
    return cartView;
  }

  /**
   * Hydrate each BOM row. SKU-backed rows get name + effective price + aggregate
   * availability; product-backed rows get the product's name + slug; free-text
   * rows pass through. Availability for ALL referenced skus is fetched in ONE
   * aggregate query (no N+1).
   */
  private async resolveBom(
    bomItems: {
      id: string;
      skuId: string | null;
      productId: string | null;
      freeTextName: string | null;
      quantity: number;
      note: string | null;
      sortOrder: number;
    }[],
  ) {
    const skuIds = bomItems
      .map((b) => b.skuId)
      .filter((id): id is string => id !== null);
    const productIds = bomItems
      .map((b) => b.productId)
      .filter((id): id is string => id !== null);

    const [skus, availBySku, products] = await Promise.all([
      skuIds.length
        ? this.prisma.sku.findMany({
            where: { id: { in: skuIds } },
            select: {
              id: true,
              skuCode: true,
              name: true,
              basePrice: true,
              salePrice: true,
              isActive: true,
            },
          })
        : Promise.resolve([]),
      this.availabilityForSkus(skuIds),
      productIds.length
        ? // Only ACTIVE products may surface their slug/name on the PUBLIC build
          // view — a DRAFT/ARCHIVED cross-linked product must not leak via the BOM.
          this.prisma.product.findMany({
            where: { id: { in: productIds }, status: ProductStatus.ACTIVE },
            select: { id: true, slug: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const skuById = new Map(skus.map((s) => [s.id, s]));
    const productById = new Map(products.map((p) => [p.id, p]));

    return bomItems.map((b) => {
      const base = {
        id: b.id,
        quantity: b.quantity,
        note: b.note,
        sortOrder: b.sortOrder,
      };

      if (b.skuId) {
        const sku = skuById.get(b.skuId);
        if (sku) {
          // An inactive SKU is not purchasable: report 0 availability so the BOM
          // line renders as a recipe entry without an "add to cart" affordance.
          const available = sku.isActive ? (availBySku.get(b.skuId) ?? 0) : 0;
          return {
            ...base,
            kind: 'SKU' as const,
            skuId: sku.id,
            skuCode: sku.skuCode,
            name: sku.name ?? sku.skuCode,
            effectivePrice: this.effectivePrice(sku.basePrice, sku.salePrice),
            isActive: sku.isActive,
            available,
            inStock: available > 0,
          };
        }
        // skuId set but SKU vanished (SetNull race / hard delete) — degrade gracefully.
        return { ...base, kind: 'SKU' as const, skuId: b.skuId, name: null };
      }

      if (b.productId) {
        const product = productById.get(b.productId);
        return {
          ...base,
          kind: 'PRODUCT' as const,
          productId: b.productId,
          slug: product?.slug ?? null,
          name: product?.name ?? null,
        };
      }

      return {
        ...base,
        kind: 'FREE_TEXT' as const,
        name: b.freeTextName,
      };
    });
  }

  /**
   * Resolve a bundle for the public view: sellable-Sku effective price + VIRTUAL
   * availability = min over members of floor(memberAvailable / memberQty). A
   * bundle with no members (or any member with no stock record) has 0 available.
   */
  private async resolveBundle(bundle: {
    id: string;
    name: string;
    description: string | null;
    isActive: boolean;
    bundleSku: {
      id: string;
      skuCode: string;
      name: string | null;
      basePrice: number;
      salePrice: number | null;
    } | null;
    items: {
      id: string;
      skuId: string;
      quantity: number;
      sku: { id: string; skuCode: string; name: string | null };
    }[];
  }) {
    const memberSkuIds = bundle.items.map((i) => i.skuId);
    const availBySku = await this.availabilityForSkus(memberSkuIds);

    let virtualAvailable = bundle.items.length > 0 ? Infinity : 0;
    const members = bundle.items.map((item) => {
      const memberAvailable = availBySku.get(item.skuId) ?? 0;
      // Defensive: BundleItem.quantity is @default(1) and the DTO enforces @Min(1),
      // but guard against a non-positive per-set quantity so a bad row can never
      // produce floor(x/0)=Infinity and inflate the virtual availability.
      const perSet = item.quantity > 0 ? item.quantity : 1;
      const setsFromMember = Math.floor(memberAvailable / perSet);
      virtualAvailable = Math.min(virtualAvailable, setsFromMember);
      return {
        skuId: item.skuId,
        skuCode: item.sku.skuCode,
        name: item.sku.name ?? item.sku.skuCode,
        quantityPerSet: item.quantity,
        memberAvailable,
      };
    });
    if (!Number.isFinite(virtualAvailable)) virtualAvailable = 0;

    return {
      id: bundle.id,
      name: bundle.name,
      description: bundle.description,
      isActive: bundle.isActive,
      sku: bundle.bundleSku
        ? {
            id: bundle.bundleSku.id,
            skuCode: bundle.bundleSku.skuCode,
            name: bundle.bundleSku.name ?? bundle.bundleSku.skuCode,
            effectivePrice: this.effectivePrice(
              bundle.bundleSku.basePrice,
              bundle.bundleSku.salePrice,
            ),
          }
        : null,
      members,
      available: virtualAvailable,
      inStock: virtualAvailable > 0,
    };
  }

  /**
   * Aggregate available = sum(onHand) - sum(reserved), clamped at 0, per sku, in
   * ONE groupBy query. Read-only (this module does not own inventory). SKUs with
   * no StockLevel rows are absent from the map → treated as 0 by callers.
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

  /** Effective price: salePrice when present and strictly below basePrice, else basePrice. */
  private effectivePrice(basePrice: number, salePrice: number | null): number {
    return salePrice !== null && salePrice < basePrice ? salePrice : basePrice;
  }

  // ─────────────────────────────────────────────────────────────
  //  ADMIN: DIY guide upsert (guide + steps + BOM)
  // ─────────────────────────────────────────────────────────────

  /**
   * Upsert the DIY guide for a product, replacing its steps and BOM wholesale.
   * The guide is 1:1 with the product (DiyGuide.productId @unique). Steps and BOM
   * are delete-then-recreate inside one tx so the editor sends canonical state.
   * Optional `bundleId` links a buy-the-full-set bundle (validated to exist).
   *
   * `actor` is the admin pinned from the JWT (controller passes req.user) and is
   * recorded on the audit log line for this mutation (CLAUDE.md / 4ebf502 —
   * triggeredBy is never accepted from the body).
   *
   * The identity check + every existence query run INSIDE the transaction (under
   * `tx`) so there is no TOCTOU gap: a bundle/SKU/product cannot be deleted
   * between validation and the create, which (with the FK SetNull) would otherwise
   * silently strand a null reference on a row that validated as existing.
   */
  async upsertGuide(productId: string, dto: UpsertDiyDto, actor: DiyActor) {
    // The DB CHECK identity (sku OR product OR free-text) is a pure-payload check
    // with no DB read, so we can fail fast before opening the transaction.
    this.assertBomIdentities(dto.bom);

    const result = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) throw new NotFoundException('Product not found');

      // Bundle existence + BOM reference existence checked UNDER the tx (TOCTOU
      // closed): a row deleted after this point can't slip a null reference past
      // the FK SetNull, because the create happens in the same transaction.
      if (dto.bundleId) {
        const bundle = await tx.componentBundle.findUnique({
          where: { id: dto.bundleId },
          select: { id: true },
        });
        if (!bundle) throw new BadRequestException('Linked bundle not found');
      }
      await this.assertBomReferencesExist(tx, dto.bom);

      const existing = await tx.diyGuide.findUnique({
        where: { productId },
        select: { id: true },
      });

      let guideId: string;
      const created = !existing;
      if (existing) {
        guideId = existing.id;
        await tx.diyGuide.update({
          where: { id: guideId },
          data: {
            title: dto.title,
            summary: dto.summary ?? null,
            difficulty: dto.difficulty ?? null,
            estimatedMinutes: dto.estimatedMinutes ?? null,
            bundleId: dto.bundleId ?? null,
            isPublished: dto.isPublished ?? false,
          },
        });
        await tx.diyStep.deleteMany({ where: { guideId } });
        await tx.diyBomItem.deleteMany({ where: { guideId } });
      } else {
        const createdGuide = await tx.diyGuide.create({
          data: {
            productId,
            title: dto.title,
            summary: dto.summary ?? null,
            difficulty: dto.difficulty ?? null,
            estimatedMinutes: dto.estimatedMinutes ?? null,
            bundleId: dto.bundleId ?? null,
            isPublished: dto.isPublished ?? false,
          },
          select: { id: true },
        });
        guideId = createdGuide.id;
      }

      if (dto.steps.length > 0) {
        await tx.diyStep.createMany({
          data: dto.steps.map((s, idx) => ({
            guideId,
            sortOrder: s.sortOrder ?? idx,
            title: s.title,
            body: s.body,
            codeLanguage: s.codeLanguage ?? null,
            code: s.code ?? null,
            media: (s.media ?? []) as unknown as Prisma.InputJsonValue,
          })),
        });
      }

      if (dto.bom.length > 0) {
        await tx.diyBomItem.createMany({
          data: dto.bom.map((b, idx) => ({
            guideId,
            skuId: b.skuId ?? null,
            productId: b.productId ?? null,
            freeTextName: b.freeTextName ?? null,
            quantity: b.quantity,
            note: b.note ?? null,
            sortOrder: b.sortOrder ?? idx,
          })),
        });
      }

      const guide = await tx.diyGuide.findUniqueOrThrow({
        where: { id: guideId },
        include: {
          steps: { orderBy: { sortOrder: 'asc' } },
          bomItems: { orderBy: { sortOrder: 'asc' } },
        },
      });
      return { guide, created };
    });

    // Audit trail (actor pinned from JWT). No DiyEvent model exists in the schema,
    // so the admin mutation is recorded on the structured log with the actor id —
    // the identity that the security rule (4ebf502) requires to be sourced from
    // the token, never the body.
    this.logger.log(
      `DIY guide ${result.created ? 'created' : 'updated'} guideId=${result.guide.id} ` +
        `productId=${productId} steps=${dto.steps.length} bom=${dto.bom.length} ` +
        `triggeredBy=${actor.id} role=${actor.role ?? 'ADMIN'}`,
    );

    return { created: result.created, guide: result.guide };
  }

  /** Re-assert the DB CHECK (sku OR product OR free-text) with a friendly 400. */
  private assertBomIdentities(bom: UpsertDiyBomItemDto[]): void {
    for (const [i, b] of bom.entries()) {
      if (!b.skuId && !b.productId && !b.freeTextName?.trim()) {
        throw new BadRequestException(
          `BOM item #${i + 1} must reference a SKU, a product, or a free-text component name`,
        );
      }
    }
  }

  /**
   * Verify every referenced sku/product id exists (batched, no N+1), under the
   * caller's transaction so the check is atomic with the BOM create (no TOCTOU).
   * Referenced PRODUCTS must be ACTIVE: a DRAFT/ARCHIVED product cannot be
   * cross-linked into a BOM (it would later leak on the public /build view).
   * Referenced SKUs need only exist — an admin may BOM-link a temporarily
   * inactive SKU, and the public view degrades inactive SKUs to 0-availability.
   */
  private async assertBomReferencesExist(
    tx: Prisma.TransactionClient,
    bom: UpsertDiyBomItemDto[],
  ): Promise<void> {
    const skuIds = [
      ...new Set(bom.map((b) => b.skuId).filter((id): id is string => !!id)),
    ];
    const productIds = [
      ...new Set(
        bom.map((b) => b.productId).filter((id): id is string => !!id),
      ),
    ];

    if (skuIds.length > 0) {
      const found = await tx.sku.findMany({
        where: { id: { in: skuIds } },
        select: { id: true },
      });
      const foundIds = new Set(found.map((s) => s.id));
      const missing = skuIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `BOM references unknown SKU(s): ${missing.join(', ')}`,
        );
      }
    }

    if (productIds.length > 0) {
      const found = await tx.product.findMany({
        where: { id: { in: productIds }, status: ProductStatus.ACTIVE },
        select: { id: true },
      });
      const foundIds = new Set(found.map((p) => p.id));
      const missing = productIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `BOM references unknown or non-active product(s): ${missing.join(', ')}`,
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  ADMIN: Bundle creation (mints the sellable BUNDLE Sku)
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a ComponentBundle + its members + the sellable BUNDLE Sku.
   *
   *  - `productId` must reference an existing Product of type BUNDLE (the wrapper).
   *    A bundle is sold via a BUNDLE-type Sku, so its sku must hang off a BUNDLE
   *    product — we refuse a STANDARD/DIGITAL wrapper.
   *  - the sellable Sku is MINTED here (catalog owns ordinary sku CRUD, but the
   *    bundle's sku is a bundle artefact, so the diy module mints it and seeds the
   *    per-warehouse StockLevel rows exactly like catalog.createSku).
   *  - members must be DISTINCT, EXISTING, ACTIVE skus whose parent product is
   *    ACTIVE — an ARCHIVED-product or disabled SKU is refused so a bundle never
   *    surfaces misleading availability or leaks an internal/retired SKU code.
   *
   * `actor` is the admin pinned from the JWT (controller passes req.user) and is
   * recorded as `triggeredBy` on the StockMovement seeded for each bundle-SKU
   * StockLevel and on the audit log line (CLAUDE.md / 4ebf502 — never from body).
   *
   * Boundary: `basePrice`/`salePrice` arrive in RUPEES and are converted to paise
   * here (the only place this module touches money in).
   */
  async createBundle(dto: CreateBundleDto, actor: DiyActor) {
    // Distinct, non-empty member set (payload-only check — fail fast pre-tx).
    const memberIds = dto.items.map((i) => i.skuId);
    if (new Set(memberIds).size !== memberIds.length) {
      throw new BadRequestException('Bundle members must be distinct SKUs');
    }

    // Convert money at the boundary BEFORE the tx so a bad amount is a clean 400.
    const basePrice = rupeesToPaise(dto.basePrice, 'basePrice');
    const salePrice =
      optionalRupeesToPaise(dto.salePrice ?? undefined, 'salePrice') ?? null;
    if (salePrice !== null && salePrice > basePrice) {
      throw new BadRequestException('salePrice must not exceed basePrice');
    }

    try {
      const bundle = await this.prisma.$transaction(async (tx) => {
        // Wrapper product must exist and be of type BUNDLE (checked under tx).
        const product = await tx.product.findUnique({
          where: { id: dto.productId },
          select: { id: true, type: true },
        });
        if (!product)
          throw new BadRequestException('Wrapper product not found');
        if (product.type !== ProductType.BUNDLE) {
          throw new BadRequestException(
            'Bundle wrapper product must be of type BUNDLE',
          );
        }

        // One bundle per wrapper product (ComponentBundle.productId @unique).
        const existingForProduct = await tx.componentBundle.findUnique({
          where: { productId: dto.productId },
          select: { id: true },
        });
        if (existingForProduct) {
          throw new ConflictException(
            'This product already has a component bundle',
          );
        }

        // Members must exist, be ACTIVE, and belong to an ACTIVE product. This
        // also closes the self-reference question: every member must already be a
        // persisted, ACTIVE SKU, whereas the bundle's own sellable SKU is minted
        // BELOW with a fresh id that cannot appear in the user-supplied member set
        // — so no separate post-mint self-reference guard is needed (the previous
        // one checked the freshly-minted id and was unreachable).
        const members = await tx.sku.findMany({
          where: { id: { in: memberIds } },
          select: {
            id: true,
            isActive: true,
            product: { select: { status: true } },
          },
        });
        const memberById = new Map(members.map((m) => [m.id, m]));
        const missing = memberIds.filter((id) => !memberById.has(id));
        if (missing.length > 0) {
          throw new BadRequestException(
            `Unknown member SKU(s): ${missing.join(', ')}`,
          );
        }
        const inactive = memberIds.filter((id) => {
          const m = memberById.get(id)!;
          return !m.isActive || m.product.status !== ProductStatus.ACTIVE;
        });
        if (inactive.length > 0) {
          throw new BadRequestException(
            `Bundle members must be ACTIVE SKUs of ACTIVE products; rejected: ${inactive.join(', ')}`,
          );
        }

        if (dto.taxClassId) {
          const tc = await tx.taxClass.findUnique({
            where: { id: dto.taxClassId },
            select: { id: true },
          });
          if (!tc) throw new BadRequestException('Tax class not found');
        }

        // Mint the sellable BUNDLE sku under the wrapper product.
        const bundleSku = await tx.sku.create({
          data: {
            productId: dto.productId,
            skuCode: dto.skuCode,
            barcode: dto.barcode ?? null,
            name: dto.skuName ?? dto.name,
            hsnCode: dto.hsnCode ?? null,
            taxClassId: dto.taxClassId ?? null,
            basePrice,
            salePrice,
            isActive: true,
          },
        });

        // Seed empty StockLevel rows per active warehouse so inventory always has a
        // (sku, warehouse) row to lock against — same lazy-seed as catalog.createSku.
        const warehouses = await tx.warehouse.findMany({
          where: { isActive: true },
          select: { id: true },
        });
        if (warehouses.length > 0) {
          await tx.stockLevel.createMany({
            data: warehouses.map((w) => ({
              skuId: bundleSku.id,
              warehouseId: w.id,
              onHand: 0,
              reserved: 0,
            })),
            skipDuplicates: true,
          });
          // Open the StockMovement ledger for the new bundle SKU with a zero-qty
          // ADJUST/MANUAL_ADJUST per (sku, warehouse), triggeredBy the JWT actor —
          // so the inventory audit trail for bundle SKUs is never empty and the
          // first real movement has a baseline (Section 8.7 + 4ebf502).
          await tx.stockMovement.createMany({
            data: warehouses.map((w) => ({
              skuId: bundleSku.id,
              warehouseId: w.id,
              type: StockMovementType.ADJUST,
              reason: StockMovementReason.MANUAL_ADJUST,
              quantity: 0,
              reservedDelta: 0,
              balanceAfter: 0,
              referenceType: 'BUNDLE_CREATE',
              referenceId: bundleSku.id,
              triggeredBy: actor.id,
              actorRole: actor.role ?? null,
              note: 'Bundle SKU stock ledger opened on bundle creation',
            })),
          });
        }

        return tx.componentBundle.create({
          data: {
            productId: dto.productId,
            bundleSkuId: bundleSku.id,
            name: dto.name,
            description: dto.description ?? null,
            items: {
              create: dto.items.map((i) => ({
                skuId: i.skuId,
                quantity: i.quantity,
              })),
            },
          },
          include: {
            bundleSku: true,
            items: { include: { sku: true } },
          },
        });
      });

      this.logger.log(
        `Component bundle created bundleId=${bundle.id} bundleSkuId=${bundle.bundleSkuId} ` +
          `productId=${dto.productId} members=${memberIds.length} ` +
          `triggeredBy=${actor.id} role=${actor.role ?? 'ADMIN'}`,
      );

      return bundle;
    } catch (e) {
      throw this.mapSkuUniqueError(e);
    }
  }

  /** Map a P2002 on the minted bundle sku (skuCode/barcode) to a clear 409. */
  private mapSkuUniqueError(e: unknown): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const target = e.meta?.target;
      const field = Array.isArray(target)
        ? target.map((t) => String(t)).join(',')
        : typeof target === 'string'
          ? target
          : '';
      if (field.includes('barcode')) {
        return new ConflictException('A SKU with that barcode already exists');
      }
      if (field.includes('sku_code') || field.includes('skuCode')) {
        return new ConflictException('A SKU with that skuCode already exists');
      }
      return new ConflictException(
        'A unique constraint was violated creating the bundle',
      );
    }
    return e;
  }
}
