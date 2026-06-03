import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DocumentaryService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.s3 = new S3Client({
      region: this.configService.get<string>('AWS_REGION', 'ap-south-1'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
    this.bucket = this.configService.get<string>('AWS_S3_BUCKET', 'arya-documents');
  }

  // ─── Admin / Co-founder ───────────────────────────────────

  async getUploadUrl(
    teamId: string,
    uploadedById: string,
    uploadedByRole: string,
    dto: { fileName: string; mimeType: string; week: number; title: string; description?: string },
  ) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team not found');

    const key = `documentary/${teamId}/week-${dto.week}/${uuidv4()}-${dto.fileName}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: dto.mimeType,
    });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 3600 });

    const clip = await (this.prisma as any).documentaryClip.create({
      data: {
        teamId,
        week: dto.week,
        title: dto.title,
        description: dto.description,
        videoUrl: key,
        uploadedById,
        uploadedByRole,
      },
    });

    return { uploadUrl, clipId: clip.id, key };
  }

  async confirmUpload(clipId: string, thumbnailUrl?: string) {
    const clip = await (this.prisma as any).documentaryClip.findUnique({ where: { id: clipId } });
    if (!clip) throw new NotFoundException('Clip not found');

    return (this.prisma as any).documentaryClip.update({
      where: { id: clipId },
      data: { ...(thumbnailUrl ? { thumbnailUrl } : {}) },
    });
  }

  async togglePublish(clipId: string, publish: boolean) {
    const clip = await (this.prisma as any).documentaryClip.findUnique({ where: { id: clipId } });
    if (!clip) throw new NotFoundException('Clip not found');

    return (this.prisma as any).documentaryClip.update({
      where: { id: clipId },
      data: {
        isPublished: publish,
        publishedAt: publish ? new Date() : null,
      },
    });
  }

  async listClips(teamId: string, publishedOnly = false) {
    const where: any = { teamId };
    if (publishedOnly) where.isPublished = true;

    return (this.prisma as any).documentaryClip.findMany({
      where,
      orderBy: [{ week: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async deleteClip(clipId: string) {
    const clip = await (this.prisma as any).documentaryClip.findUnique({ where: { id: clipId } });
    if (!clip) throw new NotFoundException('Clip not found');
    await (this.prisma as any).documentaryClip.delete({ where: { id: clipId } });
    return { success: true };
  }

  // ─── Stream URL ───────────────────────────────────────────

  async getStreamUrl(clipId: string, publishedOnly = false) {
    const clip = await (this.prisma as any).documentaryClip.findUnique({ where: { id: clipId } });
    if (!clip) throw new NotFoundException('Clip not found');
    if (publishedOnly && !clip.isPublished) throw new NotFoundException('Clip not found');

    const command = new GetObjectCommand({ Bucket: this.bucket, Key: clip.videoUrl });
    const url = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    return { url, clip };
  }

  // ─── Investor: published clips for a team ─────────────────

  async getPublishedClips(teamId: string) {
    return (this.prisma as any).documentaryClip.findMany({
      where: { teamId, isPublished: true },
      orderBy: { week: 'asc' },
      select: { id: true, week: true, title: true, description: true, thumbnailUrl: true, publishedAt: true },
    });
  }
}
