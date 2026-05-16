import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req,
} from '@nestjs/common';
import { EquityService } from './equity.service';
import { AdminGuard, JwtAuthGuard } from '../auth/guards';

@Controller()
export class EquityController {
  constructor(private readonly equityService: EquityService) {}

  // ─── ADMIN ENDPOINTS ──────────────────────────────────────

  @UseGuards(AdminGuard)
  @Get('admin/equity/stats')
  getStats() {
    return this.equityService.getAdminStats();
  }

  @UseGuards(AdminGuard)
  @Get('admin/equity/companies')
  listCompanies(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.equityService.listCompanies({
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(AdminGuard)
  @Get('admin/equity/companies/:id')
  getCompanyDetail(@Param('id') id: string) {
    return this.equityService.getCompanyDetail(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/equity/companies')
  createCompany(@Body() body: {
    teamId: string;
    companyName: string;
    sector?: string;
    description?: string;
    registrationNumber?: string;
    registeredAddress?: string;
    gstin?: string;
    panNumber?: string;
    notes?: string;
  }) {
    return this.equityService.createCompany(body);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/equity/companies/:id')
  updateCompany(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.equityService.updateCompany(id, body);
  }

  @UseGuards(AdminGuard)
  @Post('admin/equity/companies/:id/start-timer')
  startTimer(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const adminId = req.user.id || req.user.sub;
    return this.equityService.startTimer(id, adminId);
  }

  @UseGuards(AdminGuard)
  @Post('admin/equity/companies/:id/handover')
  executeHandover(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const adminId = req.user.id || req.user.sub;
    return this.equityService.executeHandover(id, adminId);
  }

  @UseGuards(AdminGuard)
  @Post('admin/equity/update-timers')
  updateTimers() {
    return this.equityService.updateTimers();
  }

  // ─── AGREEMENT ENDPOINTS ──────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/equity/agreements')
  createAgreement(@Body() body: {
    companyId: string;
    agreementType: string;
    title: string;
    equityPct?: number;
    duration?: number;
    terms?: any;
    notes?: string;
  }) {
    return this.equityService.createAgreement(body);
  }

  @UseGuards(AdminGuard)
  @Post('admin/equity/agreements/:id/sign-platform')
  signPlatform(
    @Param('id') id: string,
    @Body() body: { adminName: string },
  ) {
    return this.equityService.signAgreementPlatform(id, body.adminName);
  }

  /** Sign agreement as founder — requires JWT; identity derived from token */
  @UseGuards(JwtAuthGuard)
  @Post('equity/agreements/:id/sign-founder')
  signFounder(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const applicantId = req.user.id || req.user.sub;
    return this.equityService.signAgreementFounder(id, applicantId);
  }

  // ─── EQUITY EVENT ENDPOINT ────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/equity/events')
  recordEvent(@Body() body: {
    companyId: string;
    eventType: any;
    fromHolder?: string;
    toHolder?: string;
    percentageAmount: number;
    description: string;
    metadata?: any;
    triggeredBy?: string;
  }) {
    return this.equityService.recordEvent(body);
  }
}
