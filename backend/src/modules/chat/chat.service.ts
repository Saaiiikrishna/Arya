import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'];
const MAX_MESSAGE_LIMIT = 100;
const DEFAULT_MESSAGE_LIMIT = 50;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Authorize a caller against a team. Admins bypass; otherwise the caller's
   * applicant record must belong to the given (non-null) team.
   */
  private async assertTeamMembership(
    teamId: string,
    requesterId: string,
    requesterRole?: string,
  ) {
    if (ADMIN_ROLES.includes(requesterRole || '')) return;

    const requester = await this.prisma.applicant.findUnique({
      where: { id: requesterId },
      select: { teamId: true },
    });
    if (!requester?.teamId || requester.teamId !== teamId) {
      throw new ForbiddenException('You can only access your own team chat');
    }
  }

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

  async getRoomByTeam(teamId: string, requesterId: string, requesterRole?: string) {
    // IDOR guard: only team members (or admins) may read/auto-create a team room.
    await this.assertTeamMembership(teamId, requesterId, requesterRole);

    let room = await this.prisma.chatRoom.findUnique({
      where: { teamId },
      include: { messages: { orderBy: { sentAt: 'desc' }, take: DEFAULT_MESSAGE_LIMIT } },
    });

    // Auto-create room if none exists (caller is already verified as a member/admin).
    if (!room) {
      const team = await this.prisma.team.findUnique({ where: { id: teamId } });
      if (team) {
        room = await this.prisma.chatRoom.create({
          data: { teamId, name: `${team.name} Chat` },
          include: { messages: { orderBy: { sentAt: 'desc' }, take: DEFAULT_MESSAGE_LIMIT } },
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

  async getMessages(
    roomId: string,
    params?: { before?: Date; limit?: number; requesterId?: string; requesterRole?: string },
  ) {
    const { before, limit, requesterId, requesterRole } = params || {};

    // IDOR guard: a non-global team room is only readable by its team's members
    // (or admins). Global/announcement rooms are open to any authenticated user.
    // Only enforced when a requesterId is supplied (REST path); the WebSocket
    // gateway performs its own auth on connection/join.
    if (requesterId) {
      const room = await this.prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: { teamId: true, isGlobal: true },
      });
      if (room?.teamId && !room.isGlobal) {
        await this.assertTeamMembership(room.teamId, requesterId, requesterRole);
      }
    }

    // Clamp the page size to a sane bound to avoid unbounded reads.
    const take = Math.min(Math.max(limit ?? DEFAULT_MESSAGE_LIMIT, 1), MAX_MESSAGE_LIMIT);

    return this.prisma.chatMessage.findMany({
      where: {
        roomId,
        ...(before ? { sentAt: { lt: before } } : {}),
      },
      orderBy: { sentAt: 'desc' },
      take,
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
    const take = Math.min(Math.max(limit, 1), MAX_MESSAGE_LIMIT);
    return this.prisma.chatMessage.findMany({
      where: { isAnnouncement: true },
      orderBy: { sentAt: 'desc' },
      take,
    });
  }
}
