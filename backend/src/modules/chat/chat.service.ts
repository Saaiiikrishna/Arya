import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Chat Rooms ──────────────────────────────────────

  async createRoom(data: { teamId?: string; name: string; isGlobal?: boolean }) {
    return this.prisma.chatRoom.create({ data });
  }

  async getRoom(id: string) {
    return this.prisma.chatRoom.findUnique({
      where: { id },
      include: { messages: { orderBy: { sentAt: 'desc' }, take: 50 } },
    });
  }

  async getRoomByTeam(teamId: string) {
    let room = await this.prisma.chatRoom.findUnique({
      where: { teamId },
      include: { messages: { orderBy: { sentAt: 'desc' }, take: 50 } },
    });

    // Auto-create room if none exists
    if (!room) {
      const team = await this.prisma.team.findUnique({ where: { id: teamId } });
      if (team) {
        room = await this.prisma.chatRoom.create({
          data: { teamId, name: `${team.name} Chat` },
          include: { messages: { orderBy: { sentAt: 'desc' }, take: 50 } },
        });
      }
    }

    return room;
  }

  async getGlobalRoom() {
    let room = await this.prisma.chatRoom.findFirst({
      where: { isGlobal: true },
      include: { messages: { orderBy: { sentAt: 'desc' }, take: 50 } },
    });

    if (!room) {
      room = await this.prisma.chatRoom.create({
        data: { name: 'Announcements', isGlobal: true },
        include: { messages: { orderBy: { sentAt: 'desc' }, take: 50 } },
      });
    }

    return room;
  }

  // ─── Messages ────────────────────────────────────────

  async sendMessage(data: {
    roomId: string;
    senderId: string;
    senderName: string;
    content: string;
    isAnnouncement?: boolean;
  }) {
    return this.prisma.chatMessage.create({ data });
  }

  async getMessages(roomId: string, params?: { before?: Date; limit?: number }) {
    const { before, limit = 50 } = params || {};

    return this.prisma.chatMessage.findMany({
      where: {
        roomId,
        ...(before ? { sentAt: { lt: before } } : {}),
      },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
  }

  // ─── Announcements ──────────────────────────────────

  async sendAnnouncement(senderId: string, senderName: string, content: string) {
    const globalRoom = await this.getGlobalRoom();

    return this.prisma.chatMessage.create({
      data: {
        roomId: globalRoom.id,
        senderId,
        senderName,
        content,
        isAnnouncement: true,
      },
    });
  }

  async getAnnouncements(limit = 20) {
    return this.prisma.chatMessage.findMany({
      where: { isAnnouncement: true },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
  }
}
