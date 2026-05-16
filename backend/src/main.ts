import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from './app.module';
import { PrismaService } from './prisma';

async function autoSeed(app: any) {
  const logger = new Logger('AutoSeed');
  try {
    const prisma = app.get(PrismaService);

    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    if (!adminEmail || !adminPassword) {
      logger.warn('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping admin seed');
    } else {
      const hash = await bcrypt.hash(adminPassword, 12);
      await prisma.admin.upsert({
        where: { email: adminEmail },
        update: {},
        create: {
          email: adminEmail,
          passwordHash: hash,
          firstName: 'Super',
          lastName: 'Admin',
          role: 'SUPER_ADMIN',
        },
      });
      logger.log(`Admin account verified: ${adminEmail}`);
    }

    // Ensure Batch 1 exists
    const batch = await prisma.batch.upsert({
      where: { batchNumber: 1 },
      update: {},
      create: { batchNumber: 1 },
    });

    // Ensure test applicant exists (only when explicitly enabled via env flag)
    if (process.env.ENABLE_TEST_SEED === 'true') {
      const existing = await prisma.applicant.findUnique({ where: { email: 'test@arya.com' } });
      await prisma.applicant.upsert({
        where: { email: 'test@arya.com' },
        update: {},
        create: {
          email: 'test@arya.com',
          firstName: 'Test',
          lastName: 'Founder',
          phone: '+919999999999',
          accessToken: existing?.accessToken ?? uuidv4(),
          batchId: batch.id,
          status: 'PENDING',
          city: 'Hyderabad',
          age: 28,
          vocation: 'Full-Stack Engineer & Product Builder',
          obsession: 'Democratizing access to startup infrastructure for first-generation founders in India.',
          heresy: 'Most accelerators optimize for investor returns, not founder success. The model is broken.',
          scarTissue: 'Built a SaaS product that reached 500 users but failed to monetize. Shut down after 14 months.',
        } as any,
      });
      logger.log('Test account verified: test@arya.com');
    }
  } catch (error) {
    logger.warn('Auto-seed skipped (non-fatal): ' + (error as any)?.message);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const configService = app.get(ConfigService);

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'https:'],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false, // Prevents blocking Google Auth popups
    crossOriginResourcePolicy: false, // Allows cross-origin API fetches
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
  httpAdapter.get('/', (_req: any, res: any) => {
    res.status(200).send('Arya Backend API');
  });

  const port = configService.get<number>('PORT', 3001);
  await app.listen(port);
  console.log(`🚀 Arya Backend running on port ${port}`);

  // Auto-seed critical data (idempotent)
  await autoSeed(app);
}

bootstrap();

