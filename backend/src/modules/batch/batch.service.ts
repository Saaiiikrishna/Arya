import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { EmailService } from '../email';
import { NotificationService } from '../notifications/notification.service';
import { BackfillService } from '../automation/backfill.service';
import { BatchStatus, ApplicantStatus } from '@prisma/client';

@Injectable()
export class BatchService {
  private readonly logger = new Logger(BatchService.name);

  /**
   * Fixed cohort size. Every batch ships as a team of exactly 100; this is a
   * hard service-layer rule that overrides any configurable capacity setting
   * for AUTO-created batches.
   */
  private static readonly COHORT_SIZE = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notifications: NotificationService,
    private readonly backfill: BackfillService,
  ) {}

  // ─── Create Batch (Manual) ─────────────────────────────
  async createBatch(data: {
    name: string;
    nickname?: string;
    capacity: number;
  }) {
    // Get next batch number
    const lastBatch = await this.prisma.batch.findFirst({
      orderBy: { batchNumber: 'desc' },
    });
    const batchNumber = (lastBatch?.batchNumber || 0) + 1;

    return this.prisma.batch.create({
      data: {
        batchNumber,
        name: data.name,
        nickname: data.nickname || null,
        capacity: data.capacity,
      },
    });
  }

  // ─── Update Batch ──────────────────────────────────────
  async updateBatch(
    id: string,
    data: { name?: string; nickname?: string; capacity?: number },
  ) {
    const batch = await this.prisma.batch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('Batch not found');

    return this.prisma.batch.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.nickname !== undefined && { nickname: data.nickname }),
        ...(data.capacity !== undefined && { capacity: data.capacity }),
      },
    });
  }

  async findAll() {
    return this.prisma.batch.findMany({
      orderBy: { batchNumber: 'asc' },
      include: {
        _count: { select: { applicants: true, teams: true } },
      },
    });
  }

  /**
   * Public, safe-field batch list for the Archives page (no applicant PII).
   * Newest first. Used by an unauthenticated/public surface, so it returns only
   * non-sensitive batch metadata + aggregate counts.
   */
  async listPublic() {
    return this.prisma.batch.findMany({
      orderBy: { batchNumber: 'desc' },
      select: {
        id: true,
        batchNumber: true,
        name: true,
        nickname: true,
        status: true,
        capacity: true,
        currentCount: true,
        createdAt: true,
        _count: { select: { applicants: true, teams: true } },
      },
    });
  }

  async findOne(id: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: {
        _count: { select: { applicants: true, teams: true } },
        teams: {
          include: { _count: { select: { members: true } } },
          orderBy: { name: 'asc' },
        },
        instructions: { orderBy: { sentAt: 'desc' } },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  async findByNumber(batchNumber: number) {
    const batch = await this.prisma.batch.findUnique({
      where: { batchNumber },
      include: {
        _count: { select: { applicants: true, teams: true } },
        teams: {
          include: {
            members: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                status: true,
              },
            },
          },
        },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  // ─── Auto Batch Logic (toggle-gated) ──────────────────
  async checkAndCreateBatch(): Promise<{ triggered: boolean; batchId?: string }> {
    // Check if auto-batch is enabled via SiteSetting
    const autoBatchSetting = await this.prisma.siteSetting.findUnique({
      where: { key: 'auto_batch_enabled' },
    });
    const isAutoEnabled = autoBatchSetting?.value === 'true';

    if (!isAutoEnabled) return { triggered: false };

    const fillingBatch = await this.prisma.batch.findFirst({
      where: { status: 'FILLING' },
    });

    if (!fillingBatch) return { triggered: false };

    // Gate on the REAL applicant count, not the cached currentCount (which can
    // drift), to decide whether the batch is actually full.
    const realCount = await this.prisma.applicant.count({
      where: { batchId: fillingBatch.id, status: { not: 'REMOVED' } },
    });

    if (realCount < fillingBatch.capacity) {
      return { triggered: false };
    }

    // ── Atomic FILLING -> SCREENING transition ──────────────────────────────
    // Two callers (cron tick + queue job) can both observe the batch as full
    // and both try to flip it, double-firing "batch filled" notifications and
    // racing to create batch N+1. Serialize the flip with the same advisory
    // lock used for batch creation, and gate it on a compare-and-swap: only the
    // caller whose updateMany actually moves the row out of FILLING wins. Side
    // effects (notifications + next-batch creation) run AFTER the winning CAS,
    // outside the critical transaction.
    const won = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aryavartham_batch_create'))`;

      // Re-confirm fullness inside the lock against the live count so a
      // concurrent removal between the gate above and the lock can't push a
      // no-longer-full batch into SCREENING.
      const lockedCount = await tx.applicant.count({
        where: { batchId: fillingBatch.id, status: { not: 'REMOVED' } },
      });
      if (lockedCount < fillingBatch.capacity) return false;

      const flip = await tx.batch.updateMany({
        where: { id: fillingBatch.id, status: BatchStatus.FILLING },
        data: { status: BatchStatus.SCREENING },
      });
      // Exactly one transaction can see status=FILLING and flip it; everyone
      // else gets count=0 and bails without re-running the side effects.
      return flip.count === 1;
    });

    if (!won) {
      // Another caller already flipped this batch; nothing to do.
      return { triggered: false };
    }

    // ── Side effects (best-effort, outside the critical txn) ────────────────
    // Notify every applicant in the now-filled batch. Must not block or roll
    // back the transition or the auto-create of the next batch.
    const filledApplicants = await this.prisma.applicant.findMany({
      where: { batchId: fillingBatch.id, status: { not: 'REMOVED' } },
      select: { id: true, email: true, firstName: true, phone: true },
    });
    await Promise.allSettled(
      filledApplicants.map((applicant) =>
        this.notifications.batchFilled({
          ...applicant,
          batchNumber: fillingBatch.batchNumber,
        }),
      ),
    );

    // Auto-create the next FILLING batch. Reuse the advisory lock + unique
    // batchNumber guard so a concurrent sign-up (applicant.service) that also
    // mints the next batch can't create a duplicate; we no-op if a later batch
    // already exists.
    const nextBatchNumber = fillingBatch.batchNumber + 1;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aryavartham_batch_create'))`;

      // Someone may have already created batch N+1 (or beyond) inside the lock.
      const existingNext = await tx.batch.findFirst({
        where: { batchNumber: { gte: nextBatchNumber } },
      });
      if (existingNext) return;

      const nicknameSetting = await tx.siteSetting.findUnique({
        where: { key: 'auto_batch_nicknames' },
      });
      const namingSetting = await tx.siteSetting.findUnique({
        where: { key: 'auto_batch_naming_sequence' },
      });

      const nicknames: string[] = nicknameSetting
        ? JSON.parse(nicknameSetting.value)
        : [];
      const namingSequence = namingSetting?.value || 'Batch';
      const nickname = nicknames.length > 0 ? nicknames.shift() : undefined;

      // Save remaining nicknames back (only meaningful when one was consumed).
      if (nicknameSetting) {
        await tx.siteSetting.update({
          where: { key: 'auto_batch_nicknames' },
          data: { value: JSON.stringify(nicknames) },
        });
      }

      await tx.batch.create({
        data: {
          batchNumber: nextBatchNumber,
          name: `${namingSequence} ${nextBatchNumber}`,
          nickname: nickname || null,
          // Fixed cohort rule: auto-created batches are EXACTLY 100 seats,
          // regardless of any configurable auto_batch_capacity setting.
          capacity: BatchService.COHORT_SIZE,
        },
      });
    });

    this.logger.log(
      `Batch ${fillingBatch.batchNumber} filled. Auto-created batch ${nextBatchNumber} (capacity ${BatchService.COHORT_SIZE}).`,
    );
    return { triggered: true, batchId: fillingBatch.id };
  }

  async transitionStatus(id: string, newStatus: BatchStatus) {
    const batch = await this.prisma.batch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('Batch not found');

    const validTransitions: Record<BatchStatus, BatchStatus[]> = {
      FILLING: [BatchStatus.SCREENING],
      SCREENING: [BatchStatus.TEAM_FORMATION],
      TEAM_FORMATION: [BatchStatus.PROCESSING],
      PROCESSING: [BatchStatus.PENDING_CONSENT],
      PENDING_CONSENT: [BatchStatus.FINALIZED],
      FINALIZED: [BatchStatus.PRODUCTION],
      PRODUCTION: [],
    };

    if (!validTransitions[batch.status]?.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${batch.status} to ${newStatus}`,
      );
    }

    const updateData: any = { status: newStatus };
    if (newStatus === BatchStatus.FINALIZED)
      updateData.finalizedAt = new Date();
    if (newStatus === BatchStatus.PRODUCTION)
      updateData.productionAt = new Date();

    return this.prisma.batch.update({
      where: { id },
      data: updateData,
    });
  }

  async sendInstructions(
    batchId: string,
    title: string,
    content: string,
    additionalQuestionIds: string[] = [],
    explanation?: string,
    deadline?: string,
  ) {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    const instruction = await this.prisma.batchInstruction.create({
      data: {
        batchId,
        title,
        content,
        explanation: explanation || null,
        additionalQuestionIds,
        deadline: deadline ? new Date(deadline) : null,
      },
    });

    // Send email notifications to all batch applicants
    const applicants = await this.prisma.applicant.findMany({
      where: { batchId, status: { not: 'REMOVED' } },
      select: { id: true, email: true, firstName: true },
    });

    const deadlineFormatted = deadline
      ? new Date(deadline).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'No specific deadline';

    const statusUrl = `${process.env.FRONTEND_URL || 'https://aryavartham.com'}/hub`;
    const templateSlug =
      additionalQuestionIds.length > 0 ? 'screening-questionnaire' : 'additional-instructions';
    // Dispatch in parallel rather than blocking the request serially per recipient.
    await Promise.allSettled(
      applicants.map((applicant) =>
        this.emailService.sendTemplatedEmail(
          applicant.email,
          templateSlug,
          {
            firstName: applicant.firstName,
            title,
            content,
            explanation: explanation || '',
            deadline: deadlineFormatted,
            batchNumber: String(batch.batchNumber),
            statusUrl,
          },
          applicant.id,
        ),
      ),
    );

    this.logger.log(
      `Instructions sent to batch ${batch.batchNumber}: ${title} (${applicants.length} emails)`,
    );
    return { instruction, emailsSent: applicants.length };
  }

  // ─── Remove non-responders (admin manual trigger) ─────
  async removeNonResponders(batchId: string, instructionId: string) {
    const instruction = await this.prisma.batchInstruction.findUnique({
      where: { id: instructionId },
    });
    if (!instruction || instruction.batchId !== batchId) {
      throw new NotFoundException('Instruction not found for this batch');
    }
    if (
      !instruction.additionalQuestionIds ||
      instruction.additionalQuestionIds.length === 0
    ) {
      throw new BadRequestException(
        'This instruction has no questions to check responses for',
      );
    }

    // Find applicants who didn't answer ALL the additional questions
    const applicants = await this.prisma.applicant.findMany({
      where: { batchId, status: { not: 'REMOVED' } },
      include: {
        answers: {
          where: {
            questionId: { in: instruction.additionalQuestionIds },
            phaseTag: 'ADDITIONAL',
          },
        },
      },
    });

    const requiredCount = instruction.additionalQuestionIds.length;
    const nonResponders = applicants.filter(
      (a) => a.answers.length < requiredCount,
    );

    if (nonResponders.length === 0) {
      return { removedCount: 0, message: 'All applicants have responded' };
    }

    // Remove non-responders and keep the batch counter accurate in one txn, so
    // the backfill that re-increments currentCount nets out correctly.
    await this.prisma.$transaction([
      this.prisma.applicant.updateMany({
        where: { id: { in: nonResponders.map((a) => a.id) } },
        data: { status: ApplicantStatus.REMOVED, removedAt: new Date() },
      }),
      this.prisma.batch.update({
        where: { id: batchId },
        data: { currentCount: { decrement: nonResponders.length } },
      }),
    ]);

    this.logger.log(
      `Removed ${nonResponders.length} non-responders from batch ${batchId}`,
    );

    // Top the freed seats back up from the next batch (best-effort, async).
    void this.backfill.enqueueBackfill(batchId, nonResponders.length);

    return {
      removedCount: nonResponders.length,
      removedIds: nonResponders.map((a) => a.id),
    };
  }

  async getApplicantsForBatch(batchId: string) {
    return this.prisma.applicant.findMany({
      where: { batchId, status: { not: 'REMOVED' } },
      include: {
        answers: { include: { question: true } },
        team: { select: { id: true, name: true } },
      },
      orderBy: { appliedAt: 'asc' },
    });
  }

  async approveBatch(id: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: { _count: { select: { applicants: true } } },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    const unconsentedCount = await this.prisma.applicant.count({
      where: {
        batchId: id,
        status: { not: 'REMOVED' },
        consentGiven: false,
      },
    });

    if (unconsentedCount > 0) {
      throw new BadRequestException(
        `${unconsentedCount} applicant(s) have not given consent yet`,
      );
    }

    await this.prisma.applicant.updateMany({
      where: { batchId: id, status: { not: 'REMOVED' } },
      data: { status: ApplicantStatus.FINALIZED },
    });

    return this.transitionStatus(id, BatchStatus.PRODUCTION);
  }

  // ─── Public: current filling batch ────────────────────
  async getCurrentFillingBatch() {
    const batch = await this.prisma.batch.findFirst({
      where: { status: 'FILLING' },
      select: {
        id: true,
        batchNumber: true,
        name: true,
        nickname: true,
        status: true,
        capacity: true,
        currentCount: true,
        createdAt: true,
      },
    });
    return batch; // null if no filling batch
  }

  // Public: batch status for waitlisted users
  async getPublicBatchStatus(batchNumber: number) {
    const batch = await this.prisma.batch.findUnique({
      where: { batchNumber },
      select: {
        batchNumber: true,
        name: true,
        nickname: true,
        status: true,
        capacity: true,
        currentCount: true,
        createdAt: true,
        finalizedAt: true,
        _count: { select: { teams: true } },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }
}
