import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { DocumentModule } from '../document/document.module';
import { CatalogService } from './catalog.service';
import { CatalogController, CatalogAdminGuard } from './catalog.controller';

@Module({
  // PrismaModule: DB access. AuthModule: registers the 'jwt' Passport strategy
  // that AdminGuard extends. SettingsModule: exports VisitorService, which is
  // injected into CatalogController for best-effort page-view tracking on public
  // detail routes (the service itself does not use it). DocumentModule: exports
  // DocumentService, injected into CatalogService to presign READ urls for list
  // thumbnails (first CONFIRMED product image). ConfigService (S3 creds for media
  // presign) is resolved from the global ConfigModule.
  imports: [PrismaModule, AuthModule, SettingsModule, DocumentModule],
  controllers: [CatalogController],
  // CatalogAdminGuard is the class-level guard on CatalogController (applies
  // AdminGuard to every route except those marked @Public()). It is registered
  // as a provider so Nest's DI injects its Reflector dependency.
  providers: [CatalogService, CatalogAdminGuard],
  exports: [CatalogService],
})
export class CatalogModule {}
