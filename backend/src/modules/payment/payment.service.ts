import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';

@Injectable()
export class PaymentService {
  private razorpay: Razorpay;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.razorpay = new Razorpay({
      key_id: this.configService.get<string>('RAZORPAY_KEY_ID', ''),
      key_secret: this.configService.get<string>('RAZORPAY_KEY_SECRET', ''),
    });
  }

  async createOrder(applicantId: string) {
    const applicant = await this.prisma.applicant.findUnique({
      where: { id: applicantId },
      include: { batch: true },
    });

    if (!applicant) throw new NotFoundException('Applicant not found');
    if (!applicant.batch) throw new BadRequestException('Applicant is not assigned to a batch');

    const batch = applicant.batch as any;
    let amount = Number(batch.pledgeAmount) * 100; // Razorpay uses smallest currency unit (paise)
    const currency = 'INR';

    // Dynamic pricing override via SiteSettings
    const pricingSetting = await (this.prisma as any).siteSetting.findUnique({
      where: { key: 'pledgePricing' },
    });

    if (pricingSetting && pricingSetting.value) {
      try {
        const pricingItems = JSON.parse(pricingSetting.value);
        if (Array.isArray(pricingItems)) {
          const sum = pricingItems.reduce((acc: number, item: any) => acc + Number(item.amount), 0);
          if (sum > 0) {
            amount = sum * 100;
          }
        }
      } catch (e) {
        console.error('Failed to parse dynamic pledge pricing', e);
      }
    }

    const orderOptions = {
      amount,
      currency,
      receipt: `receipt_${applicant.id.split('-')[0]}`,
    };

    try {
      const order = await this.razorpay.orders.create(orderOptions);

      // Save the intent
      await (this.prisma as any).payment.create({
        data: {
          applicantId,
          razorpayOrderId: order.id,
          amount: amount / 100,
          currency,
          status: 'CREATED',
        },
      });

      return {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        key: this.configService.get<string>('RAZORPAY_KEY_ID'),
      };
    } catch (error) {
      console.error('Razorpay Error', error);
      throw new BadRequestException('Failed to generate payment order');
    }
  }

  async handleWebhook(signature: string, requestBody: any) {
    const webHookSecret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET', '');
    
    // Stringify the incoming raw body
    const bodyStr = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody);

    const expectedSignature = crypto
      .createHmac('sha256', webHookSecret)
      .update(bodyStr)
      .digest('hex');

    if (expectedSignature !== signature) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const { event, payload } = requestBody;

    if (event === 'payment.captured') {
      const paymentEntity = payload.payment.entity;
      const orderId = paymentEntity.order_id;

      const payment = await (this.prisma as any).payment.findUnique({
        where: { razorpayOrderId: orderId },
      });

      if (!payment) {
        throw new NotFoundException('Payment order not found locally');
      }

      await (this.prisma as any).payment.update({
        where: { id: payment.id },
        data: {
          razorpayPaymentId: paymentEntity.id,
          status: 'CAPTURED',
        },
      });

      await this.prisma.applicant.update({
        where: { id: payment.applicantId },
        data: { status: 'CONSENTED' },
      });
    }

    return { success: true };
  }
}
