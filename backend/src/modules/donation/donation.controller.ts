import { Controller, Post, Get, Body, Query, Headers, Req, UseGuards } from '@nestjs/common';
import { DonationService } from './donation.service';
import { AdminGuard } from '../auth/guards';

@Controller('api')
export class DonationController {
  constructor(private readonly donationService: DonationService) {}

  // ─── Public ────────────────────────────────────────

  @Post('support/create-order')
  async createOrder(@Body() data: any) {
    return this.donationService.createDonationOrder(data);
  }

  @Post('support/webhook')
  async webhook(
    @Headers('x-razorpay-signature') signature: string,
    @Req() req: any,
    @Body() body: any,
  ) {
    const rawBody: Buffer | undefined = req.rawBody;
    return this.donationService.handleWebhook(signature, rawBody ?? body);
  }

  @Get('support/stats')
  async getStats() {
    return this.donationService.getStats();
  }

  // ─── Admin ─────────────────────────────────────────

  @UseGuards(AdminGuard)
  @Get('admin/support')
  async getDonations(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.donationService.getDonations({
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      status,
    });
  }
}
