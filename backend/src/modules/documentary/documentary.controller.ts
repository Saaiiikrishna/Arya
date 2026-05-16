import { Controller, Post, Get, Patch, Delete, Param, Body, Req, UseGuards, Query } from '@nestjs/common';
import { DocumentaryService } from './documentary.service';
import { AdminGuard, InvestorGuard } from '../auth/guards';

@Controller('api')
export class DocumentaryController {
  constructor(private readonly documentaryService: DocumentaryService) {}

  // ─── Admin: clip management ───────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/documentary/teams/:teamId/upload-url')
  getUploadUrl(
    @Req() req: any,
    @Param('teamId') teamId: string,
    @Body() body: { fileName: string; mimeType: string; week: number; title: string; description?: string },
  ) {
    return this.documentaryService.getUploadUrl(
      teamId,
      req.user.id ?? req.user.sub,
      'ADMIN',
      body,
    );
  }

  @UseGuards(AdminGuard)
  @Patch('admin/documentary/clips/:clipId/confirm')
  confirmUpload(@Param('clipId') clipId: string, @Body() body: { thumbnailUrl?: string }) {
    return this.documentaryService.confirmUpload(clipId, body.thumbnailUrl);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/documentary/clips/:clipId/publish')
  publishClip(@Param('clipId') clipId: string, @Body() body: { publish: boolean }) {
    return this.documentaryService.togglePublish(clipId, body.publish);
  }

  @UseGuards(AdminGuard)
  @Get('admin/documentary/teams/:teamId/clips')
  listClips(@Param('teamId') teamId: string) {
    return this.documentaryService.listClips(teamId, false);
  }

  @UseGuards(AdminGuard)
  @Delete('admin/documentary/clips/:clipId')
  deleteClip(@Param('clipId') clipId: string) {
    return this.documentaryService.deleteClip(clipId);
  }

  @UseGuards(AdminGuard)
  @Get('admin/documentary/clips/:clipId/stream-url')
  getAdminStreamUrl(@Param('clipId') clipId: string) {
    return this.documentaryService.getStreamUrl(clipId);
  }

  // ─── Investor: published clips only ───────────────────────

  @UseGuards(InvestorGuard)
  @Get('investors/documentary/:teamId')
  getPublishedClips(@Param('teamId') teamId: string) {
    return this.documentaryService.getPublishedClips(teamId);
  }

  @UseGuards(InvestorGuard)
  @Get('documentary/clips/:clipId/stream-url')
  getStreamUrl(@Param('clipId') clipId: string) {
    return this.documentaryService.getStreamUrl(clipId, true); // publishedOnly: investors see only published clips
  }
}
