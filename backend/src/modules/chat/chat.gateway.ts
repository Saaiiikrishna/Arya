import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    role: string;
  };
}

@WebSocketGateway({
  cors: {
    origin: [
      'http://localhost:3000',
      'http://localhost:3005',
      'https://aryavartham.com',
      'https://www.aryavartham.com',
    ],
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        client.handshake.auth?.token ??
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.emit('error', { message: 'Authentication required' });
        client.disconnect(true);
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      client.data = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
        firstName: payload.firstName,
        lastName: payload.lastName,
      };

      this.logger.log(`Client connected: ${client.id} (user: ${payload.email})`);
    } catch {
      client.emit('error', { message: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.data?.userId) throw new WsException('Not authenticated');
    client.join(data.roomId);
    this.logger.log(`Client ${client.id} joined room ${data.roomId}`);

    const messages = await this.chatService.getMessages(data.roomId);
    client.emit('recentMessages', messages.reverse());
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.data?.userId) throw new WsException('Not authenticated');
    client.leave(data.roomId);
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; content: string },
  ) {
    if (!client.data?.userId) throw new WsException('Not authenticated');

    const { userId, firstName, lastName, email } = client.data;
    const senderName = firstName
      ? `${firstName} ${lastName ?? ''}`.trim()
      : email.split('@')[0];

    const message = await this.chatService.sendMessage({
      roomId: data.roomId,
      senderId: userId,
      senderName,
      content: data.content,
    });

    this.server.to(data.roomId).emit('newMessage', message);
    return message;
  }

  @SubscribeMessage('sendAnnouncement')
  async handleAnnouncement(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { content: string },
  ) {
    if (!client.data?.userId) throw new WsException('Not authenticated');
    if (!['ADMIN', 'SUPER_ADMIN', 'MODERATOR'].includes(client.data.role)) {
      throw new WsException('Admin access required');
    }

    const { userId, firstName, lastName, email } = client.data;
    const senderName = firstName
      ? `${firstName} ${lastName ?? ''}`.trim()
      : email.split('@')[0];

    const message = await this.chatService.sendAnnouncement(userId, senderName, data.content);
    this.server.emit('announcement', message);
    return message;
  }
}
