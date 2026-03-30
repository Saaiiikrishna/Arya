import { Controller, Post, Get, Body, Query, Headers, UseGuards } from '@nestjs/common';
import { DonationService } from './donation.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('api')
export class DonationController {
  constructor(private readonly donationService: DonationService) {}

  // ─── Public ────────────────────────────────────────

  @Post('donations/create-order')
  async createOrder(@Body() data: any) {
    return this.donationService.createDonationOrder(data);
  }

  @Post('donations/webhook')
  async webhook(
    @Headers('x-razorpay-signature') signature: string,
    @Body() body: any,
  ) {
    return this.donationService.handleWebhook(signature, body);
  }

  @Get('donations/stats')
  async getStats() {
    return this.donationService.getStats();
  }

  // ─── Admin ─────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('admin/donations')
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
