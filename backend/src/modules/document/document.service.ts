import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

/**
 * Allowed upload MIME types mapped to their permitted file-name extensions.
 * Restricted to the document/image formats expected for consent + ID uploads.
 */
const ALLOWED_MIME_TYPES: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/jpg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'image/heic': ['heic'],
  'image/heif': ['heif'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'docx',
  ],
};

/**
 * Intended max upload size (25 MiB). NOTE: this cannot be enforced on a
 * presigned PUT URL — getSignedUrl signs ContentLength as an EXACT required
 * value, so signing the max here would force every client to send exactly that
 * many bytes and break real uploads. A true size cap requires a presigned POST
 * with a `content-length-range` policy condition (separate SDK), or a bucket
 * policy. Documented here so it isn't silently dropped.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
void MAX_UPLOAD_BYTES;

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
    const { safeFileName, normalizedMimeType } = this.validateUploadInput(
      fileName,
      mimeType,
    );

    const key = `documents/${applicantId}/${uuidv4()}-${safeFileName}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: normalizedMimeType,
      // ContentType is signed (the client must send a matching Content-Type, so
      // the mimeType allowlist is enforced). Size is NOT capped here — see the
      // MAX_UPLOAD_BYTES note; signing an exact ContentLength would break PUTs.
    });

    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: 3600,
    });

    // Create document record
    const document = await this.prisma.document.create({
      data: {
        applicantId,
        fileName: safeFileName,
        fileUrl: key,
        mimeType: normalizedMimeType,
        status: 'PENDING',
      },
    });

    return { uploadUrl, documentId: document.id, key };
  }

  async confirmUpload(documentId: string, applicantId: string, fileSize?: number) {
    if (fileSize !== undefined) {
      if (!Number.isInteger(fileSize) || fileSize < 0) {
        throw new BadRequestException('Invalid file size');
      }
      if (fileSize > MAX_UPLOAD_BYTES) {
        throw new BadRequestException(
          `File exceeds the maximum allowed size of ${MAX_UPLOAD_BYTES} bytes`,
        );
      }
    }

    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.applicantId !== applicantId) throw new NotFoundException('Document not found');

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

  /**
   * Validates the requested mimeType against the allowlist and ensures the
   * file-name extension matches it. Returns a sanitized file name (basename
   * only, no path traversal) plus the normalized mimeType to sign/store.
   */
  private validateUploadInput(
    fileName: string,
    mimeType: string,
  ): { safeFileName: string; normalizedMimeType: string } {
    if (typeof fileName !== 'string' || typeof mimeType !== 'string') {
      throw new BadRequestException('fileName and mimeType are required');
    }

    const normalizedMimeType = mimeType.trim().toLowerCase();
    const allowedExtensions = ALLOWED_MIME_TYPES[normalizedMimeType];
    if (!allowedExtensions) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }

    // Strip any directory components to prevent path traversal in the S3 key.
    const baseName = fileName.replace(/^.*[\\/]/, '').trim();
    if (!baseName || baseName === '.' || baseName === '..') {
      throw new BadRequestException('Invalid file name');
    }

    const dotIndex = baseName.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === baseName.length - 1) {
      throw new BadRequestException('File name must include a valid extension');
    }
    const extension = baseName.slice(dotIndex + 1).toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      throw new BadRequestException(
        `File extension ".${extension}" does not match the declared type ${normalizedMimeType}`,
      );
    }

    return { safeFileName: baseName, normalizedMimeType };
  }
}
