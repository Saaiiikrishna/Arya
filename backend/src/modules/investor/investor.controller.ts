import {
  Controller, Get, Post, Patch, Param, Body, UseGuards, Query, Req,
} from '@nestjs/common';
import { InvestorService } from './investor.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard, AdminGuard, InvestorGuard } from '../auth/guards';
import { CreateInvestorDto } from './dto/create-investor.dto';

@Controller('api')
export class InvestorController {
  constructor(
    private readonly investorService: InvestorService,
    private readonly authService: AuthService,
  ) {}

  // ─── Public ────────────────────────────────────────

  @Post('investors/register')
  async register(@Body() data: CreateInvestorDto) {
    return this.investorService.register(data);
  }

  // Investor email+password login → JWT with role INVESTOR (issued only once approved).
  @Post('investors/login')
  async login(@Body('email') email: string, @Body('password') password: string) {
    return this.authService.investorLogin(email, password);
  }

  @Get('investors/showcases')
  async publicShowcases(@Query('category') category?: string) {
    return this.investorService.getPublicShowcases(category);
  }

  @Get('investors/showcases/:id')
  async getShowcase(@Param('id') id: string) {
    return this.investorService.getShowcaseById(id);
  }

  // ─── Investor Authenticated (role INVESTOR) ─────────

  @UseGuards(InvestorGuard)
  @Get('investors/me')
  async me(@Req() req: any) {
    return this.investorService.findById(req.user.id || req.user.sub);
  }

  // Meeting request: the investor identity comes from the JWT, never a path
  // param — an investor can only request meetings as themselves.
  @UseGuards(InvestorGuard)
  @Post('investors/meeting-request')
  async requestMeeting(
    @Req() req: any,
    @Body('showcaseId') showcaseId: string,
    @Body('message') message?: string,
  ) {
    return this.investorService.requestMeeting(req.user.id || req.user.sub, showcaseId, message);
  }

  @UseGuards(InvestorGuard)
  @Get('investors/me/meeting-requests')
  async myMeetingRequests(@Req() req: any) {
    return this.investorService.getMyMeetingRequests(req.user.id || req.user.sub);
  }

  // ─── Admin ─────────────────────────────────────────

  // Admin-only: exposes full investor record (PII). Do not relax.
  @UseGuards(AdminGuard)
  @Get('admin/investors/:id')
  async getInvestor(@Param('id') id: string) {
    return this.investorService.findById(id);
  }

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
