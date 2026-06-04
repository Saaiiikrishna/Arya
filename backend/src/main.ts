import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from './app.module';
import { PrismaService } from './prisma';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { RedisIoAdapter } from './redis-io.adapter';

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
    if (isDatabaseUnreachable(error)) {
      logger.error(
        'Auto-seed failed: database is unreachable — aborting boot. ' +
          (error as any)?.message,
      );
      throw error;
    }
    logger.warn('Auto-seed skipped (non-fatal): ' + (error as any)?.message);
  }
}

/**
 * Returns true when the error indicates Prisma could not reach / initialize the
 * database connection (vs. a benign, idempotent data-level error we can skip).
 * A genuinely unreachable DB must fail boot rather than be silently swallowed.
 */
function isDatabaseUnreachable(error: unknown): boolean {
  const e = error as any;
  const name: string = e?.name ?? '';
  const code: string = e?.code ?? '';

  // Prisma connection / initialization errors.
  if (name === 'PrismaClientInitializationError') return true;
  if (name === 'PrismaClientRustPanicError') return true;

  // Prisma known connection-level error codes:
  //  P1000 auth failed, P1001 can't reach server, P1002 timed out,
  //  P1003 db does not exist, P1008 operation timed out,
  //  P1010 access denied, P1017 server closed connection.
  if (['P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1010', 'P1017'].includes(code)) {
    return true;
  }

  // Underlying socket-level network failures (driver adapter / pg).
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH'].includes(code)) {
    return true;
  }

  return false;
}

async function bootstrap() {
  // rawBody: true keeps req.rawBody for webhook HMAC verification (Razorpay/WhatsApp).
  // bodyParser: false disables Nest's default (100kb) parsers so we can register
  // ours with an explicit size limit below — rawBody capture is preserved because
  // useBodyParser still threads the rawBody verify hook through.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
  });

  // Request body-size limits (defends against oversized-payload DoS) while
  // keeping the rawBody buffer intact for webhook signature verification.
  const bodyLimit = '1mb';
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

  // Clean JSON errors; full detail logged server-side, nothing leaked to clients.
  app.useGlobalFilters(new AllExceptionsFilter());

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

  // Socket.IO Redis adapter — fans real-time events out across all replicas
  // (1–10 on Azure Container Apps). Applies to every gateway automatically.
  // useWebSocketAdapter MUST be called before app.listen(): Nest binds the
  // gateways' Socket.IO servers during listen(), so the adapter has to be
  // installed first to take effect — calling it after listen() is a no-op.
  // Wrapped in try/catch so a Redis outage still lets the app boot on the
  // default in-memory adapter (degraded: single-replica fan-out only).
  if (configService.get<string>('REDIS_HOST')) {
    try {
      const redisIoAdapter = new RedisIoAdapter(app);
      await redisIoAdapter.connectToRedis(configService);
      app.useWebSocketAdapter(redisIoAdapter);
    } catch (error) {
      new Logger('Bootstrap').warn(
        'Socket.IO Redis adapter unavailable — falling back to in-memory adapter ' +
          '(real-time events will not fan out across replicas): ' +
          (error as any)?.message,
      );
    }
  }

  // Auto-seed critical data (idempotent) — must complete before accepting traffic
  await autoSeed(app);
  await app.listen(port);
  console.log(`🚀 Arya Backend running on port ${port}`);
}

// Process-level safety nets: log loudly instead of dying silently.
const processLogger = new Logger('Process');

process.on('unhandledRejection', (reason: unknown) => {
  processLogger.error(
    'Unhandled promise rejection',
    reason instanceof Error ? reason.stack : String(reason),
  );
});

process.on('uncaughtException', (error: Error) => {
  processLogger.error('Uncaught exception', error?.stack ?? String(error));
  // An uncaught exception leaves the process in an undefined state; exit so the
  // orchestrator (Docker/PM2/systemd) can restart a clean instance.
  process.exit(1);
});

bootstrap().catch((error) => {
  processLogger.error(
    'Fatal error during bootstrap — aborting boot',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});

