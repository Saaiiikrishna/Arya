import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { BatchStatus, ApplicantStatus } from '@prisma/client';

@Injectable()
export class BatchService {
  private readonly logger = new Logger(BatchService.name);

  constructor(private readonly prisma: PrismaService) {}

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
              select: { id: true, firstName: true, lastName: true, email: true, status: true },
            },
          },
        },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  async checkAndCreateBatch(): Promise<{ triggered: boolean; batchId?: string }> {
    // Find the FILLING batch
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

      // Create next batch for new applicants
      await this.prisma.batch.create({
        data: { batchNumber: fillingBatch.batchNumber + 1 },
      });

      this.logger.log(`Batch ${fillingBatch.batchNumber} filled. Moving to SCREENING.`);
      return { triggered: true, batchId: fillingBatch.id };
    }

    return { triggered: false };
  }

  async transitionStatus(id: string, newStatus: BatchStatus) {
    const batch = await this.prisma.batch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('Batch not found');

    // Validate state transitions
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
    if (newStatus === BatchStatus.FINALIZED) updateData.finalizedAt = new Date();
    if (newStatus === BatchStatus.PRODUCTION) updateData.productionAt = new Date();

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
  ) {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const instruction = await this.prisma.batchInstruction.create({
      data: {
        batchId,
        title,
        content,
        additionalQuestionIds,
      },
    });

    this.logger.log(`Instructions sent to batch ${batch.batchNumber}: ${title}`);
    return instruction;
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

    // Check all applicants have consented
    const unconsentedCount = await this.prisma.applicant.count({
      where: { batchId: id, status: { not: 'REMOVED' }, consentGiven: false },
    });

    if (unconsentedCount > 0) {
      throw new BadRequestException(
        `${unconsentedCount} applicant(s) have not given consent yet`,
      );
    }

    // Finalize all non-removed applicants
    await this.prisma.applicant.updateMany({
      where: { batchId: id, status: { not: 'REMOVED' } },
      data: { status: ApplicantStatus.FINALIZED },
    });

    return this.transitionStatus(id, BatchStatus.PRODUCTION);
  }

  // Public: batch status for waitlisted users
  async getPublicBatchStatus(batchNumber: number) {
    const batch = await this.prisma.batch.findUnique({
      where: { batchNumber },
      select: {
        batchNumber: true,
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
