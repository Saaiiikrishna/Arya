import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma';
import { EmailService } from '../email/email.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

/**
 * Minimal shape every milestone notification needs. Pass whatever the caller
 * has loaded — missing optional fields just skip that channel/variable.
 */
export interface NotifiableApplicant {
  id: string;
  email: string;
  firstName: string;
  phone?: string | null;
  accessToken?: string | null;
  batchNumber?: number | string | null;
}

/**
 * Single place that fans every pipeline milestone out to BOTH email (AWS SES,
 * templated) and WhatsApp (Meta templates). Every send is best-effort and
 * non-throwing so a notification failure never blocks a business transition.
 * Registered @Global so any service can inject it without module plumbing.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly url: string;

  constructor(
    private readonly email: EmailService,
    private readonly whatsapp: WhatsappService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.url = config.get<string>('FRONTEND_URL', 'https://aryavartham.com');
  }

  private hub() {
    return `${this.url}/hub`;
  }
  private status(a: NotifiableApplicant) {
    return a.accessToken ? `${this.url}/applicants/status/${a.accessToken}` : this.hub();
  }
  private bn(a: NotifiableApplicant) {
    return String(a.batchNumber ?? '');
  }

  /**
   * Escape text for safe interpolation into an HTML body. Prevents HTML/email
   * injection when dynamic fields (names, order/RMA numbers, courier, AWB, URLs)
   * are placed inside `htmlBody`. Escapes the five HTML-significant characters.
   */
  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Render a tracking URL as a safe HTML anchor, but ONLY if it parses as an
   * http(s) URL. Anything else (javascript:, data:, relative, garbage) is
   * rendered as escaped plain text so it can never become an injection vector.
   * Returns an empty string when there is no usable value.
   */
  private trackingLink(raw: string | null | undefined): string {
    const value = raw?.trim();
    if (!value) return '';
    let parsed: URL | undefined;
    try {
      parsed = new URL(value);
    } catch {
      parsed = undefined;
    }
    if (parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
      const href = this.escapeHtml(parsed.toString());
      return `<p>Track it here: <a href="${href}">${href}</a></p>`;
    }
    // Not a valid http(s) URL: show as escaped plain text, no link.
    return `<p>Track it here: ${this.escapeHtml(value)}</p>`;
  }
  private async email1(to: string, slug: string, vars: Record<string, string>, id?: string) {
    try {
      await this.email.sendTemplatedEmail(to, slug, vars, id);
    } catch (e) {
      this.logger.error(`Email '${slug}' to ${to} failed: ${(e as any)?.message}`);
    }
  }

  async applicationReceived(a: NotifiableApplicant) {
    await Promise.allSettled([
      this.email1(a.email, 'application-received', { firstName: a.firstName, batchNumber: this.bn(a), statusUrl: this.status(a) }, a.id),
      a.phone ? this.whatsapp.sendApplicationReceived(a.phone, a.firstName, a.id) : Promise.resolve(false),
    ]);
  }

  async paymentSuccess(a: NotifiableApplicant) {
    await this.email1(a.email, 'payment-success', { firstName: a.firstName, batchNumber: this.bn(a), hubUrl: this.hub() }, a.id);
  }

  async eligibilityDecision(a: NotifiableApplicant, eligible: boolean) {
    await this.email1(
      a.email,
      eligible ? 'eligible-notification' : 'ineligible-notification',
      { firstName: a.firstName, batchNumber: this.bn(a), statusUrl: this.status(a), applyUrl: `${this.url}/apply` },
      a.id,
    );
  }

  async teamFormed(a: NotifiableApplicant, teamName: string) {
    await Promise.allSettled([
      this.email1(a.email, 'team-formed', { firstName: a.firstName, teamName, batchNumber: this.bn(a), hubUrl: this.hub() }, a.id),
      a.phone ? this.whatsapp.sendTeamAssignment(a.phone, a.firstName, teamName, 'your mentor', a.id) : Promise.resolve(false),
    ]);
  }

  async teamTraining(a: NotifiableApplicant, reason: string) {
    await Promise.allSettled([
      this.email1(a.email, 'team-training', { firstName: a.firstName, reason, hubUrl: this.hub() }, a.id),
      a.phone ? this.whatsapp.sendTeamTraining(a.phone, a.firstName, reason, a.id) : Promise.resolve(false),
    ]);
  }

  async batchFilled(a: NotifiableApplicant) {
    await this.email1(a.email, 'batch-filled', { firstName: a.firstName, filledBatchNumber: this.bn(a), batchNumber: this.bn(a), batchUrl: this.hub() }, a.id);
  }

  async interviewScheduled(a: NotifiableApplicant, date: string, time: string, meetLink: string) {
    await Promise.allSettled([
      this.email1(a.email, 'interview-scheduled', { firstName: a.firstName, date, time, meetLink }, a.id),
      a.phone ? this.whatsapp.sendInterviewScheduled(a.phone, a.firstName, date, time, meetLink, a.id) : Promise.resolve(false),
    ]);
  }

  async interviewDecision(a: NotifiableApplicant, selected: boolean, cohortNumber: string | number) {
    await Promise.allSettled([
      this.email1(
        a.email,
        selected ? 'interview-decision-selected' : 'interview-decision-rejected',
        { firstName: a.firstName, cohortNumber: String(cohortNumber ?? ''), hubUrl: this.hub() },
        a.id,
      ),
      a.phone
        ? (selected
            ? this.whatsapp.sendInterviewSelected(a.phone, a.firstName, String(cohortNumber ?? ''), a.id)
            : this.whatsapp.sendInterviewRejected(a.phone, a.firstName, a.id))
        : Promise.resolve(false),
    ]);
  }

  async referralMilestoneEmail(a: NotifiableApplicant, count: number, badgeName: string) {
    // WhatsApp for referral milestones is already sent by WhatsappService.sendReferralMilestone.
    await this.email1(a.email, 'referral-milestone-email', { firstName: a.firstName, count: String(count), badgeName, hubUrl: this.hub() }, a.id);
  }

  async deadlineReminder(a: NotifiableApplicant, deadlineName: string, daysLeft: number, dateStr: string) {
    await Promise.allSettled([
      this.email1(a.email, 'screening-deadline-warning', { firstName: a.firstName, deadline: dateStr, batchNumber: this.bn(a), statusUrl: this.status(a) }, a.id),
      a.phone ? this.whatsapp.sendDeadlineReminder(a.phone, a.firstName, deadlineName, String(daysLeft), dateStr, a.id) : Promise.resolve(false),
    ]);
  }

  /** WhatsApp OTP (email OTP is sent separately by the auth flow). */
  async otpWhatsApp(phone: string | null | undefined, otp: string) {
    if (!phone) return;
    try {
      await this.whatsapp.sendOtp(phone, otp);
    } catch (e) {
      this.logger.error(`WhatsApp OTP failed: ${(e as any)?.message}`);
    }
  }

  /** WhatsApp side of an admin broadcast (email side handled by AnnouncementService). */
  async platformAnnouncement(a: NotifiableApplicant, title: string, message: string) {
    if (!a.phone) return;
    try {
      await this.whatsapp.sendAnnouncement(a.phone, title, message, a.id);
    } catch (e) {
      this.logger.error(`WhatsApp announcement failed: ${(e as any)?.message}`);
    }
  }

  // ─── Store / commerce: customer notifications ──────────────

  /**
   * Best-effort "your return was refunded" notification to a STORE customer.
   * Store customers are not applicants (different identity model), so this takes
   * the raw contact fields directly. Email is sent via SES; WhatsApp is sent only
   * if a phone is on file. Every channel is non-throwing — a notification failure
   * never blocks the return settlement.
   */
  async customerReturnRefunded(params: {
    email?: string | null;
    firstName?: string | null;
    phone?: string | null;
    rmaNumber: string;
    refundAmountPaise: number;
  }): Promise<void> {
    const name = params.firstName?.trim() || 'there';
    const rupees = (params.refundAmountPaise / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    // Plain-text variants for WhatsApp (no HTML escaping there).
    const nameText = name;
    const rmaText = params.rmaNumber;
    // HTML-escaped variants for the email body.
    const nameHtml = this.escapeHtml(name);
    const rmaHtml = this.escapeHtml(params.rmaNumber);
    const rupeesHtml = this.escapeHtml(rupees);
    if (params.email) {
      try {
        await this.email.sendEmail({
          to: params.email,
          subject: `Your return ${params.rmaNumber} has been refunded`,
          htmlBody: `<p>Hi ${nameHtml},</p><p>We have received your returned item(s) for <strong>${rmaHtml}</strong> and processed a refund of <strong>₹${rupeesHtml}</strong> to your original payment method. It may take a few business days to reflect.</p><p>Thank you for shopping with Aryavartham.</p>`,
        });
      } catch (e) {
        this.logger.error(
          `Return-refunded email for ${params.rmaNumber} failed: ${(e as Error)?.message}`,
        );
      }
    }
    if (params.phone) {
      try {
        // No applicantId: store customers are not applicants, and passing a
        // non-UUID here would corrupt the applicant-scoped notification log. The
        // WhatsApp send itself still goes out; only the per-applicant log row is
        // skipped (sendAnnouncement skips logging when applicantId is falsy).
        await this.whatsapp.sendAnnouncement(
          params.phone,
          `Return ${rmaText} refunded`,
          `Hi ${nameText}, your return ${rmaText} has been refunded (₹${rupees}). It may take a few business days to reflect.`,
          undefined as unknown as string,
        );
      } catch (e) {
        this.logger.error(
          `Return-refunded WhatsApp for ${params.rmaNumber} failed: ${(e as Error)?.message}`,
        );
      }
    }
  }

  /**
   * Best-effort "your order has shipped" notification to a STORE customer.
   * Store customers are not applicants (different identity model), so this takes
   * the raw contact fields directly — mirroring {@link customerReturnRefunded}.
   * Email is sent via SES; WhatsApp is sent only if a phone is on file. Every
   * channel is non-throwing — a notification failure never blocks the shipment.
   */
  async customerOrderShipped(params: {
    email?: string | null;
    firstName?: string | null;
    phone?: string | null;
    orderNumber: string;
    courier?: string | null;
    awb: string;
    trackingUrl?: string | null;
  }): Promise<void> {
    const name = params.firstName?.trim() || 'there';
    const courier = params.courier?.trim();
    // HTML-escaped variants for the email body.
    const nameHtml = this.escapeHtml(name);
    const orderHtml = this.escapeHtml(params.orderNumber);
    const courierHtml = courier ? this.escapeHtml(courier) : '';
    const awbHtml = this.escapeHtml(params.awb);
    // Tracking URL is only rendered as a link when it parses as http(s);
    // otherwise it is shown as escaped plain text (or omitted when absent).
    const trackLine = this.trackingLink(params.trackingUrl);
    if (params.email) {
      try {
        await this.email.sendEmail({
          to: params.email,
          subject: `Your order ${params.orderNumber} has shipped`,
          htmlBody: `<p>Hi ${nameHtml},</p><p>Good news — your order <strong>${orderHtml}</strong> is on its way${courierHtml ? ` via <strong>${courierHtml}</strong>` : ''}. Tracking number (AWB): <strong>${awbHtml}</strong>.</p>${trackLine}<p>Thank you for shopping with Aryavartham.</p>`,
        });
      } catch (e) {
        this.logger.error(
          `Order-shipped email for ${params.orderNumber} failed: ${(e as any)?.message}`,
        );
      }
    }
    if (params.phone) {
      try {
        // No applicantId: store customers are not applicants, and passing a
        // non-UUID here would corrupt the applicant-scoped notification log
        // (sendAnnouncement skips logging when applicantId is falsy).
        await this.whatsapp.sendAnnouncement(
          params.phone,
          `Order ${params.orderNumber} shipped`,
          `Hi ${name}, your order ${params.orderNumber} has shipped${courier ? ` via ${courier}` : ''} (AWB ${params.awb}).${params.trackingUrl ? ` Track: ${params.trackingUrl}` : ''}`,
          undefined as unknown as string,
        );
      } catch (e) {
        this.logger.error(
          `Order-shipped WhatsApp for ${params.orderNumber} failed: ${(e as any)?.message}`,
        );
      }
    }
  }

  // ─── Admin: notification log + re-send ─────────────────────

  /** Paginated notification log (newest first), filterable for the admin UI. */
  async listNotifications(params: {
    applicantId?: string;
    status?: string;
    type?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 50));
    const where: any = {};
    if (params.applicantId) where.applicantId = params.applicantId;
    if (params.status) where.status = params.status;
    if (params.type) where.type = params.type;

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: { applicant: { select: { id: true, email: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, meta: { total, page, totalPages: Math.ceil(total / limit) } };
  }

  /**
   * Re-send a previously logged notification. Email rows store the fully
   * rendered (brand-wrapped) subject + body, so they can be re-sent verbatim.
   * WhatsApp rows store only a summary (template-based), so they cannot be
   * reconstructed here — re-trigger the milestone instead. Logs a new row.
   */
  async resendNotification(id: string) {
    const n = await this.prisma.notification.findUnique({
      where: { id },
      include: { applicant: { select: { email: true } } },
    });
    if (!n) throw new NotFoundException('Notification not found');
    if (n.type !== 'EMAIL') {
      throw new BadRequestException(
        'Only email notifications can be re-sent from the log; re-trigger the milestone to resend WhatsApp.',
      );
    }
    const to = n.applicant?.email;
    if (!to) throw new BadRequestException('Applicant has no email on file');

    const success = await this.email.sendEmail({ to, subject: n.subject, htmlBody: n.body });
    const resent = await this.prisma.notification.create({
      data: {
        applicantId: n.applicantId,
        type: 'EMAIL',
        subject: n.subject,
        body: n.body,
        status: success ? 'SENT' : 'FAILED',
        sentAt: success ? new Date() : undefined,
        metadata: { resendOf: id },
      },
    });

    this.logger.log(`Re-sent email notification ${id} → ${to} (success=${success})`);
    return { success, notificationId: resent.id };
  }
}
