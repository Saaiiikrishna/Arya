import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma';
import { EmailService } from '../email/email.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Runs every hour. Finds interview bookings whose slot has ended with no decision
   * and marks them NO_SHOW, then sends a notification email.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async detectNoShows() {
    const pastSlots = await this.prisma.interviewSlot.findMany({
      where: { endTime: { lt: new Date() } },
      include: {
        bookings: {
          where: { status: 'CONFIRMED', decision: null },
          include: {
            applicant: { select: { id: true, email: true, firstName: true } },
          },
        },
      },
    });

    let count = 0;
    for (const slot of pastSlots) {
      for (const booking of slot.bookings) {
        await this.prisma.interviewBooking.update({
          where: { id: booking.id },
          data: { status: 'NO_SHOW' },
        });

        await this.emailService.sendTemplatedEmail(
          booking.applicant.email,
          'interview-no-show',
          { firstName: booking.applicant.firstName },
          booking.applicant.id,
        );
        count++;
      }
    }

    if (count > 0) this.logger.log(`Marked ${count} bookings as NO_SHOW`);
  }

  /**
   * Runs daily at 08:30 IST. Finds pending CREATE_NEW team requests in batches
   * that have moved past TEAM_FORMATION. Auto-rejects them and emails the applicant.
   * Business rule: if the batch is past team formation, the window to create a new team
   * has closed — the applicant must join an existing team or wait for the next batch.
   */
  @Cron('0 3 * * *') // 03:00 UTC = 08:30 IST
  async enforceCreateNewDeadline() {
    const staleRequests = await this.prisma.teamRequest.findMany({
      where: {
        type: 'CREATE_NEW',
        status: 'PENDING',
        team: {
          batch: {
            status: { notIn: ['FILLING', 'SCREENING', 'TEAM_FORMATION'] },
          },
        },
      },
      include: {
        team: {
          include: { batch: { select: { id: true, batchNumber: true } } },
        },
      },
    });

    let count = 0;
    for (const request of staleRequests) {
      await this.prisma.teamRequest.update({
        where: { id: request.id },
        data: {
          status: 'REJECTED',
          resolvedAt: new Date(),
          details: request.details + '\n\n[AUTO-REJECTED: Team formation window has closed for this batch]',
        },
      });

      const applicant = await this.prisma.applicant.findUnique({
        where: { id: request.requesterId },
        select: { id: true, email: true, firstName: true },
      });
      if (!applicant) continue;

      await this.emailService.sendTemplatedEmail(
        applicant.email,
        'team-request-rejected',
        {
          firstName: applicant.firstName,
          requestType: 'Create New Team',
          reason:
            'The team formation window for your batch has closed. Your request to create a new team has been automatically closed. Please connect with your current team or contact the platform for reassignment options.',
        },
        applicant.id,
      );
      count++;
    }

    if (count > 0) this.logger.log(`Auto-rejected ${count} stale CREATE_NEW requests`);
  }

  /**
   * Runs daily at 08:00 IST. For each locked team with an active co-founder,
   * calculates the current sprint week and sends a reminder email to the co-founder
   * if the weekly check-in for that week has not been submitted yet.
   */
  @Cron('0 2 * * *') // 02:00 UTC = 07:30 IST
  async sendDeadlineReminders() {
    const now = new Date();
    const reminderDays = [7, 3, 1];

    for (const days of reminderDays) {
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + days);
      const dayStart = new Date(targetDate.setHours(0, 0, 0, 0));
      const dayEnd = new Date(targetDate.setHours(23, 59, 59, 999));

      const instructions = await this.prisma.batchInstruction.findMany({
        where: { deadline: { gte: dayStart, lte: dayEnd } },
        include: { batch: { select: { id: true, batchNumber: true } } },
      });

      for (const instruction of instructions) {
        const applicants = await this.prisma.applicant.findMany({
          where: { batchId: instruction.batchId, status: { not: 'REMOVED' } },
          select: { id: true, email: true, firstName: true },
        });

        await Promise.allSettled(
          applicants.map((a) =>
            this.emailService.sendTemplatedEmail(
              a.email,
              'deadline-reminder',
              {
                firstName: a.firstName,
                instructionTitle: instruction.title,
                daysLeft: String(days),
                deadline: instruction.deadline?.toDateString() ?? '',
              },
              a.id,
            ),
          ),
        );

        this.logger.log(
          `D-${days} reminder sent for instruction "${instruction.title}" (batch ${instruction.batch.batchNumber}, ${applicants.length} recipients)`,
        );
      }
    }
  }

  /**
   * Runs daily at 09:00 IST. For each locked team with an active co-founder assignment,
   * calculates the current sprint week (days since co-founder assignment ÷ 7)
   * and sends a reminder if the check-in for that week hasn't been submitted.
   * Only fires after the first week (day 7+) so teams have time to settle in.
   */
  @Cron('0 3 30 * * *') // 03:30 UTC = 09:00 IST — distinct from the 03:00 job above
  async remindWeeklyCheckIns() {
    const now = new Date();

    const assignments = await (this.prisma as any).coFounderAssignment.findMany({
      where: { isActive: true },
      include: {
        team: { select: { id: true, name: true, isLocked: true } },
        coFounder: { select: { id: true, email: true, firstName: true } },
      },
    });

    let count = 0;
    for (const assignment of assignments) {
      if (!assignment.team.isLocked) continue;

      const assignedAt: Date = assignment.assignedAt;
      const daysSinceAssignment = Math.floor(
        (now.getTime() - assignedAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceAssignment < 7) continue; // first week — no check-in due yet

      const currentWeek = Math.ceil(daysSinceAssignment / 7);

      const existing = await (this.prisma as any).weeklyCheckIn.findUnique({
        where: { teamId_week: { teamId: assignment.teamId, week: currentWeek } },
      });
      if (existing) continue; // already submitted

      await this.emailService.sendTemplatedEmail(
        assignment.coFounder.email,
        'weekly-checkin-reminder',
        {
          firstName: assignment.coFounder.firstName,
          teamName: assignment.team.name,
          week: String(currentWeek),
        },
        assignment.coFounder.id,
      );
      count++;
    }

    if (count > 0) this.logger.log(`Weekly check-in reminders sent to ${count} co-founders`);
  }
}
