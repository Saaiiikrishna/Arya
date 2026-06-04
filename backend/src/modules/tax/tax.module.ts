import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { TaxService } from './tax.service';
import { TaxController, TaxAdminController } from './tax.controller';

@Module({
  // PrismaModule is @Global() — PrismaService is already injectable everywhere,
  // so it is intentionally NOT re-imported here (matches payment/whatsapp modules).
  imports: [SettingsModule],
  controllers: [TaxController, TaxAdminController],
  providers: [TaxService],
  exports: [TaxService],
})
export class TaxModule {}
