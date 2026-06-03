import {
  Controller, Get, Post, Patch, Param, Body, UseGuards, Query,
} from '@nestjs/common';
import { InvestorService } from './investor.service';
import { JwtAuthGuard, AdminGuard } from '../auth/guards';
import { CreateInvestorDto } from './dto/create-investor.dto';

@Controller('api')
export class InvestorController {
  constructor(private readonly investorService: InvestorService) {}

  // ─── Public ────────────────────────────────────────

  @Post('investors/register')
  async register(@Body() data: CreateInvestorDto) {
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

  // Admin-only: exposes full investor record (PII). Do not relax to JwtAuthGuard.
  @UseGuards(AdminGuard)
  @Get('investors/:id')
  async getInvestor(@Param('id') id: string) {
    return this.investorService.findById(id);
  }

  @UseGuards(JwtAuthGuard)
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
}
