import { Controller, Post, Get, Patch, Param, Body, UseGuards, Query } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('api/admin/matching')
@UseGuards(JwtAuthGuard)
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  /**
   * Preview team formation without saving (dry run)
   */
  @Post('preview/:batchId')
  async preview(
    @Param('batchId') batchId: string,
    @Body() config?: any,
  ) {
    return this.matchingService.previewMatch(batchId, config);
  }

  /**
   * Execute smart matching and save teams to DB
   */
  @Post('execute/:batchId')
  async execute(
    @Param('batchId') batchId: string,
    @Body() config?: any,
  ) {
    return this.matchingService.executeMatch(batchId, config);
  }

  /**
   * Move a member from one team to another
   */
  @Patch('move-member')
  async moveMember(
    @Body('applicantId') applicantId: string,
    @Body('targetTeamId') targetTeamId: string,
  ) {
    return this.matchingService.moveMember(applicantId, targetTeamId);
  }

  /**
   * Upsert matching profile for an applicant
   */
  @Post('profile/:applicantId')
  async upsertProfile(
    @Param('applicantId') applicantId: string,
    @Body() data: any,
  ) {
    return this.matchingService.upsertProfile(applicantId, data);
  }

  /**
   * Get matching profile for an applicant
   */
  @Get('profile/:applicantId')
  async getProfile(@Param('applicantId') applicantId: string) {
    return this.matchingService.getProfile(applicantId);
  }

  /**
   * Get all applicants with profiles for a batch (for preview)
   */
  @Get('profiles/:batchId')
  async getProfilesByBatch(@Param('batchId') batchId: string) {
    return this.matchingService.getProfilesByBatch(batchId);
  }
}
