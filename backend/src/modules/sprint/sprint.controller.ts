import { Controller, Post, Get, Patch, Body, Param, Req, UseGuards, Query } from '@nestjs/common';
import { SprintService } from './sprint.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@Controller('api')
export class SprintController {
  constructor(private readonly sprintService: SprintService) {}

  // ─── Admin sprint management ──────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/sprints')
  createSprint(@Body() createSprintDto: CreateSprintDto) {
    return this.sprintService.createSprint(createSprintDto);
  }

  @UseGuards(AdminGuard)
  @Get('admin/sprints/team/:teamId')
  getSprintByTeamId(@Param('teamId') teamId: string) {
    return this.sprintService.getSprintByTeamId(teamId);
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
  @Get('admin/sprints/checkins/status')
  getCheckInStatus(@Query('batchId') batchId: string, @Query('week') week?: string) {
    return this.sprintService.getCheckInStatusByBatch(batchId, week ? Number(week) : undefined);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('sprints/milestones/:milestoneId/complete')
  completeMilestone(@Req() req: any, @Param('milestoneId') milestoneId: string) {
    return this.sprintService.completeMilestone(milestoneId, req.user.id ?? req.user.sub);
  }

  // ─── Hub: founder sprint dashboard ───────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('sprints/my/dashboard')
  getMyDashboard(@Req() req: any) {
    return this.sprintService.getMySprintDashboard(req.user.id ?? req.user.sub);
  }

  // ─── Blocker log ──────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('sprints/teams/:teamId/blockers')
  logBlocker(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Body() body: { week: number; description: string; severity?: string },
  ) {
    return this.sprintService.logBlocker(teamId, req.user.id ?? req.user.sub, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('sprints/blockers/:blockerId/resolve')
  resolveBlocker(@Req() req: any, @Param('blockerId') blockerId: string) {
    return this.sprintService.resolveBlocker(blockerId, req.user.id ?? req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sprints/teams/:teamId/blockers')
  getBlockers(@Param('teamId') teamId: string, @Query('resolved') resolved?: string) {
    const resolvedBool = resolved === undefined ? undefined : resolved === 'true';
    return this.sprintService.getBlockers(teamId, resolvedBool);
  }

  // ─── Weekly check-in ─────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('sprints/teams/:teamId/checkins')
  submitCheckIn(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Body() body: { week: number; progressSummary: string },
  ) {
    return this.sprintService.submitCheckIn(teamId, req.user.id ?? req.user.sub, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('sprints/checkins/:checkInId/verify')
  verifyCheckIn(@Req() req: any, @Param('checkInId') checkInId: string) {
    return this.sprintService.verifyCheckIn(checkInId, req.user.id ?? req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sprints/teams/:teamId/checkins')
  getCheckIns(@Param('teamId') teamId: string) {
    return this.sprintService.getCheckIns(teamId);
  }
}
