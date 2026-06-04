import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * Stable, explicit marker that this object is the full PrismaService (not an
   * interactive `Prisma.TransactionClient`). Consumers (e.g. InventoryService)
   * use this to decide whether to reuse an open transaction or open a new one,
   * instead of duck-typing on the presence of `$transaction` — which is a
   * Prisma internal that could change between versions.
   */
  readonly IS_PRISMA_SERVICE = true as const;

  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('DATABASE_URL');
    
    // Explicit Node.js pool tailored for Serverless / Azure Container Apps limits
    const pool = new Pool({ 
      connectionString,
      max: process.env.NODE_ENV === 'production' ? 20 : 5, // Reserve connections per instance
      idleTimeoutMillis: 10000, 
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: true
    });
    
    const adapter = new PrismaPg(pool as any);
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
