import { Controller, Get, Post, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard, AdminGuard } from '../auth/guards';

@Controller('api')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ─── REST fallback for chat ────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('chat/room/team/:teamId')
  async getRoomByTeam(@Param('teamId') teamId: string) {
    return this.chatService.getRoomByTeam(teamId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('chat/room/:id/messages')
  async getMessages(
    @Param('id') roomId: string,
    @Query('limit') limit?: string,
  ) {
    return this.chatService.getMessages(roomId, {
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('chat/announcements')
  async getAnnouncements(@Query('limit') limit?: string) {
    return this.chatService.getAnnouncements(limit ? parseInt(limit) : undefined);
  }

  // ─── Admin ─────────────────────────────────────────

  @UseGuards(AdminGuard)
  @Post('admin/chat/announcement')
  async sendAnnouncement(
    @Req() req: any,
    @Body('content') content: string,
  ) {
    const admin = req.user;
    const senderId = admin.id || admin.sub;
    const senderName = admin.firstName
      ? `${admin.firstName} ${admin.lastName ?? ''}`.trim()
      : (admin.email?.split('@')[0] ?? 'Admin');
    return this.chatService.sendAnnouncement(senderId, senderName, content);
  }
}
