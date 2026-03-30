import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';

@Injectable()
export class TrainingService {
  private readonly logger = new Logger(TrainingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Module CRUD ─────────────────────────────────────

  async createModule(data: {
    title: string;
    description?: string;
    content: string;
    category?: string;
    durationMin?: number;
    sortOrder?: number;
  }) {
    return this.prisma.trainingModule.create({ data });
  }

  async updateModule(id: string, data: any) {
    return this.prisma.trainingModule.update({ where: { id }, data });
  }

  async getModules(isActive?: boolean) {
    return this.prisma.trainingModule.findMany({
      where: isActive !== undefined ? { isActive } : {},
      include: { _count: { select: { assignments: true } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getModuleById(id: string) {
    const mod = await this.prisma.trainingModule.findUnique({
      where: { id },
      include: { assignments: { orderBy: { assignedAt: 'desc' } } },
    });
    if (!mod) throw new NotFoundException('Training module not found');
    return mod;
  }

  async deleteModule(id: string) {
    return this.prisma.trainingModule.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ─── Assignments ─────────────────────────────────────

  async assignToApplicant(applicantId: string, moduleId: string) {
    return this.prisma.trainingAssignment.upsert({
      where: { applicantId_moduleId: { applicantId, moduleId } },
      create: { applicantId, moduleId },
      update: { completedAt: null, score: null }, // Re-assign
    });
  }

  async assignToMultiple(applicantIds: string[], moduleId: string) {
    const data = applicantIds.map(applicantId => ({ applicantId, moduleId }));
    return this.prisma.trainingAssignment.createMany({
      data,
      skipDuplicates: true,
    });
  }

  async markCompleted(assignmentId: string, score?: number) {
    return this.prisma.trainingAssignment.update({
      where: { id: assignmentId },
      data: { completedAt: new Date(), score },
    });
  }

  async getAssignmentsForApplicant(applicantId: string) {
    return this.prisma.trainingAssignment.findMany({
      where: { applicantId },
      include: { module: true },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async getAssignmentsForModule(moduleId: string) {
    return this.prisma.trainingAssignment.findMany({
      where: { moduleId },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async getTrainingStats() {
    const [totalModules, totalAssignments, completedAssignments, avgScore] = await Promise.all([
      this.prisma.trainingModule.count({ where: { isActive: true } }),
      this.prisma.trainingAssignment.count(),
      this.prisma.trainingAssignment.count({ where: { completedAt: { not: null } } }),
      this.prisma.trainingAssignment.aggregate({
        where: { score: { not: null } },
        _avg: { score: true },
      }),
    ]);

    return {
      totalModules,
      totalAssignments,
      completedAssignments,
      completionRate: totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0,
      avgScore: avgScore._avg.score ? Math.round(avgScore._avg.score) : null,
    };
  }
}
