import {
  Controller, Get, Post, Patch, Delete, Param, Body, Req, UseGuards,
} from '@nestjs/common';
import { InterviewService } from './interview.service';
import { JwtAuthGuard, AdminGuard } from '../auth/guards';
import { InterviewDecision } from '@prisma/client';

@Controller('api')
export class InterviewController {
  constructor(private readonly interviewService: InterviewService) {}

  // ─── Admin endpoints ──────────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/interview/slots')
  async createSlot(
    @Body('batchId') batchId: string,
    @Body('startTime') startTime: string,
    @Body('endTime') endTime: string,
    @Body('capacity') capacity: number,
    @Body('notes') notes?: string,
  ) {
    return this.interviewService.createSlot(batchId, startTime, endTime, capacity ?? 1, notes);
  }

  @UseGuards(AdminGuard)
  @Get('admin/interview/slots/:batchId')
  async getAdminSlots(@Param('batchId') batchId: string) {
    return this.interviewService.getAdminSlots(batchId);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/interview/slots/:slotId')
  async deleteSlot(@Param('slotId') slotId: string) {
    return this.interviewService.deleteSlot(slotId);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/interview/bookings/:bookingId/decision')
  async recordDecision(
    @Param('bookingId') bookingId: string,
    @Req() req: any,
    @Body('decision') decision: InterviewDecision,
    @Body('score') score?: number,
    @Body('notes') notes?: string,
  ) {
    const adminId = req.user.id || req.user.sub;
    return this.interviewService.recordDecision(bookingId, decision, score, notes, adminId);
  }

  @UseGuards(AdminGuard)
  @Get('admin/interview/video/:batchId')
  async getVideoSubmissions(@Param('batchId') batchId: string) {
    return this.interviewService.getVideoSubmissions(batchId);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/interview/video/:submissionId/score')
  async reviewVideo(
    @Param('submissionId') submissionId: string,
    @Req() req: any,
    @Body('score') score: number,
    @Body('reviewNotes') reviewNotes?: string,
  ) {
    const adminId = req.user.id || req.user.sub;
    return this.interviewService.reviewVideo(submissionId, score, reviewNotes, adminId);
  }

  // ─── Applicant endpoints ──────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('interview/slots/:batchId')
  async getAvailableSlots(@Param('batchId') batchId: string) {
    return this.interviewService.getAvailableSlots(batchId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('interview/my-booking')
  async getMyBooking(@Req() req: any) {
    const applicantId = req.user.id || req.user.sub;
    return this.interviewService.getMyBooking(applicantId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('interview/book/:slotId')
  async bookSlot(@Param('slotId') slotId: string, @Req() req: any) {
    const applicantId = req.user.id || req.user.sub;
    return this.interviewService.bookSlot(applicantId, slotId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('interview/booking')
  async cancelBooking(@Req() req: any) {
    const applicantId = req.user.id || req.user.sub;
    return this.interviewService.cancelBooking(applicantId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('interview/video')
  async getMyVideo(@Req() req: any) {
    const applicantId = req.user.id || req.user.sub;
    return this.interviewService.getMyVideo(applicantId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('interview/video')
  async submitVideo(
    @Req() req: any,
    @Body('batchId') batchId: string,
    @Body('videoUrl1') videoUrl1?: string,
    @Body('videoUrl2') videoUrl2?: string,
    @Body('videoUrl3') videoUrl3?: string,
  ) {
    const applicantId = req.user.id || req.user.sub;
    return this.interviewService.submitVideo(applicantId, batchId, videoUrl1, videoUrl2, videoUrl3);
  }
}
