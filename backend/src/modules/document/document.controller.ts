import { Controller, Get, Post, Param, Body, UseGuards, Query } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { DocumentService } from './document.service';
import { AdminGuard } from '../auth/guards';

@Controller('api')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  // ─── Public (via access token) ────────────────────
  @UseGuards(ThrottlerGuard)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Post('documents/upload-url')
  async getUploadUrl(
    @Body() body: { applicantId: string; fileName: string; mimeType: string },
  ) {
    return this.documentService.getUploadUrl(body.applicantId, body.fileName, body.mimeType);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Post('documents/:id/confirm')
  async confirmUpload(
    @Param('id') id: string,
    @Body('fileSize') fileSize?: number,
  ) {
    return this.documentService.confirmUpload(id, fileSize);
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
