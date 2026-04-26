import { Module, Global } from '@nestjs/common';
import { BadgeService } from './badge.service';
import { CertificateService } from './certificate.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Global()
@Module({
  imports: [WhatsappModule],
  providers: [BadgeService, CertificateService],
  exports: [BadgeService, CertificateService],
})
export class RewardsModule {}
