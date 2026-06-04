import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { AuthModule } from '../auth/auth.module';
import { StoreAuthModule } from '../store-auth';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { ReviewsAdminController } from './reviews-admin.controller';

/**
 * Product reviews & ratings (REVIEW API CONTRACT).
 *
 *  - PrismaModule   → DB access (@Global, but imported explicitly per repo style).
 *  - AuthModule     → registers the platform 'jwt' Passport strategy that
 *                     AdminGuard (on ReviewsAdminController) extends.
 *  - StoreAuthModule→ registers the dedicated 'jwt-customer' Passport strategy
 *                     that CustomerJwtGuard (on the submit route) activates.
 *
 * Two controllers: the store-facing public/customer surface (ReviewsController)
 * and the AdminGuard-class-level moderation surface (ReviewsAdminController).
 *
 * ReviewsService is NOT exported: no sibling module currently consumes it
 * (catalog owns its OWN rating projection and is intentionally NOT touched), and
 * the repo convention is minimal exports — a service is exported only when a
 * concrete consumer needs it (cf. CartModule→OrdersModule). Add the export back
 * if/when a real consumer appears.
 */
@Module({
  imports: [PrismaModule, AuthModule, StoreAuthModule],
  controllers: [ReviewsController, ReviewsAdminController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
