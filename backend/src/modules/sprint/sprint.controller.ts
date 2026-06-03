import { Controller, Post, Get, Body, Param, UseGuards, Req } from '@nestjs/common';
import { SprintService } from './sprint.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { AdminGuard, JwtAuthGuard } from '../auth/guards';

@Controller('sprints')
export class SprintController {
  constructor(private readonly sprintService: SprintService) {}

  @UseGuards(AdminGuard)
  @Post()
  createSprint(@Body() createSprintDto: CreateSprintDto) {
    return this.sprintService.createSprint(createSprintDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('team/:teamId')
  getSprintByTeamId(@Param('teamId') teamId: string, @Req() req: any) {
    const requesterId = req.user?.id || req.user?.sub;
    return this.sprintService.getSprintByTeamId(teamId, requesterId, req.user?.role);
  }

  @UseGuards(AdminGuard)
  @Post(':sprintId/milestones')
  createMilestone(@Param('sprintId') sprintId: string, @Body() createMilestoneDto: CreateMilestoneDto) {
    return this.sprintService.createMilestone(sprintId, createMilestoneDto);
  }

  @UseGuards(AdminGuard)
  @Post('milestones/bulk-common')
  createBulkCommonMilestone(@Body() createMilestoneDto: CreateMilestoneDto) {
    return this.sprintService.createBulkCommonMilestone(createMilestoneDto);
  }
}
