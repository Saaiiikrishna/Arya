import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { VisitorService } from './visitor.service';
import { AdminGuard } from '../auth/guards';

@Controller('api')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly visitorService: VisitorService,
  ) {}

  // ─── Public ───────────────────────────────────────────

  @Get('settings/public')
  async getPublicSettings() {
    return this.settingsService.getPublicSettings();
  }

  // ─── Admin: Settings ──────────────────────────────────

  @Get('admin/settings')
  @UseGuards(AdminGuard)
  async getAllSettings() {
    return this.settingsService.getAll();
  }

  /** Presign an S3 PUT for Homepage-CMS section media (admin only). */
  @Post('admin/settings/media-upload-url')
  @UseGuards(AdminGuard)
  async getMediaUploadUrl(@Body() body: { fileName: string; mimeType: string }) {
    return this.settingsService.getMediaUploadUrl(body.fileName, body.mimeType);
  }

  @Patch('admin/settings')
  @UseGuards(AdminGuard)
  async updateSettings(@Body() body: Record<string, string>) {
    await this.settingsService.bulkSet(body);
    return { success: true };
  }

  // ─── Admin: Visitor Analytics ─────────────────────────

  @Get('admin/settings/visitors/summary')
  @UseGuards(AdminGuard)
  async getVisitorSummary(@Query('days') days?: string) {
    return this.visitorService.getSummary(days ? parseInt(days, 10) : 30);
  }

  @Get('admin/settings/visitors/pageviews')
  @UseGuards(AdminGuard)
  async getVisitorPageViews(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('path') path?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
  ) {
    return this.visitorService.getPageViews({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      path,
      startDate,
      endDate,
      search,
    });
  }
}
