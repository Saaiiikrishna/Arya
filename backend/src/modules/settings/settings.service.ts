import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.region = this.config.get<string>('AWS_REGION', 'ap-south-1');
    this.bucket = this.config.get<string>('AWS_S3_BUCKET', 'arya-documents');
    this.s3 = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.config.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.config.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
  }

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
    const publicKeys = [
      'logoMode',
      'pledgePricing',
      'next_batch_date',
      'homepageSections',
      'social_twitter',
      'social_linkedin',
      'social_instagram',
    ];
    const settings = await this.prisma.siteSetting.findMany({
      where: { key: { in: publicKeys } },
    });
    return settings.reduce(
      (acc, s) => ({ ...acc, [s.key]: s.value }),
      {} as Record<string, string>,
    );
  }

  async getMediaUploadUrl(
    fileName: string,
    mimeType: string,
  ): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
    const ext = fileName.split('.').pop() ?? 'bin';
    const key = `homepage-media/${uuidv4()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    const publicUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    return { uploadUrl, publicUrl, key };
  }
}
