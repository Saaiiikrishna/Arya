import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ReferralService } from './referral.service';
import { JwtAuthGuard, AdminGuard } from '../auth/guards';

@Controller()
@UseGuards(ThrottlerGuard)
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  // ─── Public endpoints ────────────────────────────────

  @Post('referrals/verify')
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  async verifyReferrer(@Body('query') query: string) {
    return this.referralService.verifyReferrer(query);
  }

  @Post('referrals/set')
  async setReferrer(
    @Body('applicantId') applicantId: string,
    @Body('referrerId') referrerId: string,
  ) {
    return this.referralService.setReferrer(applicantId, referrerId);
  }

  // ─── Authenticated applicant endpoints ────────────────

  @UseGuards(JwtAuthGuard)
  @Post('referrals/enable-affiliate')
  async enableAffiliate(@Body('applicantId') applicantId: string) {
    return this.referralService.enableAffiliate(applicantId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('referrals/my-profile/:applicantId')
  async getMyReferralProfile(@Param('applicantId') applicantId: string) {
    return this.referralService.getMyReferralProfile(applicantId);
  }

  // ─── Admin endpoints ────────────────────────────────

  @UseGuards(AdminGuard)
  @Get('admin/referrals/stats')
  async getAdminReferralStats() {
    return this.referralService.getAdminReferralStats();
  }

  @UseGuards(AdminGuard)
  @Get('admin/referrals')
  async getAllReferrals(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.referralService.getAllReferrals({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      search,
    });
  }

  @UseGuards(AdminGuard)
  @Get('admin/referrals/affiliate/:applicantId')
  async getAffiliateDetail(@Param('applicantId') applicantId: string) {
    return this.referralService.getAffiliateDetail(applicantId);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/referrals/affiliate/:applicantId/toggle')
  async toggleAffiliateStatus(
    @Param('applicantId') applicantId: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.referralService.toggleAffiliateStatus(applicantId, isActive);
  }
}
