import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'];

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProjectDto: CreateProjectDto) {
    return this.prisma.project.create({
      data: createProjectDto,
    });
  }

  async findByTeamId(teamId: string, requesterId: string, requesterRole?: string) {
    // Authorization: admins may view any team's project + ledger; everyone else
    // may only view the project for their own team. Prevents leaking the full
    // project and entire financial ledger to arbitrary callers.
    const isAdmin = ADMIN_ROLES.includes(requesterRole || '');
    if (!isAdmin) {
      const requester = await this.prisma.applicant.findUnique({
        where: { id: requesterId },
        select: { teamId: true },
      });
      if (!requester?.teamId || requester.teamId !== teamId) {
        throw new ForbiddenException('You can only view your own team\'s project');
      }
    }

    const project = await this.prisma.project.findUnique({
      where: { teamId },
      include: { ledger: { orderBy: { date: 'desc' } } },
    });
    if (!project) throw new NotFoundException('Project not found for this team');
    return project;
  }
}
