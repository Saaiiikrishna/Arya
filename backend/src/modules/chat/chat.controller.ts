import { Controller, Get, Post, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard, AdminGuard } from '../auth/guards';

@Controller('api')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ─── REST fallback for chat ────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('chat/room/team/:teamId')
  async getRoomByTeam(@Req() req: any, @Param('teamId') teamId: string) {
    const requesterId = req.user.id || req.user.sub;
    return this.chatService.getRoomByTeam(teamId, requesterId, req.user.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get('chat/room/:id/messages')
  async getMessages(
    @Req() req: any,
    @Param('id') roomId: string,
    @Query('limit') limit?: string,
  ) {
    const requesterId = req.user.id || req.user.sub;
    const parsedLimit = limit !== undefined ? parseInt(limit, 10) : undefined;
    return this.chatService.getMessages(roomId, {
      limit: parsedLimit !== undefined && !Number.isNaN(parsedLimit) ? parsedLimit : undefined,
      requesterId,
      requesterRole: req.user.role,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('chat/announcements')
  async getAnnouncements(@Query('limit') limit?: string) {
    const parsedLimit = limit !== undefined ? parseInt(limit, 10) : undefined;
    return this.chatService.getAnnouncements(
      parsedLimit !== undefined && !Number.isNaN(parsedLimit) ? parsedLimit : undefined,
    );
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
