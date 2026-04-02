import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApplicantService } from './applicant.service';
import { ApplyDto, SubmitAdditionalAnswersDto } from './dto';
import { JwtAuthGuard } from '../auth/guards';
import { ApplicantStatus } from '@prisma/client';

@Controller('api')
export class ApplicantController {
  constructor(private readonly applicantService: ApplicantService) {}

  // ─── Public ────────────────────────────────────────
  @Post('applicants/apply')
  async apply(@Body() dto: ApplyDto) {
    return this.applicantService.apply(dto);
  }

  @Get('applicants/status/:accessToken')
  async getStatus(@Param('accessToken') accessToken: string) {
    return this.applicantService.findByAccessToken(accessToken);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('applicants/dossier')
  async submitDossier(@Req() req: any, @Body() dto: any) {
    const applicantId = req.user.id || req.user.sub;
    console.log('[submitDossier] user:', JSON.stringify({ id: req.user.id, sub: req.user.sub, email: req.user.email, role: req.user.role }));
    console.log('[submitDossier] applicantId:', applicantId);
    console.log('[submitDossier] dto keys:', Object.keys(dto || {}));
    try {
      const result = await this.applicantService.submitDossier(applicantId, dto);
      console.log('[submitDossier] Success for:', applicantId);
      return result;
    } catch (error) {
      console.error('[submitDossier] Error:', error);
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('applicants/me/profile')
  async getMyProfileEndpoint(@Req() req: any) {
    const applicantId = req.user.id || req.user.sub;
    const applicant = await this.applicantService.getMyProfile(applicantId);
    const hasPaid = applicant.payments?.some((p: any) => p.status === 'CAPTURED') ?? false;
    return {
      id: applicant.id,
      email: applicant.email,
      firstName: applicant.firstName,
      lastName: applicant.lastName,
      phone: applicant.phone,
      city: applicant.city,
      age: applicant.age,
      status: applicant.status,
      teamId: applicant.teamId,
      batchId: applicant.batchId,
      avatarUrl: applicant.avatarUrl,
      role: 'APPLICANT',
      hasPaid,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('applicants/me/dossier')
  async getMyDossierEndpoint(@Req() req: any) {
    const applicantId = req.user.id || req.user.sub;
    return this.applicantService.getMyProfile(applicantId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('applicants/me/hub')
  async getMyHubData(@Req() req: any) {
    const applicantId = req.user.id || req.user.sub;
    return this.applicantService.getHubData(applicantId);
  }

  @Post('applicants/answers/:accessToken')
  async submitAdditionalAnswers(
    @Param('accessToken') accessToken: string,
    @Body() dto: SubmitAdditionalAnswersDto,
  ) {
    return this.applicantService.submitAdditionalAnswers(accessToken, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('applicants/me/pending-questions')
  async getPendingQuestionnaires(@Req() req: any) {
    const applicantId = req.user.id || req.user.sub;
    return this.applicantService.getPendingQuestionnaires(applicantId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('applicants/:memberId/profile')
  async getMemberProfile(@Param('memberId') memberId: string) {
    return this.applicantService.getMemberProfile(memberId);
  }

  @Post('applicants/consent/:accessToken')
  async giveConsent(
    @Param('accessToken') accessToken: string,
    @Body('consentDocUrl') consentDocUrl?: string,
  ) {
    return this.applicantService.giveConsent(accessToken, consentDocUrl);
  }

  // ─── Admin ─────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('admin/applicants')
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: ApplicantStatus,
    @Query('batchId') batchId?: string,
  ) {
    return this.applicantService.findAll({
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      search,
      status,
      batchId,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/applicants/:id')
  async findOne(@Param('id') id: string) {
    return this.applicantService.findOneAdmin(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('admin/applicants/:id')
  async remove(@Param('id') id: string) {
    return this.applicantService.removeApplicant(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('admin/applicants/:id/hard')
  async hardDelete(@Param('id') id: string) {
    return this.applicantService.hardDeleteApplicant(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('admin/applicants/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: ApplicantStatus,
  ) {
    return this.applicantService.updateApplicantStatus(id, status);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/dashboard/stats')
  async getDashboardStats() {
    return this.applicantService.getDashboardStats();
  }
}
