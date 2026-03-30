import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    const setting = await this.prisma.siteSetting.findUnique({ where: { key } });
    return setting?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.siteSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    this.logger.log(`Setting updated: ${key}`);
  }

  async getAll(): Promise<Record<string, string>> {
    const settings = await this.prisma.siteSetting.findMany();
    return settings.reduce(
      (acc, s) => ({ ...acc, [s.key]: s.value }),
      {} as Record<string, string>,
    );
  }

  async bulkSet(data: Record<string, string>): Promise<void> {
    const ops = Object.entries(data).map(([key, value]) =>
      this.prisma.siteSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      }),
    );
    await this.prisma.$transaction(ops);
    this.logger.log(`Bulk settings updated: ${Object.keys(data).join(', ')}`);
  }

  /**
   * Returns only settings safe for public consumption (no secrets).
   */
  async getPublicSettings(): Promise<Record<string, string>> {
    const publicKeys = ['logoMode'];
    const settings = await this.prisma.siteSetting.findMany({
      where: { key: { in: publicKeys } },
    });
    return settings.reduce(
      (acc, s) => ({ ...acc, [s.key]: s.value }),
      {} as Record<string, string>,
    );
  }
}
