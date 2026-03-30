import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
