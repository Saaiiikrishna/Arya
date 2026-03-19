import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { TeamService } from './team.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('api/admin/teams')
@UseGuards(JwtAuthGuard)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get('batch/:batchId')
  async findByBatch(@Param('batchId') batchId: string) {
    return this.teamService.findByBatch(batchId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.teamService.findOne(id);
  }

  @Post('form/:batchId')
  async formTeams(@Param('batchId') batchId: string) {
    return this.teamService.formTeams(batchId);
  }
}
