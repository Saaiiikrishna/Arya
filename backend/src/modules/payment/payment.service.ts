import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/modules/notifications/notification.service';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';

@Injectable()
export class PaymentService {
  private razorpay: Razorpay;
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
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

    // Reject if the applicant has already paid.
    const capturedPayment = await (this.prisma as any).payment.findFirst({
      where: { applicantId, status: 'CAPTURED' },
    });
    if (capturedPayment) {
      throw new BadRequestException('This applicant has already paid');
    }

    const batch = applicant.batch as any;
    let amount = batch.pledgeAmount; // already stored as integer paise
    const currency = 'INR';

    // Dynamic pricing override via SiteSettings
    const pricingSetting = await (this.prisma as any).siteSetting.findUnique({
      where: { key: 'pledgePricing' },
    });

    if (pricingSetting && pricingSetting.value) {
      try {
        const pricingItems = JSON.parse(pricingSetting.value);
        if (Array.isArray(pricingItems) && pricingItems.length > 0) {
          let sum = 0;
          for (const item of pricingItems) {
            const itemAmount = Number(item?.amount);
            // Each amount must be a finite, positive integer (rupees). Reject
            // fractional, negative, zero, or non-numeric values so we never
            // send fractional/negative paise to Razorpay.
            if (!Number.isInteger(itemAmount) || itemAmount <= 0) {
              throw new BadRequestException('Invalid pledge pricing amount');
            }
            sum += itemAmount;
          }
          if (sum > 0) {
            amount = sum * 100;
          }
        }
      } catch (e) {
        // Surface validation failures; only swallow JSON/parse errors so a
        // malformed setting falls back to the batch pledge amount.
        if (e instanceof BadRequestException) {
          throw e;
        }
        console.error('Failed to parse dynamic pledge pricing', e);
      }
    }

    // Reuse a recent unpaid (CREATED) order instead of minting a duplicate.
    // Window keeps a stale order from being reused forever while still
    // de-duplicating rapid/repeated checkout attempts.
    const REUSE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

    // Race-safe order issuance.
    //
    // Two concurrent checkout attempts for the same applicant could both miss
    // the reuse lookup and both mint a Razorpay order. Serialize per applicant
    // with a transaction-scoped advisory lock, then re-check for a reusable
    // CREATED order inside the lock and reuse it; otherwise create exactly one.
    // The Razorpay API call lives inside the lock so the order id we persist is
    // the only one minted for the window.
    let orderId: string;
    let persistedAmount: number;
    let persistedCurrency: string;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment_order_${applicantId}`}))`;

        // Re-check inside the lock — another request may have just created one.
        const existingOrder = await (tx as any).payment.findFirst({
          where: {
            applicantId,
            status: 'CREATED',
            currency,
            razorpayOrderId: { not: null },
            createdAt: { gte: new Date(Date.now() - REUSE_WINDOW_MS) },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (existingOrder && existingOrder.amount === amount) {
          return {
            orderId: existingOrder.razorpayOrderId as string,
            amount: existingOrder.amount as number,
            currency: existingOrder.currency as string,
          };
        }

        const order = await this.razorpay.orders.create({
          amount,
          currency,
          receipt: `receipt_${applicant.id.split('-')[0]}`,
        });

        // Save the intent inside the same locked transaction.
        const created = await (tx as any).payment.create({
          data: {
            applicantId,
            razorpayOrderId: order.id,
            amount, // integer paise
            currency,
            status: 'CREATED',
          },
        });

        return {
          orderId: created.razorpayOrderId as string,
          amount: created.amount as number,
          currency: created.currency as string,
        };
      });

      orderId = result.orderId;
      persistedAmount = result.amount;
      persistedCurrency = result.currency;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      console.error('Razorpay Error', error);
      throw new BadRequestException('Failed to generate payment order');
    }

    return {
      orderId,
      amount: persistedAmount,
      currency: persistedCurrency,
      key: this.configService.get<string>('RAZORPAY_KEY_ID'),
      // Prefill data for Razorpay checkout
      applicantName: `${applicant.firstName} ${applicant.lastName}`.trim(),
      applicantEmail: applicant.email,
      applicantPhone: applicant.phone || '',
    };
  }

  async handleWebhook(signature: string, requestBody: Buffer | any) {
    // Fail closed: never verify against an empty/absent key.
    const webHookSecret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET');
    if (!webHookSecret) {
      this.logger.error('RAZORPAY_WEBHOOK_SECRET not configured; rejecting webhook');
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

      const payment = await (this.prisma as any).payment.findUnique({
        where: { razorpayOrderId: orderId },
      });

      // Unknown order: ack with 200 so Razorpay stops retrying a phantom order.
      if (!payment) {
        this.logger.warn(`Webhook for unknown order ${orderId}; ignoring`);
        return { success: true };
      }

      // Idempotency: a retried/duplicate capture must be a no-op.
      if (payment.status === 'CAPTURED') {
        return { success: true };
      }

      // Verify the captured amount/currency matches what we actually charged (paise).
      const expectedPaise = payment.amount; // stored as integer paise
      if (
        Number(paymentEntity.amount) !== expectedPaise ||
        paymentEntity.currency !== payment.currency
      ) {
        this.logger.error(
          `Captured amount/currency mismatch on order ${orderId}: expected ${expectedPaise} ${payment.currency}, got ${paymentEntity.amount} ${paymentEntity.currency}; NOT promoting applicant`,
        );
        return { success: true };
      }

      // Exactly-once capture + promote.
      //
      // Razorpay retries webhook deliveries, so the same payment.captured event
      // can arrive multiple times concurrently. The read-then-update check above
      // is advisory only; the real dedupe is a conditional compare-and-swap:
      // promote the payment from "not yet captured" to CAPTURED with an
      // updateMany guarded on status != 'CAPTURED'. Exactly one concurrent
      // delivery flips the row (count === 1) and is allowed to promote the
      // applicant + notify; any duplicate sees count === 0 and is a no-op.
      const captured = await this.prisma.$transaction(async (tx) => {
        const promoted = await (tx as any).payment.updateMany({
          where: { id: payment.id, status: { not: 'CAPTURED' } },
          data: { razorpayPaymentId: paymentEntity.id, status: 'CAPTURED' },
        });

        // Lost the race / already captured by a prior delivery — no-op.
        if (promoted.count !== 1) {
          return false;
        }

        await tx.applicant.update({
          where: { id: payment.applicantId },
          data: { status: 'CONSENTED' },
        });

        return true;
      });

      // A duplicate delivery already captured this order; ack without re-firing
      // notifications or re-promoting.
      if (!captured) {
        return { success: true };
      }

      // Fire payment-success notification AFTER the transaction commits.
      // Best-effort and non-throwing: must never block/abort the webhook ack.
      try {
        const applicant = await this.prisma.applicant.findUnique({
          where: { id: payment.applicantId },
          select: {
            id: true,
            email: true,
            firstName: true,
            phone: true,
            accessToken: true,
            batch: { select: { batchNumber: true } },
          },
        });
        if (applicant) {
          await this.notifications.paymentSuccess({
            id: applicant.id,
            email: applicant.email,
            firstName: applicant.firstName,
            phone: applicant.phone,
            accessToken: applicant.accessToken,
            batchNumber: applicant.batch?.batchNumber ?? null,
          });
        }
      } catch (e) {
        this.logger.error(
          `paymentSuccess notification failed for applicant ${payment.applicantId}: ${(e as any)?.message}`,
        );
      }
    }

    return { success: true };
  }
}
