import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma';
import { EquityService } from '../equity/equity.service';
import { NotificationService } from '../notifications/notification.service';

/**
 * Time-driven platform automation that has no natural HTTP trigger:
 *  - the 1000-day equity handover (platform's 51% vests to founders), and
 *  - screening/questionnaire deadline reminders.
 *
 * Relies on ScheduleModule.forRoot() (registered in SettingsModule) — @Cron
 * providers are discovered app-wide, so this module only needs the providers.
 * Every job is defensive: one bad row must never abort the rest of the batch.
 */
@Injectable()
export class AutomationScheduler {
  private readonly logger = new Logger(AutomationScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly equity: EquityService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Daily: refresh every active company's days-elapsed counter, then execute the
   * handover for any company whose 1000-day timer has fully elapsed. The handover
   * itself re-checks the day-1000 gate and flips status to HANDED_OVER, so a
   * repeated run is a no-op for companies already transferred.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: 'equity-timers', timeZone: 'Asia/Kolkata' })
  async processEquityTimers() {
    try {
      await this.equity.updateTimers();
    } catch (e) {
      this.logger.error(`Equity timer refresh failed: ${(e as Error)?.message}`);
    }

    const now = new Date();
    const due = await this.prisma.companyEntity.findMany({
      where: {
        status: 'ACTIVE',
        timerStartDate: { not: null },
        timerEndDate: { not: null, lte: now },
      },
      select: { id: true, companyName: true },
    });

    let handed = 0;
    for (const company of due) {
      try {
        await this.equity.executeHandover(company.id, 'SYSTEM_CRON');
        handed++;
        this.logger.log(`Auto-handover completed for "${company.companyName}" (${company.id})`);
      } catch (e) {
        // executeHandover throws if it's somehow not yet eligible / already done —
        // log and continue so one company never blocks the rest.
        this.logger.warn(`Auto-handover skipped for ${company.id}: ${(e as Error)?.message}`);
      }
    }

    if (due.length) this.logger.log(`Equity handover sweep: ${handed}/${due.length} companies handed over`);
    return { due: due.length, handed };
  }

  /**
   * Daily: remind applicants whose batch screening/questionnaire deadline falls
   * within the next 24 hours so the warning lands on the final day. Running once
   * a day keeps each applicant to ~one reminder per deadline.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM, { name: 'screening-deadline-reminders', timeZone: 'Asia/Kolkata' })
  async sendScreeningDeadlineReminders() {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const instructions = await this.prisma.batchInstruction.findMany({
      where: { deadline: { gte: now, lte: in24h } },
      include: { batch: { select: { batchNumber: true } } },
    });

    let notified = 0;
    for (const inst of instructions) {
      if (!inst.deadline) continue;
      const applicants = await this.prisma.applicant.findMany({
        where: {
          batchId: inst.batchId,
          status: { notIn: ['REMOVED', 'INELIGIBLE'] },
        },
        select: { id: true, email: true, firstName: true, phone: true, accessToken: true },
      });

      const dateStr = inst.deadline.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const daysLeft = Math.max(0, Math.ceil((inst.deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));

      const results = await Promise.allSettled(
        applicants.map((a) =>
          this.notifications.deadlineReminder(
            { ...a, batchNumber: inst.batch?.batchNumber },
            inst.title,
            daysLeft,
            dateStr,
          ),
        ),
      );
      notified += results.filter((r) => r.status === 'fulfilled').length;
    }

    if (instructions.length) {
      this.logger.log(`Screening deadline reminders: ${notified} sent across ${instructions.length} deadline(s)`);
    }
    return { deadlines: instructions.length, notified };
  }
}
