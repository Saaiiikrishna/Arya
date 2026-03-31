import { Controller, Post, Body, UseGuards, Req, HttpCode, HttpStatus, Headers } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

@Controller('api/payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create-order')
  async createOrder(@Req() req: any) {
    return this.paymentService.createOrder(req.user.id || req.user.sub);
  }

  @Post('webhook/razorpay')
  @HttpCode(HttpStatus.OK)
  async razorpayWebhook(
    @Headers('x-razorpay-signature') signature: string,
    @Body() body: any
  ) {
    return this.paymentService.handleWebhook(signature, body);
  }
}
