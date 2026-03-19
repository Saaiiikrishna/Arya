import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma';
import { BatchService } from '../batch';
import { TeamService } from '../team';
import { EligibilityService } from '../eligibility';
import { EmailService } from '../email';
import { ConfigService } from '@nestjs/config';
import { ApplicantStatus } from '@prisma/client';

@Processor('batch-queue')
export class BatchProcessor extends WorkerHost {
  private readonly logger = new Logger(BatchProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly batchService: BatchService,
    private readonly teamService: TeamService,
    private readonly eligibilityService: EligibilityService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'check-batch-capacity':
        return this.handleCheckBatchCapacity(job);
      case 'screen-batch':
        return this.handleScreenBatch(job);
      case 'form-teams':
        return this.handleFormTeams(job);
      case 'backfill-cascade':
        return this.handleBackfillCascade(job);
      case 'send-batch-notifications':
        return this.handleSendBatchNotifications(job);
      default:
        this.logger.warn(`Unknown job: ${job.name}`);
    }
  }

  private async handleCheckBatchCapacity(job: Job) {
    this.logger.log('Checking batch capacity...');
    const result = await this.batchService.checkAndCreateBatch();

    if (result.triggered && result.batchId) {
      // Notify waitlisted users about new batch
      const batch = await this.prisma.batch.findUnique({
        where: { id: result.batchId },
      });
      if (batch) {
        this.logger.log(`Batch ${batch.batchNumber} is full. Auto-screening...`);
        // Auto-trigger screening
        await this.eligibilityService.screenBatch(result.batchId);
      }
    }

    return result;
  }

  private async handleScreenBatch(job: Job) {
    const { batchId } = job.data;
    this.logger.log(`Screening batch ${batchId}...`);
    return this.eligibilityService.screenBatch(batchId);
  }

  private async handleFormTeams(job: Job) {
    const { batchId } = job.data;
    this.logger.log(`Forming teams for batch ${batchId}...`);
    return this.teamService.formTeams(batchId);
  }

  private async handleBackfillCascade(job: Job) {
    const { batchId, removedCount = 1 } = job.data;
    this.logger.log(`Backfill cascade for batch ${batchId}, need ${removedCount} users`);

    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) return;

    // Find the next batch
    const nextBatch = await this.prisma.batch.findFirst({
      where: { batchNumber: { gt: batch.batchNumber } },
      orderBy: { batchNumber: 'asc' },
    });

    if (!nextBatch) {
      this.logger.log('No next batch available for backfill');
      return;
    }

    // Get oldest applicants from next batch
    const movedApplicants = await this.prisma.applicant.findMany({
      where: { batchId: nextBatch.id, status: { not: 'REMOVED' } },
      orderBy: { appliedAt: 'asc' },
      take: removedCount,
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');

    for (const applicant of movedApplicants) {
      // Move to current batch
      await this.prisma.$transaction([
        this.prisma.applicant.update({
          where: { id: applicant.id },
          data: {
            batchId: batch.id,
            movedAt: new Date(),
            status: ApplicantStatus.ELIGIBLE,
            teamId: null,
          },
        }),
        this.prisma.batch.update({
          where: { id: batch.id },
          data: { currentCount: { increment: 1 } },
        }),
        this.prisma.batch.update({
          where: { id: nextBatch.id },
          data: { currentCount: { decrement: 1 } },
        }),
      ]);

      // Fresh team matching — don't replace, match to best fit
      await this.teamService.matchToExistingTeam(applicant.id, batch.id);

      // Notify user about batch move
      await this.emailService.sendTemplatedEmail(
        applicant.email,
        'user-moved-to-batch',
        {
          firstName: applicant.firstName,
          oldBatchNumber: String(nextBatch.batchNumber),
          newBatchNumber: String(batch.batchNumber),
          statusUrl: `${frontendUrl}/applicants/status/${applicant.accessToken}`,
        },
        applicant.id,
      );

      this.logger.log(
        `Moved applicant ${applicant.email} from batch ${nextBatch.batchNumber} to ${batch.batchNumber}`,
      );
    }

    return { movedCount: movedApplicants.length };
  }

  private async handleSendBatchNotifications(job: Job) {
    const { batchId, templateSlug, extraVars = {} } = job.data;

    const applicants = await this.prisma.applicant.findMany({
      where: { batchId, status: { not: 'REMOVED' } },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    let sentCount = 0;

    for (const applicant of applicants) {
      const success = await this.emailService.sendTemplatedEmail(
        applicant.email,
        templateSlug,
        {
          firstName: applicant.firstName,
          lastName: applicant.lastName,
          email: applicant.email,
          statusUrl: `${frontendUrl}/applicants/status/${applicant.accessToken}`,
          ...extraVars,
        },
        applicant.id,
      );
      if (success) sentCount++;
    }

    this.logger.log(`Sent ${sentCount}/${applicants.length} emails for batch ${batchId}`);
    return { sentCount, total: applicants.length };
  }
}
