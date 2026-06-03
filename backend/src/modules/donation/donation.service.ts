import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
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
    // Validate the client-supplied amount (rupees) before any side effects.
    const MIN_RUPEES = 100;
    const MAX_RUPEES = 500_000;
    const amountRupees = data.amount;
    if (typeof amountRupees !== 'number' || !Number.isFinite(amountRupees) || amountRupees <= 0) {
      throw new BadRequestException('Donation amount must be a positive number');
    }
    if (amountRupees < MIN_RUPEES) {
      throw new BadRequestException(`Donation amount must be at least ₹${MIN_RUPEES}`);
    }
    if (amountRupees > MAX_RUPEES) {
      throw new BadRequestException(`Donation amount must not exceed ₹${MAX_RUPEES}`);
    }

    const amountPaise = Math.round(amountRupees * 100);

    const order = await this.razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `donation_${Date.now()}`,
    });

    await this.prisma.donation.create({
      data: {
        donorName: data.donorName,
        donorEmail: data.donorEmail,
        amount: amountPaise, // store integer paise (client sends rupees)
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

  async handleWebhook(signature: string, requestBody: Buffer | any) {
    // Fail closed: never verify against an empty/absent key.
    const webHookSecret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET');
    if (!webHookSecret) {
      this.logger.error('RAZORPAY_WEBHOOK_SECRET not configured; rejecting donation webhook');
      throw new InternalServerErrorException('Payment webhook secret not configured');
    }

    const bodyBuf = Buffer.isBuffer(requestBody)
      ? requestBody
      : Buffer.from(typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody));

    const expectedSig = crypto.createHmac('sha256', webHookSecret).update(bodyBuf).digest('hex');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    const receivedBuf = Buffer.from(signature ?? '', 'utf8');

    const signaturesMatch =
      expectedBuf.length === receivedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, receivedBuf);

    if (!signaturesMatch) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const { event, payload } = JSON.parse(bodyBuf.toString('utf8'));

    if (event === 'payment.captured') {
      const paymentEntity = payload.payment.entity;
      const orderId = paymentEntity.order_id;

      const donation = await this.prisma.donation.findUnique({
        where: { razorpayOrderId: orderId },
      });

      // Idempotency: ignore retries of an already-captured donation.
      if (donation && donation.status !== 'CAPTURED') {
        // Verify the captured amount matches what we recorded (paise).
        const expectedPaise = donation.amount; // stored as integer paise
        if (Number(paymentEntity.amount) !== expectedPaise) {
          this.logger.error(
            `Donation amount mismatch on order ${orderId}: expected ${expectedPaise}, got ${paymentEntity.amount}; not marking captured`,
          );
          return { success: true };
        }
        await this.prisma.donation.update({
          where: { id: donation.id },
          data: { razorpayPaymentId: paymentEntity.id, status: 'CAPTURED' },
        });
        this.logger.log(`Donation captured: ${donation.donorEmail} - ₹${donation.amount}`);
      }
    }

    return { success: true };
  }

  async getDonations(params?: { status?: string; page?: number; limit?: number }) {
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;

    const { status } = params || {};
    // Clamp client-supplied pagination: limit to [1, MAX_LIMIT] (sane default),
    // page to a minimum of 1 so `skip` never goes negative.
    const rawLimit = Number(params?.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const rawPage = Number(params?.page);
    const page = Number.isFinite(rawPage) ? Math.max(Math.trunc(rawPage), 1) : 1;

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
    const [totalDonations, totalAmount, donorCountRows, recentDonations] = await Promise.all([
      this.prisma.donation.count({ where: { status: 'CAPTURED' } }),
      this.prisma.donation.aggregate({ where: { status: 'CAPTURED' }, _sum: { amount: true } }),
      // Efficient unique-donor count: aggregate in the DB instead of
      // materializing one row per distinct donor via groupBy.
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT donor_email) AS count
        FROM donations
        WHERE status = 'CAPTURED'::"PaymentStatus"
      `,
      this.prisma.donation.findMany({
        where: { status: 'CAPTURED', isAnonymous: false },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { donorName: true, amount: true, message: true, createdAt: true },
      }),
    ]);

    // queryRaw returns COUNT as a bigint; coerce to a JSON-safe number.
    const uniqueDonors = Number(donorCountRows[0]?.count ?? 0);

    return {
      totalDonations,
      totalAmount: totalAmount._sum.amount || 0,
      uniqueDonors,
      recentDonations,
    };
  }
}
