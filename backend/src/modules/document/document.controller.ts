import { Controller, Get, Post, Param, Body, UseGuards, Query, Req } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { DocumentService } from './document.service';
import { AdminGuard, JwtAuthGuard } from '../auth/guards';

@Controller('api')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  // ─── Authenticated applicant ──────────────────────
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Post('documents/upload-url')
  async getUploadUrl(
    @Req() req: any,
    @Body() body: { fileName: string; mimeType: string },
  ) {
    const applicantId = req.user.id || req.user.sub;
    return this.documentService.getUploadUrl(applicantId, body.fileName, body.mimeType);
  }

  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Post('documents/:id/confirm')
  async confirmUpload(
    @Param('id') id: string,
    @Req() req: any,
    @Body('fileSize') fileSize?: number,
  ) {
    const applicantId = req.user.id || req.user.sub;
    return this.documentService.confirmUpload(id, applicantId, fileSize);
  }

  // ─── Admin ────────────────────────────────────────
  @UseGuards(AdminGuard)
  @Get('admin/documents/applicant/:applicantId')
  async getByApplicant(@Param('applicantId') applicantId: string) {
    return this.documentService.getByApplicant(applicantId);
  }

  @UseGuards(AdminGuard)
  @Get('admin/documents/:id/download')
  async getDownloadUrl(@Param('id') id: string) {
    return this.documentService.getDownloadUrl(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/documents/:id/verify')
  async verify(@Param('id') id: string) {
    return this.documentService.verify(id);
  }
}
