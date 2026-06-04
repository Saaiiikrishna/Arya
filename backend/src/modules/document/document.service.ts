import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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
 * Maximum allowed upload size (25 MiB). A presigned PUT can't pre-enforce a max
 * (signing ContentLength forces an EXACT length), so we enforce it AUTHORITATIVELY
 * at confirm time: HeadObject reads the real stored size and an oversized object
 * is purged + rejected (the client-reported size is treated as advisory only).
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

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
    if (fileSize !== undefined && (!Number.isInteger(fileSize) || fileSize < 0)) {
      throw new BadRequestException('Invalid file size');
    }

    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.applicantId !== applicantId) throw new NotFoundException('Document not found');

    // Authoritative size: read the actually-stored object size from S3. The
    // client-supplied fileSize is spoofable, so it's only a fallback when the
    // HeadObject can't be performed (e.g. no real S3 in local dev).
    let actualSize: number | undefined = fileSize;
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: doc.fileUrl }),
      );
      if (typeof head.ContentLength === 'number') actualSize = head.ContentLength;
    } catch (e) {
      this.logger.warn(
        `HeadObject failed for ${doc.fileUrl}; using client-reported size: ${(e as any)?.message}`,
      );
    }

    if (typeof actualSize === 'number' && actualSize > MAX_UPLOAD_BYTES) {
      // Oversized — purge the object so it can never be used, and fail the confirm.
      try {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: doc.fileUrl }));
      } catch {
        /* best-effort cleanup */
      }
      await this.prisma.document.delete({ where: { id: documentId } }).catch(() => undefined);
      throw new BadRequestException(
        `File exceeds the maximum allowed size of ${MAX_UPLOAD_BYTES} bytes`,
      );
    }

    return this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'UPLOADED', fileSize: actualSize },
    });
  }

  /**
   * Direct server-side PutObject for SERVER-GENERATED artifacts (invoice/label
   * PDFs) — NOT the client presign+confirm flow (architecture 8.7). The buffer is
   * rendered in-process (e.g. pdfkit) and written straight to S3 under the caller's
   * key. No Document row is created; the caller persists its own key reference
   * (e.g. Invoice.pdfS3Key). The bucket IAM policy must grant `s3:PutObject`.
   *
   * Returns the stored key on success. Throws BadRequestException on an S3 failure
   * so the caller (an idempotent, retryable job) can surface/retry rather than
   * silently treating a non-uploaded artifact as stored.
   */
  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ key: string }> {
    if (!key || typeof key !== 'string') {
      throw new BadRequestException('A storage key is required');
    }
    if (!Buffer.isBuffer(body)) {
      throw new BadRequestException('putObject body must be a Buffer');
    }
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } catch (e) {
      this.logger.error(
        `putObject failed for ${key}: ${(e as Error)?.message}`,
      );
      throw new BadRequestException('Failed to store generated document');
    }
    return { key };
  }

  /**
   * Presigned GET for an arbitrary S3 key (server-generated artifacts that have no
   * Document row, e.g. an invoice PDF referenced by Invoice.pdfS3Key). Mirrors
   * {@link getDownloadUrl} but takes a raw key rather than a Document id.
   */
  async getSignedDownloadUrlForKey(
    key: string,
    expiresIn = 3600,
  ): Promise<string> {
    if (!key || typeof key !== 'string') {
      throw new BadRequestException('A storage key is required');
    }
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn });
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
