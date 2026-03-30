import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('api/admin/analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  async getOverview() {
    return this.analyticsService.getOverview();
  }

  @Get('batch/:batchId')
  async getBatchPerformance(@Param('batchId') batchId: string) {
    return this.analyticsService.getBatchPerformance(batchId);
  }

  @Get('rankings')
  async getTeamRankings(@Query('batchId') batchId?: string) {
    return this.analyticsService.getTeamRankings(batchId);
  }

  @Get('team/:teamId/report')
  async getTeamReport(@Param('teamId') teamId: string) {
    return this.analyticsService.getTeamReport(teamId);
  }
}
