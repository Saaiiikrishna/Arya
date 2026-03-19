import { Controller, Get, Post, Param, Body, UseGuards, Query } from '@nestjs/common';
import { DocumentService } from './document.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('api')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  // ─── Public (via access token) ────────────────────
  @Post('documents/upload-url')
  async getUploadUrl(
    @Body() body: { applicantId: string; fileName: string; mimeType: string },
  ) {
    return this.documentService.getUploadUrl(body.applicantId, body.fileName, body.mimeType);
  }

  @Post('documents/:id/confirm')
  async confirmUpload(
    @Param('id') id: string,
    @Body('fileSize') fileSize?: number,
  ) {
    return this.documentService.confirmUpload(id, fileSize);
  }

  // ─── Admin ────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('admin/documents/applicant/:applicantId')
  async getByApplicant(@Param('applicantId') applicantId: string) {
    return this.documentService.getByApplicant(applicantId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/documents/:id/download')
  async getDownloadUrl(@Param('id') id: string) {
    return this.documentService.getDownloadUrl(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/documents/:id/verify')
  async verify(@Param('id') id: string) {
    return this.documentService.verify(id);
  }
}
