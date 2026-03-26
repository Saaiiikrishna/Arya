import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: false, // Allow inline scripts for admin dashboard
    crossOriginEmbedderPolicy: false,
  }));

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // CORS
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  const allowedOrigins = [
    frontendUrl,
    'http://localhost:3000',
    'http://localhost:3005',
    'https://aryavartham.com',
    'https://www.aryavartham.com',
  ];
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // Health check endpoint
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/health', (_req: any, res: any) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const port = configService.get<number>('PORT', 3001);
  await app.listen(port);
  console.log(`🚀 Arya Backend running on port ${port}`);
}

bootstrap();
