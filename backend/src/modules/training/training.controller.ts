import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Req,
} from '@nestjs/common';
import { TrainingService } from './training.service';
import { JwtAuthGuard, AdminGuard } from '../auth/guards';

@Controller('api')
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  // ─── Admin ─────────────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/training/modules')
  async createModule(@Body() data: any) {
    return this.trainingService.createModule(data);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/training/modules/:id')
  async updateModule(@Param('id') id: string, @Body() data: any) {
    return this.trainingService.updateModule(id, data);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/training/modules/:id')
  async deleteModule(@Param('id') id: string) {
    return this.trainingService.deleteModule(id);
  }

  @UseGuards(AdminGuard)
  @Get('admin/training/modules')
  async getModules(@Query('isActive') isActive?: string) {
    return this.trainingService.getModules(
      isActive ? isActive === 'true' : undefined,
    );
  }

  @UseGuards(AdminGuard)
  @Get('admin/training/modules/:id')
  async getModule(@Param('id') id: string) {
    return this.trainingService.getModuleById(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/training/assign')
  async assign(
    @Body('applicantId') applicantId: string,
    @Body('moduleId') moduleId: string,
  ) {
    return this.trainingService.assignToApplicant(applicantId, moduleId);
  }

  @UseGuards(AdminGuard)
  @Post('admin/training/assign-bulk')
  async assignBulk(
    @Body('applicantIds') applicantIds: string[],
    @Body('moduleId') moduleId: string,
  ) {
    return this.trainingService.assignToMultiple(applicantIds, moduleId);
  }

  @UseGuards(AdminGuard)
  @Get('admin/training/stats')
  async getStats() {
    return this.trainingService.getTrainingStats();
  }

  @UseGuards(AdminGuard)
  @Get('admin/training/assignments/:moduleId')
  async getModuleAssignments(@Param('moduleId') moduleId: string) {
    return this.trainingService.getAssignmentsForModule(moduleId);
  }

  // ─── Applicant ─────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('training/my-assignments')
  async getMyAssignments(@Req() req: any) {
    const applicantId = req.user.id || req.user.sub;
    return this.trainingService.getAssignmentsForApplicant(applicantId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('training/assignments/:id/complete')
  async markComplete(
    @Param('id') id: string,
    @Req() req: any,
    @Body('score') score?: number,
  ) {
    const callerId = req.user.id || req.user.sub;
    return this.trainingService.markCompleted(id, score, callerId);
  }
}
