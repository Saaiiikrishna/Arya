import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { BatchService } from './batch.service';
import { JwtAuthGuard } from '../auth/guards';
import { BatchStatus } from '@prisma/client';

@Controller('api')
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  // ─── Public ────────────────────────────────────────
  @Get('batches/:batchNumber/status')
  async getPublicStatus(@Param('batchNumber') batchNumber: string) {
    return this.batchService.getPublicBatchStatus(parseInt(batchNumber));
  }

  // ─── Admin ─────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('admin/batches')
  async findAll() {
    return this.batchService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/batches/:id')
  async findOne(@Param('id') id: string) {
    return this.batchService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/batches/:id/applicants')
  async getApplicants(@Param('id') id: string) {
    return this.batchService.getApplicantsForBatch(id);
  }

  @UseGuards(JwtAuthGuard)
  @Put('admin/batches/:id/status')
  async transitionStatus(
    @Param('id') id: string,
    @Body('status') status: BatchStatus,
  ) {
    return this.batchService.transitionStatus(id, status);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/batches/:id/instructions')
  async sendInstructions(
    @Param('id') id: string,
    @Body() body: { title: string; content: string; additionalQuestionIds?: string[] },
  ) {
    return this.batchService.sendInstructions(
      id,
      body.title,
      body.content,
      body.additionalQuestionIds,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/batches/:id/approve')
  async approve(@Param('id') id: string) {
    return this.batchService.approveBatch(id);
  }
}
