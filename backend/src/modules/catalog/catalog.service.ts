import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ProductStatus, ProductMediaType } from '@prisma/client';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma';
import { DocumentService } from '../document/document.service';
import {
  CreateProductDto,
  UpdateProductDto,
  ProductQueryDto,
  CreateSkuDto,
  UpdateSkuDto,
  CreatePriceTierDto,
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateTaxClassDto,
  UpsertTabsDto,
  PresignMediaDto,
  ConfirmMediaDto,
} from './dto';
import {
  ALLOWED_MEDIA_MIME,
  PRODUCT_MEDIA_CAP,
  MEDIA_MAX_BYTES,
} from './dto/media.dto';
import { rupeesToPaise, optionalRupeesToPaise } from './dto/money';

/** Max slug-collision retries before surfacing a 409 SLUG_CONFLICT. */
const SLUG_MAX_ATTEMPTS = 10;

/**
 * Sentinel category name used to force an empty result set when a category-slug
 * filter resolves to an unknown category. It can never collide with a real
 * category name because the leading space + double-underscore form is rejected
 * by slug generation and is documented here as a non-value. (Section 8.9)
 */
const NO_SUCH_CATEGORY = ' __no_such_category__';

/** Hard cap on the category table scan used for subtree/cycle computation (DoS guard). */
const CATEGORY_SCAN_LIMIT = 10_000;

/** Presigned PUT URL lifetime (seconds). Orphan PENDING rows are GC'd after this. */
const MEDIA_PRESIGN_TTL_SECONDS = 3600;

/**
 * Presigned READ (GET) URL lifetime for list thumbnails (seconds). Named + passed
 * explicitly so the TTL is an intentional catalog-side constant rather than
 * inheriting DocumentService.getSignedDownloadUrlForKey's default — matches the
 * page-render lifecycle and is immune to upstream default changes.
 */
const THUMBNAIL_READ_TTL_SECONDS = 3600;

/** Default page size for product listings. */
const DEFAULT_PAGE_LIMIT = 20;

/** Hard cap on a single listing page (clamps a caller-supplied limit). */
const MAX_PAGE_LIMIT = 100;

/**
 * Clamp a caller-supplied page/limit to safe bounds: page >= 1 (default 1), limit
 * in [1, {@link MAX_PAGE_LIMIT}] (default {@link DEFAULT_PAGE_LIMIT}). Shared by
 * the public and admin product listings so the cap lives in exactly one place.
 */
function normalisePagination(
  page?: number,
  limit?: number,
): { page: number; limit: number; skip: number } {
  const safePage = page && page > 0 ? page : 1;
  const safeLimit =
    limit && limit > 0 ? Math.min(limit, MAX_PAGE_LIMIT) : DEFAULT_PAGE_LIMIT;
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
}

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly documents: DocumentService,
  ) {
    this.s3 = new S3Client({
      region: this.config.get<string>('AWS_REGION', 'ap-south-1'),
      credentials: {
        accessKeyId: this.config.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.config.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
    this.bucket = this.config.get<string>('AWS_S3_BUCKET', 'arya-documents');
  }

  // ─── SLUG GENERATION (race-safe) ──────────────────────────

  /**
   * Derive a URL-safe base slug from an arbitrary name.
   */
  private static baseSlug(name: string): string {
    const slug = name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/gu, '') // strip combining diacritical marks (Unicode block U+0300-U+036F)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return slug || 'item';
  }

  /**
   * Race-safe insert that derives a slug from `name` and retries with `-2`,
   * `-3`, … on a unique-constraint collision (Prisma P2002 on the `slug`
   * column). Two concurrent creates of the same name both derive the same base
   * slug; the DB `@unique` guarantees only one wins per candidate, so the loser
   * retries the next suffix instead of crashing with a 500. Exhausting the
   * bounded attempts surfaces a friendly 409 SLUG_CONFLICT. (Section 8.14)
   *
   * @param name      source name for the base slug
   * @param create    given a candidate slug, performs the create and returns the row
   */
  private async insertWithUniqueSlug<T>(
    name: string,
    create: (slug: string) => Promise<T>,
  ): Promise<T> {
    const base = CatalogService.baseSlug(name);
    for (let attempt = 1; attempt <= SLUG_MAX_ATTEMPTS; attempt++) {
      const candidate = attempt === 1 ? base : `${base}-${attempt}`;
      try {
        return await create(candidate);
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          CatalogService.targetsSlug(e)
        ) {
          // Collision on slug — try the next suffix.
          continue;
        }
        throw e;
      }
    }
    throw new ConflictException({
      code: 'SLUG_CONFLICT',
      message: `Could not generate a unique slug for "${name}" after ${SLUG_MAX_ATTEMPTS} attempts`,
    });
  }

  /** True if a P2002 unique violation targets the `slug` column. */
  private static targetsSlug(e: Prisma.PrismaClientKnownRequestError): boolean {
    const target = e.meta?.target;
    if (Array.isArray(target))
      return target.some((t) => String(t).includes('slug'));
    if (typeof target === 'string') return target.includes('slug');
    // Some adapters omit meta.target; assume slug since that's the only slug
    // unique on these creates that we retry.
    return true;
  }

  // ─── PRODUCT (admin) ──────────────────────────────────────

  async createProduct(dto: CreateProductDto) {
    const categoryName = await this.resolveCategoryName(dto.categoryId);

    return this.insertWithUniqueSlug(dto.name, (slug) =>
      this.prisma.product.create({
        data: {
          slug,
          name: dto.name,
          subtitle: dto.subtitle,
          brand: dto.brand,
          shortDescription: dto.shortDescription,
          status: dto.status ?? ProductStatus.DRAFT,
          type: dto.type,
          categoryId: dto.categoryId,
          category: categoryName,
          tags: dto.tags ?? [],
          isFeatured: dto.isFeatured ?? false,
          sortOrder: dto.sortOrder ?? 0,
          seoTitle: dto.seoTitle,
          seoDescription: dto.seoDescription,
          // publishedAt is set the first time status flips to ACTIVE (see update).
          publishedAt:
            (dto.status ?? ProductStatus.DRAFT) === ProductStatus.ACTIVE
              ? new Date()
              : null,
        },
      }),
    );
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Product not found');

    const data: Prisma.ProductUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.subtitle !== undefined) data.subtitle = dto.subtitle;
    if (dto.brand !== undefined) data.brand = dto.brand;
    if (dto.shortDescription !== undefined)
      data.shortDescription = dto.shortDescription;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.isFeatured !== undefined) data.isFeatured = dto.isFeatured;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.seoTitle !== undefined) data.seoTitle = dto.seoTitle;
    if (dto.seoDescription !== undefined)
      data.seoDescription = dto.seoDescription;

    // Category re-point also re-syncs the denormalized name cache for this row.
    if (dto.categoryId !== undefined) {
      // Pass null through directly: resolveCategoryName returns null for a null
      // categoryId, which correctly clears the denormalized cache field.
      const categoryName = await this.resolveCategoryName(dto.categoryId);
      data.categoryRef =
        dto.categoryId === null
          ? { disconnect: true }
          : { connect: { id: dto.categoryId } };
      data.category = categoryName;
    }

    // Publishing sets publishedAt once (the first transition into ACTIVE).
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === ProductStatus.ACTIVE && !existing.publishedAt) {
        data.publishedAt = new Date();
      }
    }

    return this.prisma.product.update({ where: { id }, data });
  }

  /** Archive a product (soft "delete" per the architecture). */
  async archiveProduct(id: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Product not found');
    return this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.ARCHIVED },
    });
  }

  /** Admin product detail — all statuses, full nested tree. */
  async adminGetProduct(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        categoryRef: true,
        media: { orderBy: { sortOrder: 'asc' } },
        tabs: {
          orderBy: { sortOrder: 'asc' },
          include: { sections: { orderBy: { sortOrder: 'asc' } } },
        },
        skus: {
          orderBy: { createdAt: 'asc' },
          include: {
            priceTiers: { orderBy: { minQty: 'asc' } },
            taxClass: true,
          },
        },
        diyGuide: {
          include: {
            steps: { orderBy: { sortOrder: 'asc' } },
            bomItems: { orderBy: { sortOrder: 'asc' } },
          },
        },
        bundle: { include: { items: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  // ─── PRODUCT (public read) ────────────────────────────────

  /**
   * Public paginated list of ACTIVE products. DIGITAL products are excluded by
   * default (Section 8.10 — not purchasable in v1). Never N+1: SKUs are fetched
   * via a single grouped include and prices summarised in-memory.
   */
  async listPublicProducts(query: ProductQueryDto) {
    const { page, limit, skip } = normalisePagination(query.page, query.limit);

    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.ACTIVE,
      type: { not: 'DIGITAL' },
    };

    if (query.category) {
      // Filter by category slug → its denormalized name cache on Product.
      const cat = await this.prisma.category.findUnique({
        where: { slug: query.category },
        select: { name: true },
      });
      // Unknown category slug → empty result set (never leak all products).
      where.category = cat ? cat.name : NO_SUCH_CATEGORY;
    }

    if (query.tag) {
      where.tags = { has: query.tag };
    }

    if (query.featured) {
      where.isFeatured = true;
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { subtitle: { contains: query.search, mode: 'insensitive' } },
        { brand: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    // Price filter is applied against the SKU effective price; we constrain on
    // the related SKU rows so a product with at least one in-range SKU matches.
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const priceCond: Prisma.IntFilter = {};
      if (query.minPrice !== undefined)
        priceCond.gte = rupeesToPaise(query.minPrice, 'minPrice');
      if (query.maxPrice !== undefined)
        priceCond.lte = rupeesToPaise(query.maxPrice, 'maxPrice');
      where.skus = { some: { isActive: true, basePrice: priceCond } };
    }

    const orderBy = this.buildProductOrderBy(query.sort);

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          // Primary image only: first CONFIRMED IMAGE by sortOrder. A presigned
          // READ url is resolved per row below (batched). VIDEO media never act
          // as the list thumbnail.
          media: {
            where: { status: 'CONFIRMED', type: ProductMediaType.IMAGE },
            orderBy: { sortOrder: 'asc' },
            take: 1,
          },
          skus: {
            where: { isActive: true },
            select: { basePrice: true, salePrice: true, currency: true },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    // Resolve presigned thumbnail URLs for the whole page in parallel.
    const thumbnails = await this.resolveThumbnails(rows);

    const data = rows.map((p, i) => {
      const prices = p.skus.map((s) =>
        this.effectivePrice(s.basePrice, s.salePrice),
      );
      const minPrice = prices.length ? Math.min(...prices) : null;
      const maxPrice = prices.length ? Math.max(...prices) : null;
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        subtitle: p.subtitle,
        brand: p.brand,
        category: p.category,
        tags: p.tags,
        isFeatured: p.isFeatured,
        thumbnail: thumbnails[i],
        priceFrom: minPrice,
        priceTo: maxPrice,
        currency: p.skus[0]?.currency ?? 'INR',
        viewCount: p.viewCount,
        publishedAt: p.publishedAt,
      };
    });

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Admin paginated list of products across ALL statuses (DRAFT/ACTIVE/ARCHIVED)
   * — unlike {@link listPublicProducts}, which is ACTIVE + non-DIGITAL only. The
   * admin product manager needs to see drafts and archived rows, so this applies
   * no status/type gate by default; an optional `status` narrows it. Supports
   * title/slug search + pagination. Each row carries a presigned thumbnail url
   * (first CONFIRMED IMAGE) resolved in a single batched pass. (Section 8.x)
   */
  async adminListProducts(params: {
    status?: ProductStatus;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { page, limit, skip } = normalisePagination(
      params.page,
      params.limit,
    );

    const where: Prisma.ProductWhereInput = {};
    if (params.status) {
      where.status = params.status;
    }
    if (params.search) {
      const term = params.search.trim();
      if (term) {
        where.OR = [
          { name: { contains: term, mode: 'insensitive' } },
          { slug: { contains: term, mode: 'insensitive' } },
        ];
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        include: {
          media: {
            where: { status: 'CONFIRMED', type: ProductMediaType.IMAGE },
            orderBy: { sortOrder: 'asc' },
            take: 1,
          },
          skus: {
            where: { isActive: true },
            select: { basePrice: true, salePrice: true, currency: true },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    const thumbnails = await this.resolveThumbnails(rows);

    const data = rows.map((p, i) => {
      const prices = p.skus.map((s) =>
        this.effectivePrice(s.basePrice, s.salePrice),
      );
      const minPrice = prices.length ? Math.min(...prices) : null;
      const maxPrice = prices.length ? Math.max(...prices) : null;
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        subtitle: p.subtitle,
        brand: p.brand,
        category: p.category,
        tags: p.tags,
        status: p.status,
        type: p.type,
        isFeatured: p.isFeatured,
        thumbnail: thumbnails[i],
        priceFrom: minPrice,
        priceTo: maxPrice,
        currency: p.skus[0]?.currency ?? 'INR',
        viewCount: p.viewCount,
        publishedAt: p.publishedAt,
        updatedAt: p.updatedAt,
      };
    });

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Resolve a presigned READ url for each row's primary image (the single
   * pre-selected CONFIRMED IMAGE in `media[0]`). Batched with Promise.all; a row
   * with no media — or a presign failure — yields `null` rather than aborting the
   * whole listing. Returns one entry per input row, index-aligned.
   */
  private async resolveThumbnails(
    rows: { media: { s3Key: string; altText: string | null }[] }[],
  ): Promise<({ url: string; altText: string | null } | null)[]> {
    return Promise.all(
      rows.map(async (p) => {
        const primary = p.media[0];
        if (!primary?.s3Key) return null;
        try {
          const url = await this.documents.getSignedDownloadUrlForKey(
            primary.s3Key,
            THUMBNAIL_READ_TTL_SECONDS,
          );
          return { url, altText: primary.altText };
        } catch (e) {
          this.logger.warn(
            `Failed to presign thumbnail for key ${primary.s3Key}: ${
              (e as Error)?.message
            }`,
          );
          return null;
        }
      }),
    );
  }

  private buildProductOrderBy(
    sort?: string,
  ): Prisma.ProductOrderByWithRelationInput[] {
    switch (sort) {
      case 'popular':
        return [{ viewCount: 'desc' }, { publishedAt: 'desc' }];
      case 'featured':
        return [
          { isFeatured: 'desc' },
          { sortOrder: 'asc' },
          { publishedAt: 'desc' },
        ];
      case 'newest':
        return [{ publishedAt: 'desc' }, { createdAt: 'desc' }];
      // price_asc / price_desc cannot be expressed directly on the product row
      // (price lives on SKUs); fall back to a stable sort. The SKU price range is
      // returned per item so the client can sort the page if desired. Default to
      // curated order.
      default:
        return [
          { sortOrder: 'asc' },
          { isFeatured: 'desc' },
          { publishedAt: 'desc' },
        ];
    }
  }

  /** Effective unit price in paise: active sale price if set, else base. */
  private effectivePrice(basePrice: number, salePrice: number | null): number {
    return salePrice !== null &&
      salePrice !== undefined &&
      salePrice < basePrice
      ? salePrice
      : basePrice;
  }

  /**
   * Public product detail by slug. Returns CONFIRMED media only, tabs+sections,
   * active SKUs with price tiers, and a per-SKU stock summary (READ-ONLY — this
   * module does not own inventory; it reads StockLevel for display).
   */
  async getPublicProductBySlug(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: {
        categoryRef: { select: { id: true, slug: true, name: true } },
        media: {
          where: { status: 'CONFIRMED' },
          orderBy: { sortOrder: 'asc' },
        },
        tabs: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          include: { sections: { orderBy: { sortOrder: 'asc' } } },
        },
        skus: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          include: {
            priceTiers: { orderBy: { minQty: 'asc' } },
            taxClass: { select: { id: true, name: true, type: true } },
            stockLevels: { select: { onHand: true, reserved: true } },
          },
        },
      },
    });

    if (
      !product ||
      product.status !== ProductStatus.ACTIVE ||
      product.type === 'DIGITAL'
    ) {
      throw new NotFoundException('Product not found');
    }

    const skus = product.skus.map(({ stockLevels, ...rest }) => {
      const onHand = stockLevels.reduce((sum, l) => sum + l.onHand, 0);
      const reserved = stockLevels.reduce((sum, l) => sum + l.reserved, 0);
      // Never leak per-warehouse reservation internals; expose aggregate available.
      const available = Math.max(0, onHand - reserved);
      // `stockLevels` is intentionally excluded from `rest` (consumed above).
      return {
        ...rest,
        effectivePrice: this.effectivePrice(rest.basePrice, rest.salePrice),
        stock: { available, inStock: available > 0 },
      };
    });

    return { ...product, skus };
  }

  // NOTE: the public DIY `/build` view and the admin DIY-guide / bundle upsert
  // endpoints are owned by the `diy` module (architecture Section 4.12), not
  // catalog. They were removed here to keep catalog's responsibility to
  // product / sku / category / media / tab / tax CRUD + ACTIVE public reads, and
  // to avoid a circular dependency when `diy` calls catalog for product lookups.

  // ─── CATEGORY ─────────────────────────────────────────────

  async createCategory(dto: CreateCategoryDto) {
    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) throw new BadRequestException('Parent category not found');
    }
    return this.insertWithUniqueSlug(dto.name, (slug) =>
      this.prisma.category.create({
        data: {
          slug,
          name: dto.name,
          parentId: dto.parentId,
          sortOrder: dto.sortOrder ?? 0,
        },
      }),
    );
  }

  /** Public category tree (nested children, sorted). */
  async getCategoryTree() {
    const all = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        parentId: true,
        sortOrder: true,
      },
    });

    type Node = (typeof all)[number] & { children: Node[] };
    const byId = new Map<string, Node>();
    for (const c of all) byId.set(c.id, { ...c, children: [] });

    const roots: Node[] = [];
    for (const c of all) {
      const node = byId.get(c.id)!;
      if (c.parentId && byId.has(c.parentId)) {
        byId.get(c.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  /**
   * Re-parent or rename a category. A rename or re-parent changes the resolved
   * category NAME for the whole subtree, so we re-sync the denormalized
   * Product.category cache for every product under the affected subtree
   * (Section 8.9). Guards against cycles on re-parent.
   */
  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Category not found');

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent');
      }
    }

    const data: Prisma.CategoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.parentId !== undefined) {
      data.parent =
        dto.parentId === null
          ? { disconnect: true }
          : { connect: { id: dto.parentId } };
    }

    // Serialize re-parents/renames of this category under an advisory xact lock
    // so the subtree scan + cycle check + update are atomic w.r.t. concurrent
    // re-parents (closes the TOCTOU the reviewer flagged; same idiom as
    // payment.service / equity.service).
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cat_reparent_${id}`}))`;

      // Validate the new parent + cycle guard INSIDE the tx, after the lock,
      // against the full subtree so a racing re-parent cannot slip through.
      if (dto.parentId !== undefined && dto.parentId !== null) {
        const parent = await tx.category.findUnique({
          where: { id: dto.parentId },
          select: { id: true },
        });
        if (!parent) throw new BadRequestException('Parent category not found');
        const subtreeIds = await this.collectSubtreeIds(id, tx);
        if (subtreeIds.has(dto.parentId)) {
          throw new BadRequestException(
            'Cannot move a category under its own descendant',
          );
        }
      }

      const updated = await tx.category.update({ where: { id }, data });

      // Re-sync the denormalized Product.category for the ENTIRE affected
      // subtree (not just products directly in this category). A rename or
      // re-parent changes the resolved name string returned to listing filters
      // for every product under the subtree, so all of them must be re-synced
      // to their own (post-update) category name. (Section 8.9)
      await this.resyncSubtreeProductCategory(tx, id);
      return updated;
    });
  }

  /**
   * Delete a category. Children float to root (schema onDelete: SetNull). The
   * denormalized Product.category for every product directly in this category is
   * cleared (the category no longer exists); products in the now-orphaned child
   * categories keep their own category name. (Section 8.9)
   */
  async deleteCategory(id: string, confirm: boolean) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Category not found');

    if (confirm !== true) {
      throw new BadRequestException(
        'Deleting this category will float its child categories to the root and clear the category on its products. Pass confirm=true to proceed.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cat_reparent_${id}`}))`;

      // Collect the child-subtree ids BEFORE the delete (the FK SetNull on
      // delete only re-roots the direct children; their descendants are
      // unaffected, but every product under any descendant must still have its
      // denormalized Product.category re-synced to its own category name).
      const subtreeIds = await this.collectSubtreeIds(id, tx);

      // Products directly in the deleted category lose their category cache
      // (the category no longer exists). Done explicitly because the FK clears
      // categoryId via SetNull but does not touch the denormalized string.
      await tx.product.updateMany({
        where: { categoryId: id },
        data: { category: null },
      });

      // Delete the category itself; direct children float to root (FK SetNull).
      await tx.category.delete({ where: { id } });

      // Re-sync the denormalized Product.category across the rest of the
      // affected subtree (every surviving descendant category) so listing
      // filters never return stale cache strings. (Section 8.9)
      const survivors = [...subtreeIds].filter((cid) => cid !== id);
      if (survivors.length > 0) {
        await this.resyncProductCategoryForIds(tx, survivors);
      }

      return { id, deleted: true };
    });
  }

  // ─── SKU ──────────────────────────────────────────────────

  /**
   * Create a SKU under a product. Per the architecture, SKU creation lazily
   * creates a StockLevel row per active warehouse (0/0) so inventory has a row
   * to CAS against. This module reads/creates the StockLevel skeleton only; it
   * never mutates onHand/reserved (inventory owns those mutations).
   */
  async createSku(productId: string, dto: CreateSkuDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const basePrice = rupeesToPaise(dto.basePrice, 'basePrice');
    const salePrice =
      optionalRupeesToPaise(dto.salePrice ?? undefined, 'salePrice') ?? null;
    if (salePrice !== null && salePrice > basePrice) {
      throw new BadRequestException('salePrice must not exceed basePrice');
    }
    if (dto.taxClassId) await this.assertTaxClassExists(dto.taxClassId);

    const { saleStartsAt, saleEndsAt } = this.parseSaleWindow(
      dto.saleStartsAt,
      dto.saleEndsAt,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const sku = await tx.sku.create({
          data: {
            productId,
            skuCode: dto.skuCode,
            barcode: dto.barcode,
            name: dto.name,
            variantAttributes: (dto.variantAttributes ??
              {}) as Prisma.InputJsonValue,
            hsnCode: dto.hsnCode,
            taxClassId: dto.taxClassId,
            basePrice,
            salePrice,
            saleStartsAt,
            saleEndsAt,
            weightGrams: dto.weightGrams,
            lengthMm: dto.lengthMm,
            widthMm: dto.widthMm,
            heightMm: dto.heightMm,
            reorderPoint: dto.reorderPoint ?? 0,
            reorderQty: dto.reorderQty ?? 0,
            isActive: dto.isActive ?? true,
          },
        });

        // Lazily seed an empty StockLevel row per active warehouse so the
        // inventory module always has a (sku,warehouse) row to CAS-lock against.
        const warehouses = await tx.warehouse.findMany({
          where: { isActive: true },
          select: { id: true },
        });
        if (warehouses.length > 0) {
          await tx.stockLevel.createMany({
            data: warehouses.map((w) => ({
              skuId: sku.id,
              warehouseId: w.id,
              onHand: 0,
              reserved: 0,
              reorderPoint: dto.reorderPoint ?? 0,
              reorderQty: dto.reorderQty ?? 0,
            })),
            skipDuplicates: true,
          });
        }

        return sku;
      });
    } catch (e) {
      throw this.mapSkuUniqueError(e);
    }
  }

  async updateSku(id: string, dto: UpdateSkuDto) {
    const existing = await this.prisma.sku.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('SKU not found');

    const data: Prisma.SkuUpdateInput = {};
    if (dto.skuCode !== undefined) data.skuCode = dto.skuCode;
    if (dto.barcode !== undefined) data.barcode = dto.barcode;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.variantAttributes !== undefined) {
      data.variantAttributes = dto.variantAttributes as Prisma.InputJsonValue;
    }
    if (dto.hsnCode !== undefined) data.hsnCode = dto.hsnCode;
    if (dto.weightGrams !== undefined) data.weightGrams = dto.weightGrams;
    if (dto.lengthMm !== undefined) data.lengthMm = dto.lengthMm;
    if (dto.widthMm !== undefined) data.widthMm = dto.widthMm;
    if (dto.heightMm !== undefined) data.heightMm = dto.heightMm;
    if (dto.reorderPoint !== undefined) data.reorderPoint = dto.reorderPoint;
    if (dto.reorderQty !== undefined) data.reorderQty = dto.reorderQty;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (dto.taxClassId !== undefined) {
      if (dto.taxClassId === null) {
        data.taxClass = { disconnect: true };
      } else {
        await this.assertTaxClassExists(dto.taxClassId);
        data.taxClass = { connect: { id: dto.taxClassId } };
      }
    }

    // Price re-validation: resolve the resulting base/sale and enforce the
    // sale<=base invariant against the *post-update* values.
    const nextBase =
      dto.basePrice !== undefined
        ? rupeesToPaise(dto.basePrice, 'basePrice')
        : existing.basePrice;
    if (dto.basePrice !== undefined) data.basePrice = nextBase;

    if (dto.salePrice !== undefined) {
      const nextSale =
        dto.salePrice === null
          ? null
          : rupeesToPaise(dto.salePrice, 'salePrice');
      if (nextSale !== null && nextSale > nextBase) {
        throw new BadRequestException('salePrice must not exceed basePrice');
      }
      data.salePrice = nextSale;
    } else if (dto.basePrice !== undefined && existing.salePrice !== null) {
      // Base changed but sale not supplied — ensure existing sale still valid.
      if (existing.salePrice > nextBase) {
        throw new BadRequestException(
          'New basePrice is below the existing salePrice; update or clear salePrice too',
        );
      }
    }

    if (dto.saleStartsAt !== undefined || dto.saleEndsAt !== undefined) {
      const { saleStartsAt, saleEndsAt } = this.parseSaleWindow(
        dto.saleStartsAt === undefined
          ? existing.saleStartsAt?.toISOString()
          : (dto.saleStartsAt ?? undefined),
        dto.saleEndsAt === undefined
          ? existing.saleEndsAt?.toISOString()
          : (dto.saleEndsAt ?? undefined),
      );
      data.saleStartsAt = saleStartsAt;
      data.saleEndsAt = saleEndsAt;
    }

    try {
      return await this.prisma.sku.update({ where: { id }, data });
    } catch (e) {
      throw this.mapSkuUniqueError(e);
    }
  }

  async addPriceTier(skuId: string, dto: CreatePriceTierDto) {
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId } });
    if (!sku) throw new NotFoundException('SKU not found');

    const unitPrice = rupeesToPaise(dto.unitPrice, 'unitPrice');
    try {
      return await this.prisma.priceTier.create({
        data: { skuId, minQty: dto.minQty, unitPrice },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `A price tier already exists for SKU at minQty=${dto.minQty}`,
        );
      }
      throw e;
    }
  }

  // ─── TAX CLASS ────────────────────────────────────────────

  async createTaxClass(dto: CreateTaxClassDto) {
    try {
      return await this.prisma.taxClass.create({
        data: {
          name: dto.name,
          type: dto.type,
          hsnCode: dto.hsnCode,
          cgstBps: dto.cgstBps ?? 0,
          sgstBps: dto.sgstBps ?? 0,
          igstBps: dto.igstBps ?? 0,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `A tax class named "${dto.name}" already exists`,
        );
      }
      throw e;
    }
  }

  async listTaxClasses() {
    return this.prisma.taxClass.findMany({ orderBy: { name: 'asc' } });
  }

  // ─── TABS + SECTIONS (full replace) ───────────────────────

  /**
   * Replace a product's entire ordered tab/section tree. Idempotent: deletes the
   * existing tabs (sections cascade) and recreates from the payload, applying the
   * payload order (or array index when sortOrder is omitted).
   */
  async upsertTabs(productId: string, dto: UpsertTabsDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.productTab.deleteMany({ where: { productId } });

      for (let ti = 0; ti < dto.tabs.length; ti++) {
        const tab = dto.tabs[ti];
        const createdTab = await tx.productTab.create({
          data: {
            productId,
            title: tab.title,
            sortOrder: tab.sortOrder ?? ti,
            isActive: tab.isActive ?? true,
          },
        });
        if (tab.sections.length > 0) {
          await tx.productTabSection.createMany({
            data: tab.sections.map((sec, si) => ({
              tabId: createdTab.id,
              type: sec.type,
              title: sec.title,
              // Defense-in-depth: RICH_TEXT html is sanitized server-side before
              // persistence so a stored payload can never carry <script> / event
              // handlers / javascript: URIs to the storefront. Structural shape
              // is already validated at the DTO layer.
              content: this.sanitizeSectionContent(
                sec.type,
                sec.content ?? {},
              ) as Prisma.InputJsonValue,
              sortOrder: sec.sortOrder ?? si,
            })),
          });
        }
      }

      return tx.productTab.findMany({
        where: { productId },
        orderBy: { sortOrder: 'asc' },
        include: { sections: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }

  // NOTE: DIY guide and ComponentBundle upserts are owned by the `diy` module
  // (architecture Section 4.12: POST /api/admin/store/products/:id/diy and
  // POST /api/admin/store/bundles). They were removed from catalog to preserve
  // single-responsibility and avoid a circular dependency (diy -> catalog).

  // ─── PRODUCT MEDIA (presign / confirm / list / delete) ────

  /**
   * Reserve a media cap slot and issue a presigned PUT URL. (Section 4.1 / 9)
   *
   * Cap enforcement is ROW-RESERVATION based to close the parallel-presign
   * oversell race: inside a transaction we acquire a per-(product,type) advisory
   * lock, count existing rows of that type where status IN (PENDING, CONFIRMED),
   * abort with 409 MEDIA_CAP_REACHED if the cap is reached, then INSERT a
   * `ProductMedia(status=PENDING)` row before issuing the URL. Eleven concurrent
   * presigns can therefore no longer all observe count=0. Orphan PENDING rows
   * (client abandons the PUT) are swept by the `store-media-gc` cron after the
   * presign-URL TTL, freeing the reserved slot.
   */
  async presignMedia(productId: string, dto: PresignMediaDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const { safeFileName, normalizedMimeType } = this.validateMediaUploadInput(
      dto.type,
      dto.fileName,
      dto.mimeType,
    );
    const cap = PRODUCT_MEDIA_CAP[dto.type];

    const media = await this.prisma.$transaction(async (tx) => {
      // Serialize cap checks for this (product,type) so concurrent presigns can
      // not both read a stale count (same advisory-lock idiom as payment/equity).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`product_media_${productId}_${dto.type}`}))`;

      const used = await tx.productMedia.count({
        where: {
          productId,
          type: dto.type,
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
      });
      if (used >= cap) {
        throw new ConflictException({
          code: 'MEDIA_CAP_REACHED',
          message: `Media cap reached for ${dto.type} (max ${cap}); confirm or delete an existing item first`,
        });
      }

      const s3Key = `store/products/${productId}/${uuidv4()}-${safeFileName}`;
      return tx.productMedia.create({
        data: {
          productId,
          type: dto.type,
          status: 'PENDING',
          s3Key,
          caption: dto.caption,
          altText: dto.altText,
          // Append after existing media by default.
          sortOrder: used,
        },
      });
    });

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: media.s3Key,
      ContentType: normalizedMimeType,
      // ContentType is signed; size is enforced authoritatively at confirm via
      // HeadObject (signing an exact ContentLength would break the client PUT).
    });
    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: MEDIA_PRESIGN_TTL_SECONDS,
    });

    return {
      mediaId: media.id,
      uploadUrl,
      key: media.s3Key,
      type: media.type,
      expiresIn: MEDIA_PRESIGN_TTL_SECONDS,
    };
  }

  /**
   * Confirm a reserved media upload: HeadObject reads the authoritative stored
   * size, the per-type byte cap is enforced, and the row flips PENDING→CONFIRMED.
   * On a size violation the PENDING row + S3 object are purged (freeing the cap
   * slot). (Section 4.1 / 9)
   */
  async confirmMedia(productId: string, dto: ConfirmMediaDto) {
    const media = await this.prisma.productMedia.findUnique({
      where: { id: dto.mediaId },
    });
    if (!media || media.productId !== productId) {
      throw new NotFoundException('Media not found');
    }
    if (media.status === 'CONFIRMED') {
      // Idempotent: already confirmed.
      return media;
    }

    // Authoritative size: read the actually-stored object size from S3. The
    // client-reported size is advisory-only (spoofable) and used as a fallback
    // when HeadObject can't be performed (e.g. no real S3 in local dev).
    let actualSize: number | undefined = dto.fileSize;
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: media.s3Key }),
      );
      if (typeof head.ContentLength === 'number') {
        actualSize = head.ContentLength;
      }
    } catch (e) {
      this.logger.warn(
        `HeadObject failed for ${media.s3Key}; using client-reported size: ${
          (e as Error)?.message
        }`,
      );
    }

    const maxBytes = MEDIA_MAX_BYTES[media.type];
    if (typeof actualSize === 'number' && actualSize > maxBytes) {
      // Oversized — purge the object + PENDING row so the cap slot is freed.
      await this.bestEffortDeleteObject(media.s3Key);
      await this.prisma.productMedia
        .delete({ where: { id: media.id } })
        .catch(() => undefined);
      throw new BadRequestException(
        `${media.type} exceeds the maximum allowed size of ${maxBytes} bytes`,
      );
    }

    return this.prisma.productMedia.update({
      where: { id: media.id },
      data: {
        status: 'CONFIRMED',
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  /** List a product's media; `confirmedOnly` filters to CONFIRMED rows. */
  async listMedia(productId: string, confirmedOnly?: boolean) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.prisma.productMedia.findMany({
      where: {
        productId,
        ...(confirmedOnly ? { status: 'CONFIRMED' } : {}),
      },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  /** Delete a media row (+ best-effort S3 purge); frees the reserved cap slot. */
  async deleteMedia(productId: string, mediaId: string) {
    const media = await this.prisma.productMedia.findUnique({
      where: { id: mediaId },
    });
    if (!media || media.productId !== productId) {
      throw new NotFoundException('Media not found');
    }
    await this.prisma.productMedia.delete({ where: { id: mediaId } });
    await this.bestEffortDeleteObject(media.s3Key);
    return { id: mediaId, deleted: true };
  }

  // ─── AVAILABILITY (read-only display) ─────────────────────

  /**
   * Aggregate available quantity across all warehouses for a SKU. Read-only —
   * never reveals per-warehouse reservation internals. (Inventory owns mutation.)
   */
  async getAvailability(skuId: string) {
    const sku = await this.prisma.sku.findUnique({
      where: { id: skuId },
      select: {
        id: true,
        isActive: true,
        product: { select: { status: true, type: true } },
      },
    });
    // Hide inventory for SKUs whose product is not publicly ACTIVE (or is a
    // DIGITAL, non-purchasable type): a deactivated/archived product's SKU must
    // not leak stock existence via the public availability endpoint.
    if (
      !sku ||
      !sku.isActive ||
      sku.product.status !== ProductStatus.ACTIVE ||
      sku.product.type === 'DIGITAL'
    ) {
      throw new NotFoundException('SKU not found');
    }

    const agg = await this.prisma.stockLevel.aggregate({
      where: { skuId },
      _sum: { onHand: true, reserved: true },
    });
    const onHand = agg._sum.onHand ?? 0;
    const reserved = agg._sum.reserved ?? 0;
    const available = Math.max(0, onHand - reserved);
    return { skuId, available, inStock: available > 0 };
  }

  // ─── INTERNAL HELPERS ─────────────────────────────────────

  /** Resolve a category's display name for the denormalized cache. */
  private async resolveCategoryName(
    categoryId?: string | null,
  ): Promise<string | null> {
    if (!categoryId) return null;
    const cat = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { name: true },
    });
    if (!cat) throw new BadRequestException('Category not found');
    return cat.name;
  }

  private async assertTaxClassExists(taxClassId: string): Promise<void> {
    const tc = await this.prisma.taxClass.findUnique({
      where: { id: taxClassId },
      select: { id: true },
    });
    if (!tc) throw new BadRequestException('Tax class not found');
  }

  /** Parse + validate an optional sale window (start < end if both present). */
  private parseSaleWindow(
    start?: string,
    end?: string,
  ): { saleStartsAt: Date | null; saleEndsAt: Date | null } {
    const saleStartsAt = start ? new Date(start) : null;
    const saleEndsAt = end ? new Date(end) : null;
    if (saleStartsAt && Number.isNaN(saleStartsAt.getTime())) {
      throw new BadRequestException('saleStartsAt is not a valid date');
    }
    if (saleEndsAt && Number.isNaN(saleEndsAt.getTime())) {
      throw new BadRequestException('saleEndsAt is not a valid date');
    }
    if (saleStartsAt && saleEndsAt && saleStartsAt >= saleEndsAt) {
      throw new BadRequestException('saleStartsAt must be before saleEndsAt');
    }
    return { saleStartsAt, saleEndsAt };
  }

  /** Map SKU unique violations (skuCode / barcode) to a 409 with a clear field. */
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
      return new ConflictException('A SKU with that skuCode already exists');
    }
    return e;
  }

  /**
   * Collect the set of category ids in the subtree rooted at `rootId` (incl.
   * root). Accepts an optional transaction client so the scan + the caller's
   * mutation are atomic (avoids the re-parent TOCTOU). A `take` cap bounds the
   * in-memory scan as a DoS guard on pathologically large category tables.
   */
  private async collectSubtreeIds(
    rootId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Set<string>> {
    const all = await client.category.findMany({
      select: { id: true, parentId: true },
      take: CATEGORY_SCAN_LIMIT,
    });
    const childrenByParent = new Map<string, string[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      const arr = childrenByParent.get(c.parentId);
      if (arr) arr.push(c.id);
      else childrenByParent.set(c.parentId, [c.id]);
    }
    const ids = new Set<string>([rootId]);
    const stack = [rootId];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of childrenByParent.get(cur) ?? []) {
        if (!ids.has(child)) {
          ids.add(child);
          stack.push(child);
        }
      }
    }
    return ids;
  }

  /**
   * Re-sync the denormalized Product.category for EVERY product under the entire
   * subtree rooted at `rootId` (incl. the root). Each product's cache is set to
   * the current name of the category it directly belongs to, so a rename or
   * re-parent never leaves a descendant category's products returning a stale
   * cache string to the listing filter. (Section 8.9)
   */
  private async resyncSubtreeProductCategory(
    tx: Prisma.TransactionClient,
    rootId: string,
  ): Promise<void> {
    const subtreeIds = await this.collectSubtreeIds(rootId, tx);
    await this.resyncProductCategoryForIds(tx, [...subtreeIds]);
  }

  /**
   * Set Product.category = (the product's own category name) for every product
   * whose categoryId is in `categoryIds`. A single set-based UPDATE…FROM keeps
   * this off the Node side regardless of subtree size. (Section 8.9)
   */
  private async resyncProductCategoryForIds(
    tx: Prisma.TransactionClient,
    categoryIds: string[],
  ): Promise<void> {
    if (categoryIds.length === 0) return;
    await tx.$executeRaw`
      UPDATE products AS p
      SET category = c.name
      FROM categories AS c
      WHERE p.category_id = c.id
        AND p.category_id IN (${Prisma.join(categoryIds)})
    `;
  }

  // ─── MEDIA HELPERS ────────────────────────────────────────

  /**
   * Validate the requested media MIME against the allowlist for `type` and ensure
   * the file-name extension matches. Returns a sanitized basename (no path
   * traversal) + the normalized MIME to sign/store. (Section 9 MIME allowlist.)
   */
  private validateMediaUploadInput(
    type: ProductMediaType,
    fileName: string,
    mimeType: string,
  ): { safeFileName: string; normalizedMimeType: string } {
    if (typeof fileName !== 'string' || typeof mimeType !== 'string') {
      throw new BadRequestException('fileName and mimeType are required');
    }
    const normalizedMimeType = mimeType.trim().toLowerCase();
    const allowed = ALLOWED_MEDIA_MIME[type][normalizedMimeType];
    if (!allowed) {
      throw new BadRequestException(`Unsupported ${type} type: ${mimeType}`);
    }
    // Strip any directory components to prevent path traversal in the S3 key.
    const baseName = fileName.replace(/^.*[\\/]/, '').trim();
    if (!baseName || baseName === '.' || baseName === '..') {
      throw new BadRequestException('Invalid file name');
    }
    const dotIndex = baseName.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === baseName.length - 1) {
      throw new BadRequestException('File name must include a valid extension');
    }
    const extension = baseName.slice(dotIndex + 1).toLowerCase();
    if (!allowed.includes(extension)) {
      throw new BadRequestException(
        `File extension ".${extension}" does not match the declared type ${normalizedMimeType}`,
      );
    }
    return { safeFileName: baseName, normalizedMimeType };
  }

  /** Best-effort S3 object delete; never throws (cleanup path). */
  private async bestEffortDeleteObject(key: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (e) {
      this.logger.warn(
        `Best-effort S3 delete failed for ${key}: ${(e as Error)?.message}`,
      );
    }
  }

  // ─── CONTENT SANITIZATION ─────────────────────────────────

  /**
   * Defense-in-depth sanitization of a tab-section content payload before it is
   * persisted (and later returned verbatim to the public storefront). Structural
   * shape is validated at the DTO layer; here we strip dangerous constructs:
   *   - RICH_TEXT: remove <script>/<style> blocks, dangerous URI-bearing /
   *     navigation elements, on*="" event handlers, and javascript:/data:/
   *     vbscript: URIs from the stored html.
   *   - MEDIA: re-assert every item.url is an https URL (drop the rest).
   * No external sanitizer dependency is assumed; this is a conservative strip.
   */
  private sanitizeSectionContent(
    type: string,
    content: Record<string, unknown>,
  ): Record<string, unknown> {
    if (type === 'RICH_TEXT' && typeof content.html === 'string') {
      return { ...content, html: this.sanitizeHtml(content.html) };
    }
    if (type === 'MEDIA' && Array.isArray(content.items)) {
      const items = content.items.filter(
        (it): it is Record<string, unknown> =>
          typeof it === 'object' &&
          it !== null &&
          this.isHttpsUrl((it as Record<string, unknown>).url),
      );
      return { ...content, items };
    }
    return content;
  }

  /**
   * Conservative, dependency-free HTML strip applied as DEFENSE-IN-DEPTH before a
   * RICH_TEXT payload is persisted (the only write path is AdminGuard-gated). It
   * is intentionally a denylist over a raw string — NOT a parsed-DOM allowlist —
   * so it cannot promise protection against every mutation-XSS vector; the real
   * boundary is that only an admin can write. It removes:
   *   - <script>/<style> blocks (paired and self-closing)
   *   - dangerous URI-bearing / navigation elements
   *     (iframe, object, embed, applet, form, base, link, meta) — paired tags
   *     are removed with their content, voids stripped — so an unsanitized
   *     `<object data=…>`, `<iframe src=…>`, `<base href=…>` etc. can't slip past
   *   - inline on* event handlers (quoted or unquoted)
   *   - javascript:/data:/vbscript: schemes in href/src — QUOTED or UNQUOTED,
   *     and after collapsing HTML entities / whitespace inside the scheme token
   *     (e.g. `&#106;avascript:`) so encoded bypasses are neutralised too.
   */
  private sanitizeHtml(html: string): string {
    let out = html
      // Paired script/style with their content.
      .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      // Self-closing / unpaired script/style.
      .replace(/<\s*(script|style)\b[^>]*\/?>/gi, '');

    // Dangerous URI-bearing / navigation elements. Remove paired forms with
    // their content first, then any remaining (self-closing / unclosed) opens.
    const dangerousTags = [
      'iframe',
      'object',
      'embed',
      'applet',
      'form',
      'base',
      'link',
      'meta',
    ];
    for (const tag of dangerousTags) {
      out = out
        .replace(
          new RegExp(`<\\s*${tag}\\b[^>]*>[\\s\\S]*?<\\s*/\\s*${tag}\\s*>`, 'gi'),
          '',
        )
        .replace(new RegExp(`<\\s*/?\\s*${tag}\\b[^>]*>`, 'gi'), '');
    }

    out = out
      // Inline event handlers: on*="..." / on*='...' / on*=value.
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      // Dangerous URI schemes in href/src (quoted or unquoted) — neutralise to '#'.
      .replace(
        /\b(href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
        (match: string, attr: string, rawValue: string) =>
          this.isDangerousUriValue(rawValue) ? `${attr}="#"` : match,
      );

    return out;
  }

  /**
   * True if an href/src attribute value (quoted or not) resolves to a dangerous
   * scheme (javascript:/data:/vbscript:) after stripping surrounding quotes and
   * collapsing HTML entities / whitespace that browsers tolerate inside the
   * scheme token (e.g. `java&#x0a;script:`).
   */
  private isDangerousUriValue(rawValue: string): boolean {
    let v = rawValue.trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    // Drop HTML entities, then any whitespace / ASCII control chars browsers
    // ignore inside the leading scheme token, then lowercase.
    const collapsed = v
      .replace(/&#x?[0-9a-f]+;?/gi, '')
      .replace(/&[a-z]+;/gi, '')
      .replace(/[\s\x00-\x1f\x7f]+/g, '')
      .toLowerCase();
    return /^(javascript|data|vbscript):/.test(collapsed);
  }

  private isHttpsUrl(v: unknown): boolean {
    if (typeof v !== 'string' || v.length > 2000) return false;
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }
}
