import { Controller, Post, Get, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { JwtAuthGuard, AdminGuard } from '../auth/guards';

// Mounted under /api/projects to match the frontend client base (was at root
// '/projects', unreachable from the /api-based client).
@Controller('api/projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @UseGuards(AdminGuard)
  @Post()
  createProject(@Body() createProjectDto: CreateProjectDto) {
    return this.projectService.create(createProjectDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('team/:teamId')
  getProjectByTeamId(@Param('teamId') teamId: string, @Req() req: any) {
    const requesterId = req.user.id || req.user.sub;
    return this.projectService.findByTeamId(teamId, requesterId, req.user.role);
  }
}
