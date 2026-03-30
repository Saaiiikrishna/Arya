import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { VisitorService } from './visitor.service';
import { JwtAuthGuard } from '../auth/guards';

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
  @UseGuards(JwtAuthGuard)
  async getAllSettings() {
    return this.settingsService.getAll();
  }

  @Patch('admin/settings')
  @UseGuards(JwtAuthGuard)
  async updateSettings(@Body() body: Record<string, string>) {
    await this.settingsService.bulkSet(body);
    return { success: true };
  }

  // ─── Admin: Visitor Analytics ─────────────────────────

  @Get('admin/settings/visitors/summary')
  @UseGuards(JwtAuthGuard)
  async getVisitorSummary(@Query('days') days?: string) {
    return this.visitorService.getSummary(days ? parseInt(days, 10) : 30);
  }

  @Get('admin/settings/visitors/pageviews')
  @UseGuards(JwtAuthGuard)
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
