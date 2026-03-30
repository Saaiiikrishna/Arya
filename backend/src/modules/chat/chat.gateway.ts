import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ChatService } from './chat.service';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(private readonly chatService: ChatService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    client.join(data.roomId);
    this.logger.log(`Client ${client.id} joined room ${data.roomId}`);

    // Send recent messages
    const messages = await this.chatService.getMessages(data.roomId);
    client.emit('recentMessages', messages.reverse());
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    client.leave(data.roomId);
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      roomId: string;
      senderId: string;
      senderName: string;
      content: string;
    },
  ) {
    const message = await this.chatService.sendMessage(data);
    this.server.to(data.roomId).emit('newMessage', message);
    return message;
  }

  @SubscribeMessage('sendAnnouncement')
  async handleAnnouncement(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      senderId: string;
      senderName: string;
      content: string;
    },
  ) {
    const message = await this.chatService.sendAnnouncement(
      data.senderId,
      data.senderName,
      data.content,
    );
    this.server.emit('announcement', message);
    return message;
  }
}
