import {
  Controller, Get, Post, Patch, Param, Body, UseGuards, Query,
} from '@nestjs/common';
import { InvestorService } from './investor.service';
import { JwtAuthGuard, AdminGuard, InvestorGuard } from '../auth/guards';

@Controller('api')
export class InvestorController {
  constructor(private readonly investorService: InvestorService) {}

  // ─── Public ────────────────────────────────────────

  @Post('investors/register')
  async register(@Body() data: any) {
    return this.investorService.register(data);
  }

  @Get('investors/showcases')
  async publicShowcases(@Query('category') category?: string) {
    return this.investorService.getPublicShowcases(category);
  }

  @Get('investors/showcases/:id')
  async getShowcase(@Param('id') id: string) {
    return this.investorService.getShowcaseById(id);
  }

  // ─── Investor Authenticated ────────────────────────

  @UseGuards(InvestorGuard)
  @Get('investors/:id')
  async getInvestor(@Param('id') id: string) {
    return this.investorService.findById(id);
  }

  @UseGuards(InvestorGuard)
  @Post('investors/:investorId/meeting-request')
  async requestMeeting(
    @Param('investorId') investorId: string,
    @Body('showcaseId') showcaseId: string,
    @Body('message') message?: string,
  ) {
    return this.investorService.requestMeeting(investorId, showcaseId, message);
  }

  // ─── Admin ─────────────────────────────────────────

  @UseGuards(AdminGuard)
  @Get('admin/investors')
  async findAll(@Query('isApproved') isApproved?: string) {
    return this.investorService.findAll({
      isApproved: isApproved ? isApproved === 'true' : undefined,
    });
  }

  @UseGuards(AdminGuard)
  @Patch('admin/investors/:id/approve')
  async approve(@Param('id') id: string) {
    return this.investorService.approve(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/showcases')
  async createShowcase(@Body() data: any) {
    return this.investorService.createShowcase(data);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/showcases/:id')
  async updateShowcase(@Param('id') id: string, @Body() data: any) {
    return this.investorService.updateShowcase(id, data);
  }

  @UseGuards(AdminGuard)
  @Get('admin/meeting-requests')
  async getMeetingRequests(
    @Query('showcaseId') showcaseId?: string,
    @Query('investorId') investorId?: string,
  ) {
    return this.investorService.getMeetingRequests(showcaseId, investorId);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/meeting-requests/:id/status')
  async updateMeetingStatus(
    @Param('id') id: string,
    @Body('status') status: 'ACCEPTED' | 'DECLINED' | 'COMPLETED',
    @Body('scheduledAt') scheduledAt?: string,
  ) {
    return this.investorService.updateMeetingStatus(
      id, status, scheduledAt ? new Date(scheduledAt) : undefined,
    );
  }

  // ─── Admin: Pitch Events ───────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/pitch/events')
  async createPitchEvent(@Body() body: { teamId: string; scheduledAt: string; venue?: string; notes?: string }) {
    return this.investorService.createPitchEvent(body);
  }

  @UseGuards(AdminGuard)
  @Get('admin/pitch/events')
  async listPitchEvents(@Query('teamId') teamId?: string, @Query('batchId') batchId?: string) {
    return this.investorService.listPitchEvents(teamId, batchId);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/pitch/events/:id/status')
  async updatePitchEventStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.investorService.updatePitchEventStatus(id, status);
  }

  @UseGuards(AdminGuard)
  @Post('admin/pitch/events/:id/interest')
  async recordInterest(
    @Param('id') pitchEventId: string,
    @Body() body: { investorId: string; status: string; notes?: string },
  ) {
    return this.investorService.recordInvestorInterest(pitchEventId, body);
  }

  @UseGuards(AdminGuard)
  @Post('admin/pitch/events/:id/funding')
  async recordFunding(
    @Param('id') pitchEventId: string,
    @Body() body: { investorId: string; outcome: string; amount?: number; terms?: any; notes?: string },
  ) {
    return this.investorService.recordFundingDecision(pitchEventId, body);
  }
}
