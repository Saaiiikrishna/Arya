import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ElectionService } from './election.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('api')
export class ElectionController {
  constructor(private readonly electionService: ElectionService) {}

  // ─── Admin endpoints ──────────────────────────────────

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
  @Put('admin/elections/:id/advance')
  async advanceElection(@Param('id') id: string) {
    return this.electionService.advanceElection(id);
  }

  // ─── Election Question Templates (Admin) ──────────────

  @UseGuards(JwtAuthGuard)
  @Get('admin/election-questions/templates')
  async getQuestionTemplates() {
    return this.electionService.getQuestionTemplates();
  }

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
  @Delete('admin/election-questions/templates/:id')
  async deleteQuestionTemplate(@Param('id') id: string) {
    return this.electionService.deleteQuestionTemplate(id);
  }

  @UseGuards(JwtAuthGuard)
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
  async getElection(@Param('id') id: string) {
    return this.electionService.getElection(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('elections/team/:teamId/active')
  async getActiveElection(@Param('teamId') teamId: string) {
    return this.electionService.getActiveElection(teamId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('elections/:id/nominees')
  async getNominees(@Param('id') id: string) {
    return this.electionService.getNominees(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('elections/:id/results')
  async getResults(@Param('id') id: string) {
    return this.electionService.getResults(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('elections/:id/nominate')
  async nominate(
    @Param('id') id: string,
    @Body()
    body: { nomineeId: string; nominatedById?: string; reason?: string },
  ) {
    return this.electionService.nominate(
      id,
      body.nomineeId,
      body.nominatedById,
      body.reason,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('elections/:id/self-nominate')
  async selfNominate(
    @Param('id') id: string,
    @Body()
    body: {
      nomineeId: string;
      pitch?: string;
      answers?: { questionId: string; value: any }[];
    },
  ) {
    return this.electionService.selfNominate(
      id,
      body.nomineeId,
      body.pitch,
      body.answers,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Put('elections/:id/pitch')
  async submitPitch(
    @Param('id') id: string,
    @Body() body: { nomineeId: string; pitch: string },
  ) {
    return this.electionService.submitPitch(id, body.nomineeId, body.pitch);
  }

  @UseGuards(JwtAuthGuard)
  @Post('elections/:id/vote')
  async castVote(
    @Param('id') id: string,
    @Body() body: { voterId: string; nomineeId: string },
  ) {
    return this.electionService.castVote(id, body.voterId, body.nomineeId);
  }
}
