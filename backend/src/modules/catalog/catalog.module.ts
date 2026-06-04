import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';

@Module({
  // PrismaModule: DB access. AuthModule: registers the 'jwt' Passport strategy
  // that AdminGuard extends. SettingsModule: exports VisitorService, which is
  // injected into CatalogController for best-effort page-view tracking on public
  // detail routes (the service itself does not use it). ConfigService (S3 creds
  // for media presign) is resolved from the global ConfigModule.
  imports: [PrismaModule, AuthModule, SettingsModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
