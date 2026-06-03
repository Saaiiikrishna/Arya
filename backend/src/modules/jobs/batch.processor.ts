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
    this.logger.log(`Backfill cascade for batch ${batchId}, requested ${removedCount} users`);

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

    // Idempotency: this job can be retried by BullMQ after a partial or even a
    // full run. Re-derive the real shortfall from a live active count of the
    // target batch instead of blindly trusting `removedCount`, so a retry never
    // over-fills the target. We never move more than the free seats currently
    // available, capped further by how many were actually removed.
    const realActiveCount = await this.prisma.applicant.count({
      where: { batchId: batch.id, status: { not: 'REMOVED' } },
    });
    const freeSeats = Math.max(0, batch.capacity - realActiveCount);
    const toMove = Math.min(removedCount, freeSeats);

    if (toMove <= 0) {
      this.logger.log(
        `Batch ${batch.batchNumber} already at capacity (${realActiveCount}/${batch.capacity}); nothing to backfill`,
      );
      return { movedCount: 0 };
    }

    // Get oldest applicants from next batch, limited to the real shortfall.
    const candidates = await this.prisma.applicant.findMany({
      where: { batchId: nextBatch.id, status: { not: 'REMOVED' } },
      orderBy: { appliedAt: 'asc' },
      take: toMove,
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');

    let movedCount = 0;
    for (const applicant of candidates) {
      // Move + counter updates in one atomic transaction, scoped to a single
      // applicant. A retry that re-runs this loop won't double-move because the
      // move only applies while the row still belongs to nextBatch (guarded by
      // updateMany's where clause), and the counters only change when a row was
      // actually moved.
      const moved = await this.prisma.$transaction(async (tx) => {
        const res = await tx.applicant.updateMany({
          where: {
            id: applicant.id,
            batchId: nextBatch.id,
            status: { not: 'REMOVED' },
          },
          data: {
            batchId: batch.id,
            movedAt: new Date(),
            status: ApplicantStatus.ELIGIBLE,
            teamId: null,
          },
        });

        if (res.count === 0) {
          // Already moved (e.g. by a previous attempt) — skip counter updates.
          return false;
        }

        await tx.batch.update({
          where: { id: batch.id },
          data: { currentCount: { increment: 1 } },
        });
        await tx.batch.update({
          where: { id: nextBatch.id },
          data: { currentCount: { decrement: 1 } },
        });
        return true;
      });

      if (!moved) {
        this.logger.log(
          `Applicant ${applicant.email} already moved out of batch ${nextBatch.batchNumber}; skipping`,
        );
        continue;
      }

      movedCount++;

      // Fresh team matching — don't replace, match to best fit.
      // matchToExistingTeam re-checks capacity atomically and may throw if all
      // teams filled up concurrently; don't let that abort the whole backfill.
      try {
        await this.teamService.matchToExistingTeam(applicant.id, batch.id);
      } catch (err) {
        this.logger.warn(
          `Could not match moved applicant ${applicant.email} to a team: ${(err as Error)?.message}`,
        );
      }

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

    return { movedCount };
  }

  private async handleSendBatchNotifications(job: Job) {
    const { batchId, templateSlug, extraVars = {} } = job.data;

    const applicants = await this.prisma.applicant.findMany({
      where: { batchId, status: { not: 'REMOVED' } },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    let sentCount = 0;

    const sendResults = await Promise.allSettled(
      applicants.map((applicant) =>
        this.emailService.sendTemplatedEmail(
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
        ),
      ),
    );
    for (const r of sendResults) {
      if (r.status === 'fulfilled' && r.value) sentCount++;
    }

    this.logger.log(`Sent ${sentCount}/${applicants.length} emails for batch ${batchId}`);
    return { sentCount, total: applicants.length };
  }
}
