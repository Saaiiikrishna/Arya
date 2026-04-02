import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BatchService } from './batch.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('api')
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  // ─── Public endpoints ──────────────────────────────────
  @Get('batches/current')
  async getCurrentBatch() {
    return this.batchService.getCurrentFillingBatch();
  }

  @Get('batches/:batchNumber/status')
  async getBatchStatus(@Param('batchNumber') batchNumber: string) {
    return this.batchService.getPublicBatchStatus(parseInt(batchNumber, 10));
  }

  // ─── Admin endpoints ──────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('admin/batches')
  async findAll() {
    return this.batchService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/batches')
  async createBatch(
    @Body() body: { name: string; nickname?: string; capacity: number },
  ) {
    return this.batchService.createBatch(body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/batches/:id')
  async findOne(@Param('id') id: string) {
    return this.batchService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Put('admin/batches/:id')
  async updateBatch(
    @Param('id') id: string,
    @Body() body: { name?: string; nickname?: string; capacity?: number },
  ) {
    return this.batchService.updateBatch(id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Put('admin/batches/:id/transition')
  async transitionStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.batchService.transitionStatus(id, status as any);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/batches/:id/instructions')
  async sendInstructions(
    @Param('id') id: string,
    @Body()
    body: {
      title: string;
      content: string;
      additionalQuestionIds?: string[];
      explanation?: string;
      deadline?: string;
    },
  ) {
    return this.batchService.sendInstructions(
      id,
      body.title,
      body.content,
      body.additionalQuestionIds || [],
      body.explanation,
      body.deadline,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/batches/:id/remove-non-responders')
  async removeNonResponders(
    @Param('id') id: string,
    @Body('instructionId') instructionId: string,
  ) {
    return this.batchService.removeNonResponders(id, instructionId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/batches/:id/applicants')
  async getApplicants(@Param('id') id: string) {
    return this.batchService.getApplicantsForBatch(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/batches/:id/approve')
  async approveBatch(@Param('id') id: string) {
    return this.batchService.approveBatch(id);
  }
}
