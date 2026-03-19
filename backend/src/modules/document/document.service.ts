import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DocumentService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly logger = new Logger(DocumentService.name);

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

  async getUploadUrl(applicantId: string, fileName: string, mimeType: string) {
    const key = `documents/${applicantId}/${uuidv4()}-${fileName}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 3600 });

    // Create document record
    const document = await this.prisma.document.create({
      data: {
        applicantId,
        fileName,
        fileUrl: key,
        mimeType,
        status: 'PENDING',
      },
    });

    return { uploadUrl, documentId: document.id, key };
  }

  async confirmUpload(documentId: string, fileSize?: number) {
    return this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'UPLOADED', fileSize },
    });
  }

  async getDownloadUrl(documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException('Document not found');

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: document.fileUrl,
    });

    const downloadUrl = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    return { downloadUrl, document };
  }

  async getByApplicant(applicantId: string) {
    return this.prisma.document.findMany({
      where: { applicantId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async verify(documentId: string) {
    return this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'VERIFIED', verifiedAt: new Date() },
    });
  }
}
