import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { CreateMilestoneDto } from './dto/create-milestone.dto';

@Injectable()
export class SprintService {
  constructor(private readonly prisma: PrismaService) {}

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

  async getSprintByTeamId(teamId: string, requesterId?: string, requesterRole?: string) {
    // Authorization: admins may view any team's sprint; everyone else may only
    // view their own team's sprint. Prevents cross-team data enumeration (IDOR).
    const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'].includes(requesterRole || '');
    if (!isAdmin) {
      const requester = await this.prisma.applicant.findUnique({
        where: { id: requesterId },
        select: { teamId: true },
      });
      if (!requester?.teamId || requester.teamId !== teamId) {
        throw new ForbiddenException("You can only view your own team's sprint");
      }
    }

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

  async createBulkCommonMilestone(createMilestoneDto: CreateMilestoneDto) {
    // Find all active sprints. Every existing SprintStatus (ON_TRACK, DELAYED,
    // TRAINING) is an active state, so common milestones must reach them all —
    // not just ON_TRACK.
    const activeSprints = await this.prisma.sprint.findMany({
      where: { status: { in: ['ON_TRACK', 'DELAYED', 'TRAINING'] } },
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
