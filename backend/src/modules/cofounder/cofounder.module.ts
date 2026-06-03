import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma';
import { CoFounderService } from './cofounder.service';
import { CoFounderController } from './cofounder.controller';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: configService.get('JWT_EXPIRATION', '15m') as any },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [CoFounderController],
  providers: [CoFounderService],
  exports: [CoFounderService],
})
export class CoFounderModule {}
