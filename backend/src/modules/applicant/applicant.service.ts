import { Injectable, ConflictException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { ApplyDto, SubmitAdditionalAnswersDto } from './dto';
import { v4 as uuidv4 } from 'uuid';
import { ApplicantStatus, PhaseTag } from '@prisma/client';

@Injectable()
export class ApplicantService {
  private readonly logger = new Logger(ApplicantService.name);

  constructor(private readonly prisma: PrismaService) {}

  async apply(dto: ApplyDto) {
    // Check if email already exists
    const existing = await this.prisma.applicant.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('An application with this email already exists');
    }

    // Find the current filling batch or create one
    let batch = await this.prisma.batch.findFirst({
      where: { status: 'FILLING' },
      orderBy: { batchNumber: 'asc' },
    });

    if (!batch) {
      const lastBatch = await this.prisma.batch.findFirst({
        orderBy: { batchNumber: 'desc' },
      });
      batch = await this.prisma.batch.create({
        data: { batchNumber: (lastBatch?.batchNumber ?? 0) + 1 },
      });
    }

    const accessToken = uuidv4();

    // Create applicant with answers in a transaction
    const applicant = await this.prisma.$transaction(async (tx) => {
      const newApplicant = await tx.applicant.create({
        data: {
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          batchId: batch!.id,
          accessToken,
        },
      });

      // Save answers
      if (dto.answers.length > 0) {
        await tx.answer.createMany({
          data: dto.answers.map((a) => ({
            applicantId: newApplicant.id,
            questionId: a.questionId,
            value: a.value,
            phaseTag: PhaseTag.INITIAL,
          })),
        });
      }

      // Increment batch count
      await tx.batch.update({
        where: { id: batch!.id },
        data: { currentCount: { increment: 1 } },
      });

      return newApplicant;
    });

    this.logger.log(`New applicant registered: ${dto.email} in batch ${batch.batchNumber}`);

    return {
      id: applicant.id,
      email: applicant.email,
      firstName: applicant.firstName,
      lastName: applicant.lastName,
      batchNumber: batch.batchNumber,
      accessToken: applicant.accessToken,
    };
  }

  async findByAccessToken(accessToken: string) {
    const applicant = await this.prisma.applicant.findUnique({
      where: { accessToken },
      include: {
        batch: { select: { batchNumber: true, status: true } },
        team: { select: { id: true, name: true } },
        answers: { include: { question: { select: { label: true, type: true } } } },
      },
    });
    if (!applicant) throw new NotFoundException('Applicant not found');
    return applicant;
  }

  async submitAdditionalAnswers(accessToken: string, dto: SubmitAdditionalAnswersDto) {
    const applicant = await this.prisma.applicant.findUnique({
      where: { accessToken },
    });
    if (!applicant) throw new NotFoundException('Applicant not found');

    await this.prisma.answer.createMany({
      data: dto.answers.map((a) => ({
        applicantId: applicant.id,
        questionId: a.questionId,
        value: a.value,
        phaseTag: PhaseTag.ADDITIONAL,
      })),
      skipDuplicates: true,
    });

    return { success: true };
  }

  async submitDossier(applicantId: string, data: any) {
    // Check if applicantId is a valid UUID to avoid Prisma crash
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(applicantId)) {
      throw new BadRequestException('Invalid applicant ID format');
    }

    const applicant = await this.prisma.applicant.findUnique({
      where: { id: applicantId },
    });
    
    if (!applicant) {
      throw new NotFoundException('Applicant not found');
    }

    // Safe parseInt that returns null instead of NaN
    const safeInt = (val: any): number | null => {
      if (val === null || val === undefined || val === '') return null;
      const n = typeof val === 'number' ? val : parseInt(String(val));
      return isNaN(n) ? null : n;
    };

    // Update applicant with all dossier fields (multi-step form data)
    const updated = await this.prisma.applicant.update({
      where: { id: applicantId },
      data: {
        // Step 1: Personal Info
        ...(data.firstName && { firstName: data.firstName }),
        ...(data.lastName && { lastName: data.lastName }),
        ...(data.phone && { phone: data.phone }),
        ...(data.city && { city: data.city }),
        ...(safeInt(data.age) !== null && { age: safeInt(data.age) }),
        // Step 4: Creative Assessment
        ...(data.vocation && { vocation: data.vocation }),
        ...(data.obsession && { obsession: data.obsession }),
        ...(data.heresy && { heresy: data.heresy }),
        ...(data.scarTissue && { scarTissue: data.scarTissue }),
        // Step 5: Agreement
        ...(data.agreementAccepted !== undefined && { agreementAccepted: data.agreementAccepted }),
      } as any,
    });

    // Upsert MatchingProfile with skills/commitment/idea data (Step 2 & 3)
    if (data.skills || data.commitmentLevel || data.ideaCategory || data.hasIdea !== undefined) {
      try {
        await this.prisma.matchingProfile.upsert({
          where: { applicantId },
          create: {
            applicantId,
            skills: data.skills || [],
            commitmentLevel: data.commitmentLevel || 'FLEXIBLE',
            hoursPerDay: safeInt(data.hoursPerDay),
            experienceYears: safeInt(data.experienceYears),
            hasIdea: data.hasIdea || false,
            ideaSummary: data.ideaSummary || null,
            ideaCategory: data.ideaCategory || null,
          },
          update: {
            ...(data.skills && { skills: data.skills }),
            ...(data.commitmentLevel && { commitmentLevel: data.commitmentLevel }),
            ...(safeInt(data.hoursPerDay) !== null && { hoursPerDay: safeInt(data.hoursPerDay) }),
            ...(safeInt(data.experienceYears) !== null && { experienceYears: safeInt(data.experienceYears) }),
            ...(data.hasIdea !== undefined && { hasIdea: data.hasIdea }),
            ...(data.ideaSummary !== undefined && { ideaSummary: data.ideaSummary }),
            ...(data.ideaCategory !== undefined && { ideaCategory: data.ideaCategory || null }),
          },
        });
      } catch (profileError) {
        console.error('[submitDossier] MatchingProfile upsert error:', profileError);
        // Don't fail the entire submission for matching profile issues
      }
    }

    return updated;
  }

  async giveConsent(accessToken: string, consentDocUrl?: string) {
    const applicant = await this.prisma.applicant.findUnique({
      where: { accessToken },
    });
    if (!applicant) throw new NotFoundException('Applicant not found');

    return this.prisma.applicant.update({
      where: { id: applicant.id },
      data: {
        consentGiven: true,
        consentDocUrl,
        status: ApplicantStatus.CONSENTED,
      },
    });
  }

  // ─── Admin endpoints ─────────────────────────────────

  async findAll(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: ApplicantStatus;
    batchId?: string;
  }) {
    const { page = 1, limit = 20, search, status, batchId } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (batchId) where.batchId = batchId;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [applicants, total] = await Promise.all([
      this.prisma.applicant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { appliedAt: 'desc' },
        include: {
          batch: { select: { batchNumber: true, status: true } },
          team: { select: { id: true, name: true } },
          matchingProfile: { select: { skills: true, commitmentLevel: true, hoursPerDay: true, hasIdea: true, ideaCategory: true, ideaSummary: true } },
        },
      }),
      this.prisma.applicant.count({ where }),
    ]);

    return {
      data: applicants,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOneAdmin(id: string) {
    const applicant = await this.prisma.applicant.findUnique({
      where: { id },
      include: {
        batch: true,
        team: true,
        answers: {
          include: { question: true },
          orderBy: { answeredAt: 'asc' },
        },
        documents: true,
        notifications: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!applicant) throw new NotFoundException('Applicant not found');
    return applicant;
  }

  async removeApplicant(id: string) {
    const applicant = await this.prisma.applicant.findUnique({
      where: { id },
      include: { batch: true },
    });
    if (!applicant) throw new NotFoundException('Applicant not found');

    await this.prisma.$transaction(async (tx) => {
      // Mark as removed
      await tx.applicant.update({
        where: { id },
        data: {
          status: ApplicantStatus.REMOVED,
          teamId: null,
          removedAt: new Date(),
        },
      });

      // Decrement batch count
      if (applicant.batchId) {
        await tx.batch.update({
          where: { id: applicant.batchId },
          data: { currentCount: { decrement: 1 } },
        });
      }
    });

    return {
      removedApplicantId: id,
      batchId: applicant.batchId,
      message: 'Applicant removed. Backfill job will be triggered.',
    };
  }

  async getDashboardStats() {
    const [
      totalApplicants,
      pendingCount,
      eligibleCount,
      activeCount,
      removedCount,
      heldCount,
      totalBatches,
      activeBatch,
    ] = await Promise.all([
      this.prisma.applicant.count(),
      this.prisma.applicant.count({ where: { status: 'PENDING' } }),
      this.prisma.applicant.count({ where: { status: 'ELIGIBLE' } }),
      this.prisma.applicant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.applicant.count({ where: { status: 'REMOVED' } }),
      this.prisma.applicant.count({ where: { status: 'HELD' as any } }),
      this.prisma.batch.count(),
      this.prisma.batch.findFirst({
        where: { status: { not: 'PRODUCTION' } },
        orderBy: { batchNumber: 'asc' },
        include: { _count: { select: { teams: true, applicants: true } } },
      }),
    ]);

    return {
      totalApplicants,
      statusBreakdown: {
        pending: pendingCount,
        eligible: eligibleCount,
        active: activeCount,
        removed: removedCount,
        held: heldCount,
      },
      totalBatches,
      activeBatch: activeBatch
        ? {
            id: activeBatch.id,
            batchNumber: activeBatch.batchNumber,
            status: activeBatch.status,
            currentCount: activeBatch.currentCount,
            capacity: activeBatch.capacity,
            teamCount: activeBatch._count.teams,
          }
        : null,
    };
  }

  // ─── Admin Status Actions ────────────────────────

  async updateApplicantStatus(id: string, status: ApplicantStatus) {
    const applicant = await this.prisma.applicant.findUnique({
      where: { id },
    });
    if (!applicant) throw new NotFoundException('Applicant not found');

    const validStatuses: ApplicantStatus[] = [
      'PENDING', 'ELIGIBLE', 'INELIGIBLE', 'ACTIVE', 'REMOVED', 'HELD' as any,
    ];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }

    const updated = await this.prisma.applicant.update({
      where: { id },
      data: {
        status,
        ...(status === ('REMOVED' as any) && { removedAt: new Date(), teamId: null }),
        ...(status === ('HELD' as any) && { movedAt: new Date() }),
      } as any,
    });

    // If removing, decrement batch count
    if (status === ('REMOVED' as any) && applicant.batchId) {
      await this.prisma.batch.update({
        where: { id: applicant.batchId },
        data: { currentCount: { decrement: 1 } },
      });
    }

    this.logger.log(`Applicant ${id} status changed to ${status}`);
    return updated;
  }
}
