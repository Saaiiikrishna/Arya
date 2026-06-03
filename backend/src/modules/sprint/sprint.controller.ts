import { Controller, Post, Get, Patch, Body, Param, UseGuards, Req } from '@nestjs/common';
import { SprintService } from './sprint.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { AdminGuard, JwtAuthGuard } from '../auth/guards';

// Base 'api' so every route resolves under /api (the frontend client base is
// http://localhost:3001/api), matching the team/equity controllers.
@Controller('api')
export class SprintController {
  constructor(private readonly sprintService: SprintService) {}

  @UseGuards(AdminGuard)
  @Post('admin/sprints')
  createSprint(@Body() createSprintDto: CreateSprintDto) {
    return this.sprintService.createSprint(createSprintDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sprints/team/:teamId')
  getSprintByTeamId(@Param('teamId') teamId: string, @Req() req: any) {
    const requesterId = req.user?.id || req.user?.sub;
    return this.sprintService.getSprintByTeamId(teamId, requesterId, req.user?.role);
  }

  @UseGuards(AdminGuard)
  @Post('admin/sprints/:sprintId/milestones')
  createMilestone(@Param('sprintId') sprintId: string, @Body() createMilestoneDto: CreateMilestoneDto) {
    return this.sprintService.createMilestone(sprintId, createMilestoneDto);
  }

  @UseGuards(AdminGuard)
  @Post('admin/sprints/milestones/bulk-common')
  createBulkCommonMilestone(@Body() createMilestoneDto: CreateMilestoneDto) {
    return this.sprintService.createBulkCommonMilestone(createMilestoneDto);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/sprints/:sprintId/complete')
  completeSprint(@Param('sprintId') sprintId: string, @Req() req: any) {
    const adminId = req.user?.id || req.user?.sub;
    return this.sprintService.completeSprint(sprintId, adminId);
  }
}
