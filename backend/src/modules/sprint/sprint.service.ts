import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { CreateMilestoneDto } from './dto/create-milestone.dto';

@Injectable()
export class SprintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async createSprint(createSprintDto: CreateSprintDto) {
    const { teamId, title, startDate, endDate } = createSprintDto;
    return this.prisma.sprint.create({
      data: {
        teamId,
        startDate,
        endDate,
      },
      include: { milestones: true },
    });
  }

  async getSprintByTeamId(teamId: string) {
    const sprint = await this.prisma.sprint.findFirst({
      where: { teamId },
      include: { milestones: { orderBy: { deadline: 'asc' } } },
    });
    if (!sprint) {
      throw new NotFoundException(`No sprint found for team ${teamId}`);
    }
    return sprint;
  }

  async createMilestone(sprintId: string, createMilestoneDto: CreateMilestoneDto) {
    const sprint = await this.prisma.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint) throw new NotFoundException('Sprint not found');

    return this.prisma.milestone.create({
      data: {
        sprintId,
        title: createMilestoneDto.title,
        description: createMilestoneDto.description,
        deadline: createMilestoneDto.deadline,
        type: createMilestoneDto.type || 'CUSTOM',
      },
    });
  }

  // ─── Blocker Log ─────────────────────────────────────────

  async logBlocker(teamId: string, callerId: string, dto: { week: number; description: string; severity?: string }) {
    const applicant = await this.prisma.applicant.findUnique({ where: { id: callerId } });
    if (!applicant || applicant.teamId !== teamId) throw new ForbiddenException('You are not in this team');

    return (this.prisma as any).blockerLog.create({
      data: { teamId, week: dto.week, description: dto.description, severity: dto.severity ?? 'MED' },
    });
  }

  async resolveBlocker(blockerId: string, callerId: string) {
    const blocker = await (this.prisma as any).blockerLog.findUnique({ where: { id: blockerId } });
    if (!blocker) throw new NotFoundException('Blocker not found');

    // Verify caller is in the team
    const applicant = await this.prisma.applicant.findUnique({ where: { id: callerId } });
    if (!applicant || applicant.teamId !== blocker.teamId) throw new ForbiddenException('You are not in this team');

    return (this.prisma as any).blockerLog.update({
      where: { id: blockerId },
      data: { isResolved: true, resolvedAt: new Date() },
    });
  }

  async getBlockers(teamId: string, resolved?: boolean) {
    const where: any = { teamId };
    if (resolved !== undefined) where.isResolved = resolved;
    return (this.prisma as any).blockerLog.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  // ─── Weekly Check-in ──────────────────────────────────────

  async submitCheckIn(teamId: string, callerId: string, dto: { week: number; progressSummary: string }) {
    const applicant = await this.prisma.applicant.findUnique({ where: { id: callerId } });
    if (!applicant || applicant.teamId !== teamId) throw new ForbiddenException('You are not in this team');

    return (this.prisma as any).weeklyCheckIn.upsert({
      where: { teamId_week: { teamId, week: dto.week } },
      create: { teamId, week: dto.week, progressSummary: dto.progressSummary },
      update: { progressSummary: dto.progressSummary },
    });
  }

  async verifyCheckIn(checkInId: string, coFounderId: string) {
    return (this.prisma as any).weeklyCheckIn.update({
      where: { id: checkInId },
      data: { coFounderVerified: true, verifiedAt: new Date(), verifiedById: coFounderId },
    });
  }

  async getCheckIns(teamId: string) {
    return (this.prisma as any).weeklyCheckIn.findMany({
      where: { teamId },
      orderBy: { week: 'desc' },
    });
  }

  // ─── Hub: current sprint view ─────────────────────────────

  async getMySprintDashboard(applicantId: string) {
    const applicant = await this.prisma.applicant.findUnique({ where: { id: applicantId }, select: { teamId: true } });
    if (!applicant?.teamId) throw new NotFoundException('You are not in a team');

    const teamId = applicant.teamId;
    const [sprint, blockers, checkIns] = await Promise.all([
      this.prisma.sprint.findFirst({
        where: { teamId },
        include: { milestones: { orderBy: { deadline: 'asc' } } },
        orderBy: { startDate: 'desc' },
      }),
      (this.prisma as any).blockerLog.findMany({ where: { teamId, isResolved: false }, orderBy: { createdAt: 'desc' } }),
      (this.prisma as any).weeklyCheckIn.findMany({ where: { teamId }, orderBy: { week: 'desc' }, take: 4 }),
    ]);

    return { sprint, blockers, checkIns };
  }

  async completeMilestone(milestoneId: string, callerId: string) {
    const milestone = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: { sprint: { select: { teamId: true, id: true } } },
    });
    if (!milestone) throw new NotFoundException('Milestone not found');

    const teamId = milestone.sprint.teamId;
    const applicant = await this.prisma.applicant.findUnique({ where: { id: callerId } });
    if (!applicant || applicant.teamId !== teamId) throw new ForbiddenException('You are not in this team');

    const updated = await this.prisma.milestone.update({
      where: { id: milestoneId },
      data: { isCompleted: true, completedAt: new Date() },
    });

    // Check if all milestones in the sprint are now complete → MVP done → email team
    const remaining = await this.prisma.milestone.count({
      where: { sprintId: milestone.sprintId, isCompleted: false },
    });

    if (remaining === 0) {
      const members = await this.prisma.applicant.findMany({
        where: { teamId, status: { not: 'REMOVED' } },
        select: { id: true, email: true, firstName: true },
      });
      const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { name: true } });

      await Promise.allSettled(
        members.map((m) =>
          this.emailService.sendTemplatedEmail(
            m.email,
            'mvp-complete',
            { firstName: m.firstName, teamName: team?.name ?? 'your team' },
            m.id,
          ),
        ),
      );
    }

    return updated;
  }

  /**
   * Returns all locked teams in a batch with their check-in status for a given week.
   * If week is not provided, uses the maximum week number found across all check-ins in the batch.
   */
  async getCheckInStatusByBatch(batchId: string, week?: number) {
    const teams = await this.prisma.team.findMany({
      where: { batchId, isLocked: true },
      select: { id: true, name: true, memberCount: true },
      orderBy: { name: 'asc' },
    });

    if (teams.length === 0) return { week: week ?? 0, teams: [] };

    const teamIds = teams.map((t) => t.id);

    // Determine the week to report on
    let reportWeek = week;
    if (!reportWeek) {
      const latest = await (this.prisma as any).weeklyCheckIn.findFirst({
        where: { teamId: { in: teamIds } },
        orderBy: { week: 'desc' },
        select: { week: true },
      });
      reportWeek = latest?.week ?? 1;
    }

    const checkIns = await (this.prisma as any).weeklyCheckIn.findMany({
      where: { teamId: { in: teamIds }, week: reportWeek },
      select: { teamId: true, week: true, progressSummary: true, coFounderVerified: true, submittedAt: true },
    });

    const checkInMap = new Map(checkIns.map((c: any) => [c.teamId, c]));

    return {
      week: reportWeek,
      teams: teams.map((team) => ({
        ...team,
        checkIn: checkInMap.get(team.id) ?? null,
        submitted: checkInMap.has(team.id),
      })),
    };
  }

  async createBulkCommonMilestone(createMilestoneDto: CreateMilestoneDto) {
    // Find all active sprints
    const activeSprints = await this.prisma.sprint.findMany({
      where: { status: 'ON_TRACK' },
    });

    const milestonesData = activeSprints.map(s => ({
      sprintId: s.id,
      title: createMilestoneDto.title,
      description: createMilestoneDto.description,
      deadline: createMilestoneDto.deadline,
      type: 'COMMON' as const,
    }));

    return this.prisma.milestone.createMany({
      data: milestonesData,
      skipDuplicates: true,
    });
  }
}
