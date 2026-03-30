import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';

@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  createProject(@Body() createProjectDto: CreateProjectDto) {
    return this.projectService.create(createProjectDto);
  }

  @Get('team/:teamId')
  getProjectByTeamId(@Param('teamId') teamId: string) {
    return this.projectService.findByTeamId(teamId);
  }
}
