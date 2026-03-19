import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { CreateQuestionDto, UpdateQuestionDto, ReorderQuestionsDto } from './dto';
import { PhaseTag } from '@prisma/client';

@Injectable()
export class QuestionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateQuestionDto) {
    // Auto-set sortOrder to next position if not provided
    if (dto.sortOrder === undefined) {
      const lastQuestion = await this.prisma.question.findFirst({
        orderBy: { sortOrder: 'desc' },
      });
      dto.sortOrder = (lastQuestion?.sortOrder ?? 0) + 1;
    }

    return this.prisma.question.create({ data: dto });
  }

  async findAll(phaseTag?: PhaseTag, activeOnly = true) {
    return this.prisma.question.findMany({
      where: {
        ...(phaseTag && { phaseTag }),
        ...(activeOnly && { isActive: true }),
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOne(id: string) {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: { eligibilityCriteria: true },
    });
    if (!question) throw new NotFoundException('Question not found');
    return question;
  }

  async update(id: string, dto: UpdateQuestionDto) {
    await this.findOne(id);
    return this.prisma.question.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.question.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async reorder(dto: ReorderQuestionsDto) {
    const updates = dto.items.map((item) =>
      this.prisma.question.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder },
      }),
    );
    await this.prisma.$transaction(updates);
    return { success: true };
  }

  async getPublicQuestions(phaseTag: PhaseTag = PhaseTag.INITIAL) {
    return this.prisma.question.findMany({
      where: { isActive: true, phaseTag },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        label: true,
        helpText: true,
        type: true,
        options: true,
        isRequired: true,
        category: true,
        validation: true,
      },
    });
  }
}
