import { Global, Module } from '@nestjs/common';
import { EmailModule } from '../email';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';

/**
 * Global so any service can inject NotificationService without importing this
 * module everywhere. Centralizes email + WhatsApp dispatch for all milestones.
 */
@Global()
@Module({
  imports: [EmailModule, WhatsappModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
