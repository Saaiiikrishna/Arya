import { Controller, Post, Get, Patch, Param, Body, Req, Res, UseGuards, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CoFounderService } from './cofounder.service';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CoFounderGuard } from './cofounder.guard';
import { setRefreshCookie } from '../auth/refresh-cookie';

@Controller('api')
export class CoFounderController {
  constructor(
    private readonly coFounderService: CoFounderService,
    private readonly config: ConfigService,
  ) {}

  // ─── Co-founder auth ──────────────────────────────────────
  // Refresh/logout reuse the shared /admin/auth/* endpoints (which resolve the
  // COFOUNDER role from the token), so login just needs to set the cookie.

  @Post('cofounder/login')
  async login(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.coFounderService.login(body.email, body.password);
    setRefreshCookie(res, result.refreshToken, this.config);
    return result;
  }

  // ─── Co-founder portal ────────────────────────────────────

  @UseGuards(CoFounderGuard)
  @Get('cofounder/team')
  getMyTeam(@Req() req: any) {
    return this.coFounderService.getMyTeam(req.user.id ?? req.user.sub);
  }

  @UseGuards(CoFounderGuard)
  @Post('cofounder/teams/:teamId/reports')
  submitWeeklyReport(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Body() body: { week: number; summary: string; blockers?: string; nextSteps?: string },
  ) {
    return this.coFounderService.submitWeeklyReport(req.user.id ?? req.user.sub, teamId, body);
  }

  @UseGuards(CoFounderGuard)
  @Post('cofounder/teams/:teamId/resource-requests')
  createResourceRequest(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Body() body: { type: string; description: string },
  ) {
    return this.coFounderService.createResourceRequest(req.user.id ?? req.user.sub, teamId, body);
  }

  @UseGuards(CoFounderGuard)
  @Get('cofounder/teams/:teamId/resource-requests')
  getResourceRequests(@Param('teamId') teamId: string, @Query('status') status?: string) {
    return this.coFounderService.getResourceRequests(teamId, status);
  }

  // ─── Admin: manage co-founders ────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/cofounders')
  createCoFounder(@Body() body: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    bio?: string;
  }) {
    return this.coFounderService.createCoFounder(body);
  }

  @UseGuards(AdminGuard)
  @Get('admin/cofounders')
  listCoFounders() {
    return this.coFounderService.listCoFounders();
  }

  @UseGuards(AdminGuard)
  @Post('admin/cofounders/:coFounderId/assign')
  assignToTeam(
    @Req() req: any,
    @Param('coFounderId') coFounderId: string,
    @Body() body: { teamId: string },
  ) {
    return this.coFounderService.assignToTeam(coFounderId, body.teamId, req.user.id ?? req.user.sub);
  }

  @UseGuards(AdminGuard)
  @Get('admin/cofounders/reports')
  getWeeklyReports(@Query('batchId') batchId?: string) {
    return this.coFounderService.getWeeklyReports(batchId);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/resource-requests/:reqId/fulfill')
  fulfillResourceRequest(
    @Req() req: any,
    @Param('reqId') reqId: string,
    @Body() body: { notes?: string },
  ) {
    return this.coFounderService.fulfillResourceRequest(reqId, req.user.id ?? req.user.sub, body.notes);
  }
}
