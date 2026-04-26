import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ReferralService } from './referral.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller()
@UseGuards(ThrottlerGuard)
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  // ─── Public endpoints ────────────────────────────────

  /**
   * Verify a referrer by code, email, or phone.
   * Used by the application form to display referrer name.
   */
  @Post('referrals/verify')
  @Throttle({ short: { limit: 5, ttl: 60000 } }) // Max 5 verification attempts per minute
  async verifyReferrer(@Body('query') query: string) {
    return this.referralService.verifyReferrer(query);
  }

  /**
   * Set referrer on an applicant.
   */
  @Post('referrals/set')
  async setReferrer(
    @Body('applicantId') applicantId: string,
    @Body('referrerId') referrerId: string,
  ) {
    return this.referralService.setReferrer(applicantId, referrerId);
  }

  // ─── Authenticated applicant endpoints ────────────────

  /**
   * Enable affiliate mode for the logged-in applicant.
   */
  @UseGuards(JwtAuthGuard)
  @Post('referrals/enable-affiliate')
  async enableAffiliate(@Body('applicantId') applicantId: string) {
    return this.referralService.enableAffiliate(applicantId);
  }

  /**
   * Get own referral profile + list of people I referred.
   */
  @UseGuards(JwtAuthGuard)
  @Get('referrals/my-profile/:applicantId')
  async getMyReferralProfile(@Param('applicantId') applicantId: string) {
    return this.referralService.getMyReferralProfile(applicantId);
  }

  // ─── Admin endpoints ────────────────────────────────

  /**
   * Get referral dashboard stats (admin).
   */
  @UseGuards(JwtAuthGuard)
  @Get('admin/referrals/stats')
  async getAdminReferralStats() {
    return this.referralService.getAdminReferralStats();
  }

  /**
   * Get all referred applicants with pagination (admin).
   */
  @UseGuards(JwtAuthGuard)
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

  /**
   * Get detail for a specific affiliate (admin).
   */
  @UseGuards(JwtAuthGuard)
  @Get('admin/referrals/affiliate/:applicantId')
  async getAffiliateDetail(@Param('applicantId') applicantId: string) {
    return this.referralService.getAffiliateDetail(applicantId);
  }

  /**
   * Toggle affiliate active status (admin).
   */
  @UseGuards(JwtAuthGuard)
  @Patch('admin/referrals/affiliate/:applicantId/toggle')
  async toggleAffiliateStatus(
    @Param('applicantId') applicantId: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.referralService.toggleAffiliateStatus(applicantId, isActive);
  }
}
