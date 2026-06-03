import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req,
  BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { EquityService } from './equity.service';
import { AdminGuard, JwtAuthGuard, SuperAdminGuard } from '../auth/guards';

@Controller('api')
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

  /**
   * Transfer the platform's controlling 51% to the founders. This is an
   * irreversible danger-zone action, so it is SuperAdminGuard-protected, the
   * super-admin role is re-verified here as defence-in-depth, and the caller
   * must send an explicit confirmation flag in the body.
   */
  @UseGuards(SuperAdminGuard)
  @Post('admin/equity/companies/:id/handover')
  executeHandover(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { confirm?: boolean },
  ) {
    // Defence-in-depth: re-verify SUPER_ADMIN even though the guard already did,
    // so a misconfiguration of the guard cannot let a lesser role transfer 51%.
    if (!req.user || req.user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Super admin access required to execute a handover');
    }
    const adminId = req.user.id || req.user.sub;
    if (!adminId) {
      throw new ForbiddenException('Authenticated super-admin actor required');
    }
    return this.equityService.executeHandover(id, adminId, body?.confirm === true);
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
    @Req() req: any,
  ) {
    const admin = req.user;
    const adminName = [admin.firstName, admin.lastName].filter(Boolean).join(' ').trim() || admin.email;
    return this.equityService.signAgreementPlatform(id, adminName);
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

  // ─── VESTING ENDPOINTS ────────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/equity/companies/:id/recompute-vesting')
  recomputeVesting(@Param('id') id: string) {
    return this.equityService.computeVesting(id);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/equity/holders/:holderId/vesting')
  setHolderVesting(
    @Param('holderId') holderId: string,
    @Req() req: any,
    @Body() body: { vestedPct?: number },
  ) {
    const vestedPct = body?.vestedPct;
    if (typeof vestedPct !== 'number' || !Number.isFinite(vestedPct)) {
      throw new BadRequestException('vestedPct must be a number');
    }
    const triggeredBy = req.user.id || req.user.sub;
    return this.equityService.setHolderVesting(holderId, vestedPct, triggeredBy);
  }

  // ─── EQUITY EVENT ENDPOINT ────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/equity/events')
  recordEvent(
    @Req() req: any,
    @Body() body: {
      companyId: string;
      eventType: any;
      fromHolder?: string;
      toHolder?: string;
      fromHolderId?: string;
      toHolderId?: string;
      percentageAmount: number;
      description: string;
      metadata?: any;
    },
  ) {
    // The audit actor is pinned to the JWT and passed as a trusted, separate
    // argument. Any triggeredBy on the request body is ignored by the service.
    const triggeredBy = req.user.id || req.user.sub;
    return this.equityService.recordEvent(body, triggeredBy);
  }
}
