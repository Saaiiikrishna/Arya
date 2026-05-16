import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { QuestionService } from './question.service';
import { CreateQuestionDto, UpdateQuestionDto, ReorderQuestionsDto } from './dto';
import { AdminGuard } from '../auth/guards';
import { PhaseTag } from '@prisma/client';

@Controller('api')
export class QuestionController {
  constructor(private readonly questionService: QuestionService) {}

  // ─── Public ────────────────────────────────────────
  @Get('questions/public')
  async getPublicQuestions(@Query('phase') phase?: PhaseTag) {
    return this.questionService.getPublicQuestions(phase);
  }

  // ─── Admin ─────────────────────────────────────────
  @UseGuards(AdminGuard)
  @Post('admin/questions')
  async create(@Body() dto: CreateQuestionDto) {
    return this.questionService.create(dto);
  }

  @UseGuards(AdminGuard)
  @Get('admin/questions')
  async findAll(
    @Query('phase') phase?: PhaseTag,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.questionService.findAll(phase, activeOnly !== 'false');
  }

  @UseGuards(AdminGuard)
  @Get('admin/questions/:id')
  async findOne(@Param('id') id: string) {
    return this.questionService.findOne(id);
  }

  @UseGuards(AdminGuard)
  @Put('admin/questions/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateQuestionDto) {
    return this.questionService.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/questions/:id')
  async remove(@Param('id') id: string) {
    return this.questionService.remove(id);
  }

  @UseGuards(AdminGuard)
  @Put('admin/questions/reorder')
  async reorder(@Body() dto: ReorderQuestionsDto) {
    return this.questionService.reorder(dto);
  }
}
