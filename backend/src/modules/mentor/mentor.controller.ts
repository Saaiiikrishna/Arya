import { Controller, Post, Get, Patch, Param, Body, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { MentorService } from './mentor.service';
import { AdminGuard } from '../auth/guards/admin.guard';
import { MentorGuard } from './mentor.guard';
import { setRefreshCookie } from '../auth/refresh-cookie';

@Controller('api')
export class MentorController {
  constructor(
    private readonly mentorService: MentorService,
    private readonly config: ConfigService,
  ) {}

  // ─── Mentor auth ──────────────────────────────────────────
  // Refresh/logout reuse the shared /admin/auth/* endpoints (which resolve the
  // MENTOR role from the token), so login just needs to set the cookie.

  @Post('mentor/login')
  async login(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.mentorService.login(body.email, body.password);
    setRefreshCookie(res, result.refreshToken, this.config);
    return result;
  }

  // ─── Mentor portal ────────────────────────────────────────

  @UseGuards(MentorGuard)
  @Get('mentor/teams')
  getMyTeams(@Req() req: any) {
    return this.mentorService.getMyTeams(req.user.id ?? req.user.sub);
  }

  @UseGuards(MentorGuard)
  @Get('mentor/requests')
  getPendingRequests(@Req() req: any) {
    return this.mentorService.getPendingRequests(req.user.id ?? req.user.sub);
  }

  @UseGuards(MentorGuard)
  @Patch('mentor/requests/:reqId')
  reviewRequest(
    @Req() req: any,
    @Param('reqId') reqId: string,
    @Body() body: { status: 'APPROVED' | 'REJECTED' },
  ) {
    return this.mentorService.reviewRequest(req.user.id ?? req.user.sub, reqId, body.status);
  }

  // ─── Admin: manage mentors ────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/mentors')
  createMentor(@Body() body: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    expertise?: string[];
    bio?: string;
  }) {
    return this.mentorService.createMentor(body);
  }

  @UseGuards(AdminGuard)
  @Get('admin/mentors')
  listMentors() {
    return this.mentorService.listMentors();
  }

  @UseGuards(AdminGuard)
  @Get('admin/mentors/:id')
  getMentor(@Param('id') id: string) {
    return this.mentorService.getMentor(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/mentors/:mentorId/assign')
  assignToTeam(
    @Req() req: any,
    @Param('mentorId') mentorId: string,
    @Body() body: { teamId: string },
  ) {
    return this.mentorService.assignToTeam(mentorId, body.teamId, req.user.id ?? req.user.sub);
  }
}
