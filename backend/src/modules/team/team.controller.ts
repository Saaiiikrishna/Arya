import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Req, Query } from '@nestjs/common';
import { TeamService } from './team.service';
import { JwtAuthGuard, AdminGuard } from '../auth/guards';

@Controller('api')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  // ─── Admin team endpoints ─────────────────────────────────

  @UseGuards(AdminGuard)
  @Get('admin/teams/batch/:batchId')
  async findByBatch(@Param('batchId') batchId: string) {
    return this.teamService.findByBatch(batchId);
  }

  @UseGuards(AdminGuard)
  @Get('admin/teams/:id')
  async findOne(@Param('id') id: string) {
    return this.teamService.findOne(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/teams/form/:batchId')
  async formTeams(@Param('batchId') batchId: string) {
    return this.teamService.formTeams(batchId);
  }

  @UseGuards(AdminGuard)
  @Post('admin/teams/:id/lock')
  async lockTeam(@Param('id') teamId: string, @Req() req: any) {
    const adminId = req.user.id || req.user.sub;
    return this.teamService.lockTeam(teamId, adminId);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/teams/requests/:reqId/resolve')
  async adminResolveRequest(
    @Param('reqId') reqId: string,
    @Req() req: any,
    @Body('status') status: string,
  ) {
    const adminId = req.user.id || req.user.sub;
    return this.teamService.adminResolveTeamRequest(reqId, adminId, status);
  }

  // ─── Team Requests (Member endpoints) ─────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('teams/:id/requests')
  async createRequest(
    @Param('id') teamId: string,
    @Req() req: any,
    @Body() body: { type: string; title: string; details: string; targetTeamId?: string },
  ) {
    const requesterId = req.user.id || req.user.sub;
    return this.teamService.createTeamRequest(teamId, requesterId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('teams/:id/requests')
  async getRequests(
    @Param('id') teamId: string,
    @Query('status') status?: string,
  ) {
    return this.teamService.getTeamRequests(teamId, status);
  }

  @UseGuards(JwtAuthGuard)
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

  // ─── Department management (Member endpoints) ──────────────

  @UseGuards(JwtAuthGuard)
  @Get('teams/:id/departments')
  async getDepartments(@Param('id') teamId: string) {
    return this.teamService.getTeamDepartments(teamId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('teams/:id/members/:applicantId/department')
  async claimDepartment(
    @Param('id') teamId: string,
    @Param('applicantId') applicantId: string,
    @Req() req: any,
    @Body('department') department: string,
  ) {
    const callerId = req.user.id || req.user.sub;
    return this.teamService.setMemberDepartment(teamId, applicantId, callerId, department as any);
  }

  // ─── Leader: Edit Project ──────────────────────────────────

  @UseGuards(JwtAuthGuard)
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
