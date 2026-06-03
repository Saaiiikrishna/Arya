import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ElectionService } from './election.service';
import { JwtAuthGuard, AdminGuard } from '../auth/guards';

@Controller('api')
export class ElectionController {
  constructor(private readonly electionService: ElectionService) {}

  // ─── Admin endpoints ──────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/elections/team/:teamId/start')
  async startElection(
    @Param('teamId') teamId: string,
    @Body()
    body?: {
      instructions?: string;
      deadline?: string;
      questionIds?: string[];
    },
  ) {
    return this.electionService.startElection(
      teamId,
      body?.instructions,
      body?.deadline,
      body?.questionIds,
    );
  }

  @UseGuards(AdminGuard)
  @Post('admin/elections/batch/:batchId/start')
  async startBatchElections(
    @Param('batchId') batchId: string,
    @Body()
    body?: {
      instructions?: string;
      deadline?: string;
      questionIds?: string[];
    },
  ) {
    return this.electionService.startBatchElections(
      batchId,
      body?.instructions,
      body?.deadline,
      body?.questionIds,
    );
  }

  @UseGuards(AdminGuard)
  @Put('admin/elections/:id/advance')
  async advanceElection(@Param('id') id: string) {
    return this.electionService.advanceElection(id);
  }

  // ─── Election Question Templates (Admin) ──────────────

  @UseGuards(AdminGuard)
  @Get('admin/election-questions/templates')
  async getQuestionTemplates() {
    return this.electionService.getQuestionTemplates();
  }

  @UseGuards(AdminGuard)
  @Post('admin/election-questions/templates')
  async createQuestionTemplate(
    @Body()
    body: {
      label: string;
      helpText?: string;
      type?: string;
      options?: any;
      isRequired?: boolean;
    },
  ) {
    return this.electionService.createQuestionTemplate(body);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/election-questions/templates/:id')
  async deleteQuestionTemplate(@Param('id') id: string) {
    return this.electionService.deleteQuestionTemplate(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/elections/:id/questions')
  async addCustomQuestion(
    @Param('id') id: string,
    @Body()
    body: {
      label: string;
      helpText?: string;
      type?: string;
      options?: any;
      isRequired?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.electionService.addCustomQuestion(id, body);
  }

  // ─── Member endpoints ─────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('elections/:id')
  async getElection(@Param('id') id: string, @Req() req: any) {
    const requesterId = req.user.id || req.user.sub;
    return this.electionService.getElection(id, requesterId, req.user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get('elections/team/:teamId/active')
  async getActiveElection(@Param('teamId') teamId: string, @Req() req: any) {
    const requesterId = req.user.id || req.user.sub;
    return this.electionService.getActiveElection(teamId, requesterId, req.user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get('elections/:id/nominees')
  async getNominees(@Param('id') id: string, @Req() req: any) {
    const requesterId = req.user.id || req.user.sub;
    return this.electionService.getNominees(id, requesterId, req.user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get('elections/:id/results')
  async getResults(@Param('id') id: string, @Req() req: any) {
    const requesterId = req.user.id || req.user.sub;
    return this.electionService.getResults(id, requesterId, req.user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Post('elections/:id/nominate')
  async nominate(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { nomineeId: string; reason?: string },
  ) {
    const nominatedById = req.user.id || req.user.sub;
    return this.electionService.nominate(id, body.nomineeId, nominatedById, body.reason);
  }

  @UseGuards(JwtAuthGuard)
  @Post('elections/:id/self-nominate')
  async selfNominate(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { pitch?: string; answers?: { questionId: string; value: any }[] },
  ) {
    const nomineeId = req.user.id || req.user.sub;
    return this.electionService.selfNominate(id, nomineeId, body.pitch, body.answers);
  }

  @UseGuards(JwtAuthGuard)
  @Put('elections/:id/pitch')
  async submitPitch(
    @Param('id') id: string,
    @Req() req: any,
    @Body('pitch') pitch: string,
  ) {
    const nomineeId = req.user.id || req.user.sub;
    return this.electionService.submitPitch(id, nomineeId, pitch);
  }

  @UseGuards(JwtAuthGuard)
  @Post('elections/:id/vote')
  async castVote(
    @Param('id') id: string,
    @Req() req: any,
    @Body('nomineeId') nomineeId: string,
  ) {
    const voterId = req.user.id || req.user.sub;
    return this.electionService.castVote(id, voterId, nomineeId);
  }
}
