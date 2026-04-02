import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { EmailService } from '../email';
import { BatchStatus, ApplicantStatus } from '@prisma/client';

@Injectable()
export class BatchService {
  private readonly logger = new Logger(BatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
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

    if (fillingBatch.currentCount >= fillingBatch.capacity) {
      // Move to SCREENING
      await this.prisma.batch.update({
        where: { id: fillingBatch.id },
        data: { status: BatchStatus.SCREENING },
      });

      // Get auto-batch config
      const capacitySetting = await this.prisma.siteSetting.findUnique({
        where: { key: 'auto_batch_capacity' },
      });
      const nicknameSetting = await this.prisma.siteSetting.findUnique({
        where: { key: 'auto_batch_nicknames' },
      });
      const namingSetting = await this.prisma.siteSetting.findUnique({
        where: { key: 'auto_batch_naming_sequence' },
      });

      const capacity = capacitySetting
        ? parseInt(capacitySetting.value, 10) || 1000
        : 1000;
      const nicknames: string[] = nicknameSetting
        ? JSON.parse(nicknameSetting.value)
        : [];
      const namingSequence = namingSetting?.value || 'Batch';
      const nextBatchNumber = fillingBatch.batchNumber + 1;
      const nickname =
        nicknames.length > 0 ? nicknames.shift() : undefined;

      // Save remaining nicknames back
      if (nicknameSetting && nicknames.length >= 0) {
        await this.prisma.siteSetting.update({
          where: { key: 'auto_batch_nicknames' },
          data: { value: JSON.stringify(nicknames) },
        });
      }

      await this.prisma.batch.create({
        data: {
          batchNumber: nextBatchNumber,
          name: `${namingSequence} ${nextBatchNumber}`,
          nickname: nickname || null,
          capacity,
        },
      });

      this.logger.log(
        `Batch ${fillingBatch.batchNumber} filled. Auto-created batch ${nextBatchNumber}.`,
      );
      return { triggered: true, batchId: fillingBatch.id };
    }

    return { triggered: false };
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

    for (const applicant of applicants) {
      await this.emailService.sendTemplatedEmail(
        applicant.email,
        additionalQuestionIds.length > 0
          ? 'screening-questionnaire'
          : 'additional-instructions',
        {
          firstName: applicant.firstName,
          title,
          content,
          explanation: explanation || '',
          deadline: deadlineFormatted,
          batchNumber: String(batch.batchNumber),
          statusUrl: `${process.env.FRONTEND_URL || 'https://aryavartham.com'}/hub`,
        },
        applicant.id,
      );
    }

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

    // Remove non-responders
    await this.prisma.applicant.updateMany({
      where: { id: { in: nonResponders.map((a) => a.id) } },
      data: { status: ApplicantStatus.REMOVED, removedAt: new Date() },
    });

    this.logger.log(
      `Removed ${nonResponders.length} non-responders from batch ${batchId}`,
    );
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
