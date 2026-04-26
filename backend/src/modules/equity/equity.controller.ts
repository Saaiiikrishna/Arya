import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { EquityService } from './equity.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller()
export class EquityController {
  constructor(private readonly equityService: EquityService) {}

  // ─── ADMIN ENDPOINTS ──────────────────────────────────────

  /** Get equity dashboard stats */
  @UseGuards(JwtAuthGuard)
  @Get('admin/equity/stats')
  getStats() {
    return this.equityService.getAdminStats();
  }

  /** List all company entities */
  @UseGuards(JwtAuthGuard)
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

  /** Get full company detail with equity breakdown */
  @UseGuards(JwtAuthGuard)
  @Get('admin/equity/companies/:id')
  getCompanyDetail(@Param('id') id: string) {
    return this.equityService.getCompanyDetail(id);
  }

  /** Create a new company entity for a team */
  @UseGuards(JwtAuthGuard)
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

  /** Update company details */
  @UseGuards(JwtAuthGuard)
  @Patch('admin/equity/companies/:id')
  updateCompany(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.equityService.updateCompany(id, body);
  }

  /** Start the 1000-day equity timer */
  @UseGuards(JwtAuthGuard)
  @Post('admin/equity/companies/:id/start-timer')
  startTimer(
    @Param('id') id: string,
    @Body() body: { adminId?: string },
  ) {
    return this.equityService.startTimer(id, body.adminId);
  }

  /** Execute equity handover (transfer platform stake to founders) */
  @UseGuards(JwtAuthGuard)
  @Post('admin/equity/companies/:id/handover')
  executeHandover(
    @Param('id') id: string,
    @Body() body: { adminId?: string },
  ) {
    return this.equityService.executeHandover(id, body.adminId);
  }

  /** Update timers for all active companies (cron / manual trigger) */
  @UseGuards(JwtAuthGuard)
  @Post('admin/equity/update-timers')
  updateTimers() {
    return this.equityService.updateTimers();
  }

  // ─── AGREEMENT ENDPOINTS ──────────────────────────────────

  /** Create a new equity agreement */
  @UseGuards(JwtAuthGuard)
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

  /** Sign agreement as platform */
  @UseGuards(JwtAuthGuard)
  @Post('admin/equity/agreements/:id/sign-platform')
  signPlatform(
    @Param('id') id: string,
    @Body() body: { adminName: string },
  ) {
    return this.equityService.signAgreementPlatform(id, body.adminName);
  }

  /** Sign agreement as founder */
  @Post('equity/agreements/:id/sign-founder')
  signFounder(
    @Param('id') id: string,
    @Body() body: { applicantId: string },
  ) {
    return this.equityService.signAgreementFounder(id, body.applicantId);
  }

  // ─── EQUITY EVENT ENDPOINT ────────────────────────────────

  /** Record a custom equity event */
  @UseGuards(JwtAuthGuard)
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
