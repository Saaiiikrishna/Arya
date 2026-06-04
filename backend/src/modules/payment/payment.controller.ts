import { Controller, Post, UseGuards, Req, HttpCode, HttpStatus, Headers, BadRequestException } from '@nestjs/common';
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
    @Req() req: any,
  ) {
    const rawBody: Buffer | undefined = req.rawBody;
    // Fail closed: the HMAC must be verified over the EXACT bytes Razorpay signed.
    // Falling back to the JSON-parsed body would re-serialize differently and make
    // the signature silently never match — so a missing/non-Buffer raw body is a
    // hard error, never a degraded-but-accepted path.
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new BadRequestException(
        'Raw request body unavailable; cannot verify webhook signature',
      );
    }
    return this.paymentService.handleWebhook(signature, rawBody);
  }
}
