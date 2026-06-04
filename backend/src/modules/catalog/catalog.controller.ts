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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminGuard } from '../auth/guards';
import { VisitorService } from '../settings/visitor.service';
import { CatalogService } from './catalog.service';
import {
  CreateProductDto,
  UpdateProductDto,
  ProductQueryDto,
  CreateSkuDto,
  UpdateSkuDto,
  CreatePriceTierDto,
  CreateCategoryDto,
  UpdateCategoryDto,
  DeleteCategoryQueryDto,
  CreateTaxClassDto,
  UpsertTabsDto,
  PresignMediaDto,
  ConfirmMediaDto,
  MediaListQueryDto,
} from './dto';

@Controller('api')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly visitor: VisitorService,
  ) {}

  // ─── PUBLIC READ (no guard) ───────────────────────────────
  // Rate-limited to 30 req/min/IP so a crawler/scraper can't enumerate the full
  // catalog (and, on availability, real-time stock) at the global 100/min tier.

  @Throttle({ medium: { limit: 30, ttl: 60000 } })
  @Get('store/products')
  listProducts(@Query() query: ProductQueryDto) {
    return this.catalog.listPublicProducts(query);
  }

  @Throttle({ medium: { limit: 30, ttl: 60000 } })
  @Get('store/categories')
  getCategoryTree() {
    return this.catalog.getCategoryTree();
  }

  // Availability exposes real-time stock — stricter per-IP limit (competitor
  // monitoring deterrence).
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @Get('store/availability/:skuId')
  getAvailability(@Param('skuId', new ParseUUIDPipe()) skuId: string) {
    return this.catalog.getAvailability(skuId);
  }

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

  @UseGuards(AdminGuard)
  @Get('admin/store/products/:id')
  adminGetProduct(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.catalog.adminGetProduct(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/store/products')
  createProduct(@Body() dto: CreateProductDto) {
    return this.catalog.createProduct(dto);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/store/products/:id')
  updateProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(id, dto);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/store/products/:id')
  archiveProduct(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.catalog.archiveProduct(id);
  }

  // ─── ADMIN: SKUS + PRICE TIERS ────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/store/products/:id/skus')
  createSku(
    @Param('id', new ParseUUIDPipe()) productId: string,
    @Body() dto: CreateSkuDto,
  ) {
    return this.catalog.createSku(productId, dto);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/store/skus/:id')
  updateSku(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSkuDto,
  ) {
    return this.catalog.updateSku(id, dto);
  }

  @UseGuards(AdminGuard)
  @Post('admin/store/skus/:id/price-tiers')
  addPriceTier(
    @Param('id', new ParseUUIDPipe()) skuId: string,
    @Body() dto: CreatePriceTierDto,
  ) {
    return this.catalog.addPriceTier(skuId, dto);
  }

  // ─── ADMIN: PRODUCT MEDIA ─────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/store/products/:id/media/presign')
  presignMedia(
    @Param('id', new ParseUUIDPipe()) productId: string,
    @Body() dto: PresignMediaDto,
  ) {
    return this.catalog.presignMedia(productId, dto);
  }

  @UseGuards(AdminGuard)
  @Post('admin/store/products/:id/media/confirm')
  confirmMedia(
    @Param('id', new ParseUUIDPipe()) productId: string,
    @Body() dto: ConfirmMediaDto,
  ) {
    return this.catalog.confirmMedia(productId, dto);
  }

  @UseGuards(AdminGuard)
  @Get('admin/store/products/:id/media')
  listMedia(
    @Param('id', new ParseUUIDPipe()) productId: string,
    @Query() query: MediaListQueryDto,
  ) {
    return this.catalog.listMedia(productId, query.confirmedOnly);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/store/products/:id/media/:mediaId')
  deleteMedia(
    @Param('id', new ParseUUIDPipe()) productId: string,
    @Param('mediaId', new ParseUUIDPipe()) mediaId: string,
  ) {
    return this.catalog.deleteMedia(productId, mediaId);
  }

  // ─── ADMIN: TABS ──────────────────────────────────────────

  @UseGuards(AdminGuard)
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

  @UseGuards(AdminGuard)
  @Get('admin/store/categories')
  adminCategoryTree() {
    return this.catalog.getCategoryTree();
  }

  @UseGuards(AdminGuard)
  @Post('admin/store/categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(dto);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/store/categories/:id')
  updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(id, dto);
  }

  @UseGuards(AdminGuard)
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

  @UseGuards(AdminGuard)
  @Get('admin/store/tax-classes')
  listTaxClasses() {
    return this.catalog.listTaxClasses();
  }

  @UseGuards(AdminGuard)
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
