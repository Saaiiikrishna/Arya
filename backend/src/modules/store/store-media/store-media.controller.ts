import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../auth/guards';
import { StoreMediaService } from './store-media.service';
import { PresignMediaDto, ConfirmMediaDto } from './dto';

/**
 * Admin-only product media management. All routes are AdminGuard-protected and
 * mounted under /api/admin/store/products/:id/media per architecture Section 4.1.
 *
 * The controller prefix carries the full path so the route hierarchy matches the
 * rest of the codebase and the Section 4.1 inventory contract; this also keeps
 * these routes namespaced under `products/:id/media` so they cannot collide with
 * the catalog module's `products/:id/...` admin routes when both are aggregated
 * into the parent StoreModule.
 */
@Controller('api/admin/store/products')
export class StoreMediaController {
  constructor(private readonly storeMediaService: StoreMediaService) {}

  /**
   * Row-reservation cap check: inserts a ProductMedia(status=PENDING) row inside
   * the transaction, then issues the presigned URL. Returns 409 if the
   * (product, type) bucket is full.
   */
  @UseGuards(AdminGuard)
  @Post(':id/media/presign')
  async presign(@Param('id') productId: string, @Body() dto: PresignMediaDto) {
    return this.storeMediaService.presignProductMedia(
      productId,
      dto.type,
      dto.filename,
      dto.mime,
    );
  }

  /**
   * Confirms the upload: HeadObject size check, then flips PENDING -> CONFIRMED.
   * On a size violation the PENDING row + S3 object are purged.
   */
  @UseGuards(AdminGuard)
  @Post(':id/media/confirm')
  async confirm(@Param('id') productId: string, @Body() dto: ConfirmMediaDto) {
    return this.storeMediaService.confirmProductMedia(productId, dto);
  }

  /**
   * List a product's media. Admin-only operational surface; documented in
   * COMMERCE_ARCHITECTURE Section 4.1 alongside presign/confirm. `confirmedOnly`
   * filters to CONFIRMED rows for parity with public read paths.
   */
  @UseGuards(AdminGuard)
  @Get(':id/media')
  async list(
    @Param('id') productId: string,
    @Query('confirmedOnly') confirmedOnly?: string,
  ) {
    return this.storeMediaService.listProductMedia(
      productId,
      confirmedOnly === 'true',
    );
  }

  @UseGuards(AdminGuard)
  @Delete(':id/media/:mediaId')
  async remove(
    @Param('id') productId: string,
    @Param('mediaId') mediaId: string,
  ) {
    return this.storeMediaService.deleteProductMedia(productId, mediaId);
  }
}
