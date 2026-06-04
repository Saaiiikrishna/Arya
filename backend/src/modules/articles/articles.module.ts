import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StoreAuthModule } from '../store-auth';
import { SettingsModule } from '../settings/settings.module';
import { ArticlesService } from './articles.service';
import { ArticlesController } from './articles.controller';
import { ArticlesAdminController } from './articles-admin.controller';

/**
 * Articles vertical (architecture Section 10): user-submitted articles authored
 * by EITHER a store customer or a platform applicant, with admin moderation,
 * row-reserved media caps, GIN-overlap related articles, and an author-vs-admin
 * metrics visibility split.
 *
 * Imports:
 *  - AuthModule      → registers the platform 'jwt' Passport strategy that both
 *                      AdminGuard and the 'jwt' arm of ArticleAuthorGuard use.
 *  - StoreAuthModule → provides ArticleAuthorGuard and registers the dedicated
 *                      'jwt-customer' strategy (its other arm), so a CUSTOMER or
 *                      APPLICANT token both authenticate to author routes.
 *  - SettingsModule  → exports VisitorService, injected into ArticlesController
 *                      for best-effort page-view tracking on the public slug
 *                      detail route (mirrors CatalogController; Section 10).
 *
 * PrismaService (@Global PrismaModule), ConfigService (@Global ConfigModule),
 * and EmailService (@Global EmailModule) are injectable without an import.
 *
 * EXPORTS ArticlesService for any future sibling (e.g. a store-jobs viewCount
 * sync or admin analytics aggregator) that needs article reads.
 */
@Module({
  imports: [AuthModule, StoreAuthModule, SettingsModule],
  controllers: [ArticlesController, ArticlesAdminController],
  providers: [ArticlesService],
  exports: [ArticlesService],
})
export class ArticlesModule {}
