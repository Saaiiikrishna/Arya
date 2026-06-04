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
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ApplicantService } from './applicant.service';
import { ApplyDto, SubmitAdditionalAnswersDto } from './dto';
import { JwtAuthGuard, AdminGuard } from '../auth/guards';
import { ApplicantStatus } from '@prisma/client';

@Controller('api')
export class ApplicantController {
  constructor(private readonly applicantService: ApplicantService) {}

  // ─── Public ────────────────────────────────────────
  @UseGuards(ThrottlerGuard)
  @Throttle({ short: { limit: 3, ttl: 60000 } })
  @Post('applicants/apply')
  async apply(@Body() dto: ApplyDto) {
    return this.applicantService.apply(dto);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Get('applicants/status/:accessToken')
  async getStatus(@Param('accessToken') accessToken: string) {
    return this.applicantService.findByAccessToken(accessToken);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('applicants/dossier')
  async submitDossier(@Req() req: any, @Body() dto: any) {
    const applicantId = req.user.id || req.user.sub;
    return this.applicantService.submitDossier(applicantId, dto);
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
  @Post('applicants/me/answers')
  async submitMyAnswers(@Req() req: any, @Body() dto: SubmitAdditionalAnswersDto) {
    const applicantId = req.user.id || req.user.sub;
    return this.applicantService.submitMyAdditionalAnswers(applicantId, dto);
  }

  // ─── WhatsApp verification ───────────────────────────────
  // ThrottlerGuard is paired with @Throttle explicitly (file convention) so the
  // per-route limit is enforced regardless of global guard wiring.
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @Post('applicants/me/whatsapp/send-otp')
  async sendWhatsappVerifyOtp(@Req() req: any) {
    const applicantId = req.user.id || req.user.sub;
    return this.applicantService.sendWhatsappVerifyOtp(applicantId);
  }

  // Strict limit: verifying an OTP without a rate cap is a brute-force target
  // (a 6-digit code is guessable within a window otherwise).
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @Post('applicants/me/whatsapp/verify')
  async verifyWhatsappOtp(@Req() req: any, @Body('otp') otp: string) {
    const applicantId = req.user.id || req.user.sub;
    return this.applicantService.verifyWhatsappOtp(applicantId, otp);
  }

  @UseGuards(JwtAuthGuard)
  @Get('applicants/:memberId/profile')
  async getMemberProfile(@Req() req: any, @Param('memberId') memberId: string) {
    const requesterId = req.user.id || req.user.sub;
    return this.applicantService.getMemberProfile(memberId, requesterId, req.user.role);
  }

  @Post('applicants/consent/:accessToken')
  async giveConsent(
    @Param('accessToken') accessToken: string,
    @Body('consentDocUrl') consentDocUrl?: string,
  ) {
    return this.applicantService.giveConsent(accessToken, consentDocUrl);
  }

  // ─── Admin ─────────────────────────────────────────
  @UseGuards(AdminGuard)
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

  @UseGuards(AdminGuard)
  @Get('admin/applicants/:id')
  async findOne(@Param('id') id: string) {
    return this.applicantService.findOneAdmin(id);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/applicants/:id')
  async remove(@Param('id') id: string) {
    return this.applicantService.removeApplicant(id);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/applicants/:id/hard')
  async hardDelete(@Param('id') id: string) {
    return this.applicantService.hardDeleteApplicant(id);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/applicants/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: ApplicantStatus,
  ) {
    return this.applicantService.updateApplicantStatus(id, status);
  }

  @UseGuards(AdminGuard)
  @Get('admin/dashboard/stats')
  async getDashboardStats() {
    return this.applicantService.getDashboardStats();
  }
}
