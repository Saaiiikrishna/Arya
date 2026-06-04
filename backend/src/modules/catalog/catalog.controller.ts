import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Body,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
  UseGuards,
  Injectable,
  SetMetadata,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminGuard } from '../auth/guards';
import { VisitorService } from '../settings/visitor.service';
import { CatalogService } from './catalog.service';
import {
  CreateProductDto,
  UpdateProductDto,
  ProductQueryDto,
  AdminProductQueryDto,
  CreateSkuDto,
  UpdateSkuDto,
  CreatePriceTierDto,
  SkuSearchQueryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
  DeleteCategoryQueryDto,
  CreateTaxClassDto,
  UpsertTabsDto,
  PresignMediaDto,
  ConfirmMediaDto,
  MediaListQueryDto,
} from './dto';

/**
 * Metadata key + decorator that opts a single route OUT of the class-level
 * {@link CatalogAdminGuard}. Routes are admin-gated by DEFAULT (secure default);
 * the unauthenticated public reads must explicitly mark themselves `@Public()`,
 * so a NEW method added without thought inherits the guard rather than silently
 * becoming public. Scoped to this controller's file lane.
 */
const CATALOG_PUBLIC_KEY = 'catalog:isPublic';
const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(CATALOG_PUBLIC_KEY, true);

/**
 * Class-level guard for {@link CatalogController}: applies {@link AdminGuard} to
 * every route UNLESS the handler is annotated `@Public()`. This makes the
 * admin-gate the default and the public reads the explicit exception — closing
 * the fragility the review flagged (a new method added between the public block
 * and an admin block could otherwise silently ship guard-free). The convention
 * (CLAUDE.md: "AdminGuard at controller level") is now honored.
 */
@Injectable()
export class CatalogAdminGuard extends AdminGuard {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      CATALOG_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

@UseGuards(CatalogAdminGuard)
@Controller('api')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly visitor: VisitorService,
  ) {}

  // ─── PUBLIC READ (@Public — opted OUT of the class-level admin guard) ──────
  // Rate-limited to 30 req/min/IP so a crawler/scraper can't enumerate the full
  // catalog (and, on availability, real-time stock) at the global 100/min tier.

  @Public()
  @Throttle({ medium: { limit: 30, ttl: 60000 } })
  @Get('store/products')
  listProducts(@Query() query: ProductQueryDto) {
    return this.catalog.listPublicProducts(query);
  }

  @Public()
  @Throttle({ medium: { limit: 30, ttl: 60000 } })
  @Get('store/categories')
  getCategoryTree() {
    return this.catalog.getCategoryTree();
  }

  // Availability exposes real-time stock — stricter per-IP limit (competitor
  // monitoring deterrence).
  @Public()
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @Get('store/availability/:skuId')
  getAvailability(@Param('skuId', new ParseUUIDPipe()) skuId: string) {
    return this.catalog.getAvailability(skuId);
  }

  @Public()
  @Throttle({ medium: { limit: 30, ttl: 60000 } })
  @Get('store/products/:slug')
  async getProduct(@Param('slug') slug: string, @Req() req: Request) {
    const product = await this.catalog.getPublicProductBySlug(slug);
    // Best-effort page-view tracking (enqueued; never blocks the response). The
    // batched Product.viewCount increment is owned by store-jobs (Section 8.12).
    this.trackView(req, `/store/products/${slug}`);
    return product;
  }

  // NOTE: GET /api/store/products/:slug/build is owned by the `diy` module
  // (architecture Section 4.12), not catalog — removed here.

  // ─── ADMIN: PRODUCTS ──────────────────────────────────────

  // Admin product LIST — ALL statuses (DRAFT/ACTIVE/ARCHIVED), unlike the public
  // GET /store/products (ACTIVE-only). Standard (medium) admin throttle tier.
  // AdminGuard is applied at the class level (CatalogAdminGuard); these routes
  // need no per-method guard — only the public reads above opt out via @Public().
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  @Get('admin/store/products')
  adminListProducts(@Query() query: AdminProductQueryDto) {
    return this.catalog.adminListProducts(query);
  }

  @Get('admin/store/products/:id')
  adminGetProduct(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.catalog.adminGetProduct(id);
  }

  @Post('admin/store/products')
  createProduct(@Body() dto: CreateProductDto) {
    return this.catalog.createProduct(dto);
  }

  @Patch('admin/store/products/:id')
  updateProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(id, dto);
  }

  @Delete('admin/store/products/:id')
  archiveProduct(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.catalog.archiveProduct(id);
  }

  // ─── ADMIN: SKUS + PRICE TIERS ────────────────────────────

  // SKU typeahead for the admin SkuPicker (replaces raw SKU-UUID text inputs in
  // the inventory + purchasing forms). AdminGuard is applied at the class level
  // (CatalogAdminGuard); standard (medium) admin throttle tier. Returns a
  // lightweight projection { id, skuCode, name, productName }.
  @Throttle({ medium: { limit: 100, ttl: 60000 } })
  @Get('admin/store/skus')
  adminSearchSkus(@Query() query: SkuSearchQueryDto) {
    return this.catalog.adminSearchSkus(query.search, query.limit);
  }

  @Post('admin/store/products/:id/skus')
  createSku(
    @Param('id', new ParseUUIDPipe()) productId: string,
    @Body() dto: CreateSkuDto,
  ) {
    return this.catalog.createSku(productId, dto);
  }

  @Patch('admin/store/skus/:id')
  updateSku(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSkuDto,
  ) {
    return this.catalog.updateSku(id, dto);
  }

  @Post('admin/store/skus/:id/price-tiers')
  addPriceTier(
    @Param('id', new ParseUUIDPipe()) skuId: string,
    @Body() dto: CreatePriceTierDto,
  ) {
    return this.catalog.addPriceTier(skuId, dto);
  }

  // ─── ADMIN: PRODUCT MEDIA ─────────────────────────────────

  @Post('admin/store/products/:id/media/presign')
  presignMedia(
    @Param('id', new ParseUUIDPipe()) productId: string,
    @Body() dto: PresignMediaDto,
  ) {
    return this.catalog.presignMedia(productId, dto);
  }

  @Post('admin/store/products/:id/media/confirm')
  confirmMedia(
    @Param('id', new ParseUUIDPipe()) productId: string,
    @Body() dto: ConfirmMediaDto,
  ) {
    return this.catalog.confirmMedia(productId, dto);
  }

  @Get('admin/store/products/:id/media')
  listMedia(
    @Param('id', new ParseUUIDPipe()) productId: string,
    @Query() query: MediaListQueryDto,
  ) {
    return this.catalog.listMedia(productId, query.confirmedOnly);
  }

  @Delete('admin/store/products/:id/media/:mediaId')
  deleteMedia(
    @Param('id', new ParseUUIDPipe()) productId: string,
    @Param('mediaId', new ParseUUIDPipe()) mediaId: string,
  ) {
    return this.catalog.deleteMedia(productId, mediaId);
  }

  // ─── ADMIN: TABS ──────────────────────────────────────────

  @Put('admin/store/products/:id/tabs')
  upsertTabs(
    @Param('id', new ParseUUIDPipe()) productId: string,
    @Body() dto: UpsertTabsDto,
  ) {
    return this.catalog.upsertTabs(productId, dto);
  }

  // NOTE: DIY-guide and bundle upserts (POST /api/admin/store/products/:id/diy,
  // POST /api/admin/store/bundles) are owned by the `diy` module
  // (architecture Section 4.12) — removed here.

  // ─── ADMIN: CATEGORIES ────────────────────────────────────

  @Get('admin/store/categories')
  adminCategoryTree() {
    return this.catalog.getCategoryTree();
  }

  @Post('admin/store/categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(dto);
  }

  @Patch('admin/store/categories/:id')
  updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(id, dto);
  }

  @Delete('admin/store/categories/:id')
  deleteCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: DeleteCategoryQueryDto,
  ) {
    // Read confirm via the validated DTO (runs the global ValidationPipe) rather
    // than an unvalidated raw query string.
    return this.catalog.deleteCategory(id, query.confirm === true);
  }

  // ─── ADMIN: TAX CLASSES ───────────────────────────────────

  @Get('admin/store/tax-classes')
  listTaxClasses() {
    return this.catalog.listTaxClasses();
  }

  @Post('admin/store/tax-classes')
  createTaxClass(@Body() dto: CreateTaxClassDto) {
    return this.catalog.createTaxClass(dto);
  }

  // ─── INTERNAL ─────────────────────────────────────────────

  /**
   * Fire-and-forget page-view tracking; swallows all errors.
   *
   * IP is taken solely from `req.ip` / the socket remote address — the raw
   * `X-Forwarded-For` header is intentionally NOT read here: Express is not
   * configured with `trust proxy`, so an unauthenticated client could otherwise
   * spoof any source IP into the visitor analytics. If forwarded-IP support is
   * needed, configure `app.set('trust proxy', <hops>)` in main.ts and `req.ip`
   * will then reflect the trusted hop only.
   */
  private trackView(req: Request, path: string): void {
    try {
      const headers: import('http').IncomingHttpHeaders = req.headers;
      const headerStr = (name: string): string | undefined => {
        const v: string | string[] | undefined = headers[name];
        return Array.isArray(v) ? v[0] : v;
      };
      // Session id comes from the X-Session-Id header the storefront sends
      // (same convention as the existing TrackingController). No cookie parser
      // is wired on these public routes.
      const sessionId: string = headerStr('x-session-id') ?? 'anonymous';
      void this.visitor
        .trackPageView({
          sessionId,
          path,
          referrer: headerStr('referer') ?? headerStr('referrer'),
          ip: req.ip ?? req.socket?.remoteAddress,
          userAgent: headerStr('user-agent'),
        })
        .catch(() => undefined);
    } catch {
      /* tracking must never affect the response */
    }
  }
}
