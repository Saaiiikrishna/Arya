import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProjectDto: CreateProjectDto) {
    return this.prisma.project.create({
      data: createProjectDto,
    });
  }

  async findByTeamId(teamId: string) {
    const project = await this.prisma.project.findUnique({
      where: { teamId },
      include: { ledger: { orderBy: { date: 'desc' } } },
    });
    if (!project) throw new NotFoundException('Project not found for this team');
    return project;
  }
}
