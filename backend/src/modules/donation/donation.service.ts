import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';

@Injectable()
export class DonationService {
  private razorpay: Razorpay;
  private readonly logger = new Logger(DonationService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.razorpay = new Razorpay({
      key_id: this.configService.get<string>('RAZORPAY_KEY_ID', ''),
      key_secret: this.configService.get<string>('RAZORPAY_KEY_SECRET', ''),
    });
  }

  async createDonationOrder(data: {
    donorName: string;
    donorEmail: string;
    amount: number;
    type?: 'ONE_TIME' | 'RECURRING';
    message?: string;
    isAnonymous?: boolean;
  }) {
    const amountPaise = Math.round(data.amount * 100);

    const order = await this.razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `donation_${Date.now()}`,
    });

    await this.prisma.donation.create({
      data: {
        donorName: data.donorName,
        donorEmail: data.donorEmail,
        amount: data.amount,
        type: data.type || 'ONE_TIME',
        message: data.message,
        isAnonymous: data.isAnonymous || false,
        razorpayOrderId: order.id,
        status: 'CREATED',
      },
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: this.configService.get<string>('RAZORPAY_KEY_ID'),
    };
  }

  async handleWebhook(signature: string, requestBody: any) {
    const webHookSecret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET', '');
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

      const donation = await this.prisma.donation.findUnique({
        where: { razorpayOrderId: orderId },
      });

      if (donation) {
        await this.prisma.donation.update({
          where: { id: donation.id },
          data: {
            razorpayPaymentId: paymentEntity.id,
            status: 'CAPTURED',
          },
        });
        this.logger.log(`Donation captured: ${donation.donorEmail} - ₹${donation.amount}`);
      }
    }

    return { success: true };
  }

  async getDonations(params?: { status?: string; page?: number; limit?: number }) {
    const { page = 1, limit = 20, status } = params || {};
    const where: any = {};
    if (status) where.status = status;

    const [donations, total] = await Promise.all([
      this.prisma.donation.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.donation.count({ where }),
    ]);

    return { data: donations, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getStats() {
    const [totalDonations, totalAmount, donorCount, recentDonations] = await Promise.all([
      this.prisma.donation.count({ where: { status: 'CAPTURED' } }),
      this.prisma.donation.aggregate({ where: { status: 'CAPTURED' }, _sum: { amount: true } }),
      this.prisma.donation.groupBy({
        by: ['donorEmail'],
        where: { status: 'CAPTURED' },
      }),
      this.prisma.donation.findMany({
        where: { status: 'CAPTURED', isAnonymous: false },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { donorName: true, amount: true, message: true, createdAt: true },
      }),
    ]);

    return {
      totalDonations,
      totalAmount: totalAmount._sum.amount || 0,
      uniqueDonors: donorCount.length,
      recentDonations,
    };
  }
}
