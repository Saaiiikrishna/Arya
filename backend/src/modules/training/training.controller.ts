import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { TrainingService } from './training.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('api')
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  // ─── Admin ─────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('admin/training/modules')
  async createModule(@Body() data: any) {
    return this.trainingService.createModule(data);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('admin/training/modules/:id')
  async updateModule(@Param('id') id: string, @Body() data: any) {
    return this.trainingService.updateModule(id, data);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('admin/training/modules/:id')
  async deleteModule(@Param('id') id: string) {
    return this.trainingService.deleteModule(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/training/modules')
  async getModules(@Query('isActive') isActive?: string) {
    return this.trainingService.getModules(
      isActive ? isActive === 'true' : undefined,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/training/modules/:id')
  async getModule(@Param('id') id: string) {
    return this.trainingService.getModuleById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/training/assign')
  async assign(
    @Body('applicantId') applicantId: string,
    @Body('moduleId') moduleId: string,
  ) {
    return this.trainingService.assignToApplicant(applicantId, moduleId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/training/assign-bulk')
  async assignBulk(
    @Body('applicantIds') applicantIds: string[],
    @Body('moduleId') moduleId: string,
  ) {
    return this.trainingService.assignToMultiple(applicantIds, moduleId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/training/stats')
  async getStats() {
    return this.trainingService.getTrainingStats();
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/training/assignments/:moduleId')
  async getModuleAssignments(@Param('moduleId') moduleId: string) {
    return this.trainingService.getAssignmentsForModule(moduleId);
  }

  // ─── Applicant ─────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('training/my-assignments')
  async getMyAssignments(@Query('applicantId') applicantId: string) {
    return this.trainingService.getAssignmentsForApplicant(applicantId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('training/assignments/:id/complete')
  async markComplete(
    @Param('id') id: string,
    @Body('score') score?: number,
  ) {
    return this.trainingService.markCompleted(id, score);
  }
}
