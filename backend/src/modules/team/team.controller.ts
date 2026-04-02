import { Controller, Get, Post, Patch, Param, Body, UseGuards, Req, Query } from '@nestjs/common';
import { TeamService } from './team.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('api')
@UseGuards(JwtAuthGuard)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  // ─── Admin team endpoints ────────────────────────────
  @Get('admin/teams/batch/:batchId')
  async findByBatch(@Param('batchId') batchId: string) {
    return this.teamService.findByBatch(batchId);
  }

  @Get('admin/teams/:id')
  async findOne(@Param('id') id: string) {
    return this.teamService.findOne(id);
  }

  @Post('admin/teams/form/:batchId')
  async formTeams(@Param('batchId') batchId: string) {
    return this.teamService.formTeams(batchId);
  }

  // ─── Team Requests (Member endpoints) ─────────────────
  @Post('teams/:id/requests')
  async createRequest(
    @Param('id') teamId: string,
    @Req() req: any,
    @Body() body: { type: string; title: string; details: string },
  ) {
    const requesterId = req.user.id || req.user.sub;
    return this.teamService.createTeamRequest(teamId, requesterId, body);
  }

  @Get('teams/:id/requests')
  async getRequests(
    @Param('id') teamId: string,
    @Query('status') status?: string,
  ) {
    return this.teamService.getTeamRequests(teamId, status);
  }

  // Leader approves/rejects a request
  @Patch('teams/:id/requests/:reqId')
  async resolveRequest(
    @Param('id') teamId: string,
    @Param('reqId') reqId: string,
    @Req() req: any,
    @Body('status') status: string,
  ) {
    const resolverId = req.user.id || req.user.sub;
    return this.teamService.resolveTeamRequest(teamId, reqId, resolverId, status);
  }

  // ─── Leader: Edit Project ────────────────────────────
  @Patch('teams/:id/project')
  async updateProject(
    @Param('id') teamId: string,
    @Req() req: any,
    @Body() body: any,
  ) {
    const callerId = req.user.id || req.user.sub;
    return this.teamService.updateProjectAsLeader(teamId, callerId, body);
  }
}
