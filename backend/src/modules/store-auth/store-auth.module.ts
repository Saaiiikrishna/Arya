import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StoreAuthController } from './store-auth.controller';
import { StoreAuthService } from './store-auth.service';
import { GuestTokenService } from './guest-token.service';
import { CustomerStrategy, resolveCustomerSecret } from './customer.strategy';
import {
  CustomerJwtGuard,
  GuestCartGuard,
  GuestOrderGuard,
  ArticleAuthorGuard,
} from './guards';

/**
 * Store customer auth: dedicated 'jwt-customer' Passport strategy, guest token
 * minting, and the guards consumed by the store/articles sub-modules.
 *
 * PrismaService is provided globally by the @Global() PrismaModule, so it is
 * injectable here without importing PrismaModule. JwtModule is registered with
 * the DEDICATED customer secret (JWT_CUSTOMER_SECRET, JWT_SECRET fallback) +
 * 15m default expiry, so the default sign()/verify() used by StoreAuthService
 * for ACCESS tokens isolates customer tokens from platform tokens. Refresh
 * tokens are signed explicitly with JWT_REFRESH_SECRET in the service.
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: resolveCustomerSecret(configService),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRATION', '15m') as any,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [StoreAuthController],
  providers: [
    StoreAuthService,
    GuestTokenService,
    CustomerStrategy,
    CustomerJwtGuard,
    GuestCartGuard,
    GuestOrderGuard,
    ArticleAuthorGuard,
  ],
  exports: [
    StoreAuthService,
    GuestTokenService,
    CustomerStrategy,
    CustomerJwtGuard,
    GuestCartGuard,
    GuestOrderGuard,
    ArticleAuthorGuard,
    JwtModule,
  ],
})
export class StoreAuthModule {}
