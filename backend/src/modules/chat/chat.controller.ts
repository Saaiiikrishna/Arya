import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/guards';

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

  @UseGuards(JwtAuthGuard)
  @Post('admin/chat/announcement')
  async sendAnnouncement(
    @Body('senderId') senderId: string,
    @Body('senderName') senderName: string,
    @Body('content') content: string,
  ) {
    return this.chatService.sendAnnouncement(senderId, senderName, content);
  }
}
