import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { SprintService } from './sprint.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { CreateMilestoneDto } from './dto/create-milestone.dto';

@Controller('sprints')
export class SprintController {
  constructor(private readonly sprintService: SprintService) {}

  @Post()
  createSprint(@Body() createSprintDto: CreateSprintDto) {
    return this.sprintService.createSprint(createSprintDto);
  }

  @Get('team/:teamId')
  getSprintByTeamId(@Param('teamId') teamId: string) {
    return this.sprintService.getSprintByTeamId(teamId);
  }

  @Post(':sprintId/milestones')
  createMilestone(@Param('sprintId') sprintId: string, @Body() createMilestoneDto: CreateMilestoneDto) {
    return this.sprintService.createMilestone(sprintId, createMilestoneDto);
  }

  @Post('milestones/bulk-common')
  createBulkCommonMilestone(@Body() createMilestoneDto: CreateMilestoneDto) {
    return this.sprintService.createBulkCommonMilestone(createMilestoneDto);
  }
}
