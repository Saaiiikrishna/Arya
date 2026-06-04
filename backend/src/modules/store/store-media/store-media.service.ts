import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { ProductMediaType, ProductMediaStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma';
import { ConfirmMediaDto } from './dto';

/**
 * MIME allowlist mapped to permitted file-name extensions, split by media type.
 *
 * Images reuse the document/image formats already accepted by DocumentService
 * (png/jpeg/webp/heic/heif). Videos accept the web-deliverable container set
 * (mp4/webm/quicktime) per architecture Section 9.
 */
const IMAGE_MIME_TYPES: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  // non-standard alias sent by some mobile browsers; intentionally accepted
  'image/jpg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'image/heic': ['heic'],
  'image/heif': ['heif'],
};

const VIDEO_MIME_TYPES: Readonly<Record<string, readonly string[]>> = {
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
  'video/quicktime': ['mov', 'qt'],
};

/** Per-media-type caps. Product: 10 IMAGE + 1 VIDEO (architecture Section 9). */
const PRODUCT_CAPS: Readonly<Record<ProductMediaType, number>> = {
  [ProductMediaType.IMAGE]: 10,
  [ProductMediaType.VIDEO]: 1,
};

/**
 * Per-type maximum stored byte size, enforced AUTHORITATIVELY at confirm time
 * via HeadObject (a presigned PUT cannot pre-enforce a ceiling — signing an
 * exact ContentLength would break the upload). Images are capped smaller than
 * video.
 *
 * Exported so the ConfirmMediaDto can bound the advisory `fileSize` field with
 * `@Max(MAX_VIDEO_BYTES)` and keep the validation ceiling in one place.
 */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MiB
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MiB

/** Presigned PUT URL validity. Orphan PENDING rows are swept after this TTL. */
const PRESIGN_TTL_SECONDS = 3600; // 1 hour

@Injectable()
export class StoreMediaService implements OnModuleInit {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly logger = new Logger(StoreMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.s3 = new S3Client({
      region: this.configService.get<string>('AWS_REGION', 'ap-south-1'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.configService.get<string>(
          'AWS_SECRET_ACCESS_KEY',
          '',
        ),
      },
    });
    this.bucket = this.configService.get<string>(
      'AWS_S3_BUCKET',
      'arya-documents',
    );
  }

  /**
   * Fail-fast in production if AWS credentials are absent. With empty-string
   * credentials the SDK silently falls through to the instance-metadata chain;
   * on a non-AWS host that yields an obscure timeout on the first S3 call
   * instead of a clear startup error. This mirrors how PaymentService guards
   * missing Razorpay keys at bootstrap.
   */
  onModuleInit(): void {
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID', '');
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
      '',
    );
    if (isProd && (!accessKeyId || !secretAccessKey)) {
      throw new Error(
        'StoreMediaService: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required in production',
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRODUCT MEDIA
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Reserve a media slot for a product and issue a presigned S3 PUT URL.
   *
   * Closes the parallel-presign race: the PENDING row is INSERTED *inside* the
   * advisory-locked transaction *before* the cap count is asserted, so eleven
   * concurrent presigns can no longer all read count=0 and oversubscribe the
   * cap. The advisory lock serializes presigns for the same (product,type)
   * bucket; the count then sees every already-reserved (PENDING or CONFIRMED)
   * row. Only after a successful reservation is the presigned URL signed.
   *
   * @throws NotFoundException  product does not exist
   * @throws BadRequestException invalid MIME / extension / filename
   * @throws ConflictException   409 MEDIA_CAP_REACHED — bucket is full
   */
  async presignProductMedia(
    productId: string,
    type: ProductMediaType,
    filename: string,
    mime: string,
  ): Promise<{ uploadUrl: string; mediaId: string; remaining: number }> {
    const cap = PRODUCT_CAPS[type];
    if (cap === undefined) {
      throw new BadRequestException(`Unsupported media type: ${String(type)}`);
    }

    const { safeFileName, normalizedMimeType } = this.validateMediaInput(
      type,
      filename,
      mime,
    );

    // Reserve the slot transactionally under an advisory lock scoped to the
    // (product, type) bucket so concurrent presigns serialize and each sees the
    // others' freshly-inserted PENDING rows.
    const { mediaId, s3Key, remaining } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`product_media_${productId}_${type}`}))`;

        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { id: true },
        });
        if (!product) {
          throw new NotFoundException('Product not found');
        }

        const current = await tx.productMedia.count({
          where: {
            productId,
            type,
            status: {
              in: [ProductMediaStatus.PENDING, ProductMediaStatus.CONFIRMED],
            },
          },
        });

        if (current >= cap) {
          // Aborts the transaction (rolls back any prior work in it) and frees
          // the lock. Mapped to a specific status per the no-silent-failure rule.
          throw new ConflictException(
            `MEDIA_CAP_REACHED: product already has the maximum of ${cap} ${type} media`,
          );
        }

        const key = `store/products/${productId}/${type.toLowerCase()}/${uuidv4()}-${safeFileName}`;

        const created = await tx.productMedia.create({
          data: {
            productId,
            type,
            status: ProductMediaStatus.PENDING,
            s3Key: key,
            sortOrder: current, // append after existing slots; adjustable at confirm
          },
          select: { id: true },
        });

        return {
          mediaId: created.id,
          s3Key: key,
          // remaining AFTER this reservation (min 0)
          remaining: Math.max(0, cap - (current + 1)),
        };
      },
    );

    // Sign the URL only after the slot is durably reserved.
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      ContentType: normalizedMimeType,
      // ContentType is signed: the client must PUT a matching Content-Type, so
      // the MIME allowlist is enforced on upload. Size is NOT capped here — it
      // is enforced authoritatively at confirm via HeadObject.
    });

    let uploadUrl: string;
    try {
      uploadUrl = await getSignedUrl(this.s3, command, {
        expiresIn: PRESIGN_TTL_SECONDS,
      });
    } catch (e) {
      // Signing failed after the slot was reserved — release the reservation so
      // the cap slot is not permanently leaked, then surface a clean error.
      await this.prisma.productMedia
        .delete({ where: { id: mediaId } })
        .catch(() => undefined);
      this.logger.error(
        `Failed to sign upload URL for product ${productId}: ${
          (e as Error)?.message
        }`,
      );
      throw new BadRequestException('Could not generate upload URL');
    }

    return { uploadUrl, mediaId, remaining };
  }

  /**
   * Promote a reserved PENDING media row to CONFIRMED after verifying the
   * uploaded object exists and is within the per-type byte cap.
   *
   * The authoritative size is read from S3 via HeadObject — the client-reported
   * `dto.fileSize` is advisory and is used ONLY as a non-production fallback
   * when HeadObject cannot run (e.g. local dev with no real S3). On a size
   * violation the PENDING row is deleted and the S3 object purged so the slot
   * is freed and the object can never be used.
   *
   * Not a strict no-op when called on an already-CONFIRMED row: a second
   * confirm applies any provided `caption` / `altText` / `sortOrder` metadata
   * edits and returns the updated row.
   *
   * @throws NotFoundException   media row not found / not owned by product
   * @throws BadRequestException object missing, inaccessible, or oversized
   */
  async confirmProductMedia(productId: string, dto: ConfirmMediaDto) {
    const media = await this.prisma.productMedia.findUnique({
      where: { id: dto.mediaId },
    });
    if (!media || media.productId !== productId) {
      throw new NotFoundException('Media not found');
    }

    if (media.status === ProductMediaStatus.CONFIRMED) {
      // Already confirmed — apply any metadata edits and return idempotently.
      return this.prisma.productMedia.update({
        where: { id: media.id },
        data: {
          caption: dto.caption ?? media.caption,
          altText: dto.altText ?? media.altText,
          sortOrder: dto.sortOrder ?? media.sortOrder,
        },
      });
    }

    const maxBytes =
      media.type === ProductMediaType.VIDEO ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

    // Authoritative size is read from S3 below. Do NOT seed actualSize from the
    // spoofable advisory value before HeadObject runs — otherwise a HeadObject
    // failure would leave the client-controlled size as the only size gate.
    let actualSize: number | undefined;
    let objectExists = false;
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: media.s3Key }),
      );
      objectExists = true;
      if (typeof head.ContentLength === 'number') {
        actualSize = head.ContentLength;
      }
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status === 404) {
        // Definitive 'object absent' — the client never completed the PUT.
        objectExists = false;
      } else {
        // 403/503/timeout/network — the object may exist but is unverifiable.
        // Refuse to promote: silently confirming an inaccessible object (and
        // falling back to the spoofable advisory size) is a size-enforcement
        // bypass. Surface a retryable error instead.
        this.logger.warn(
          `HeadObject failed for ${media.s3Key} (status=${
            status ?? 'unknown'
          }): ${(e as Error)?.message}`,
        );
        throw new BadRequestException('Upload verification failed; try again');
      }
    }

    // Advisory-size fallback is permitted ONLY when the object was confirmed to
    // be definitively absent in a non-production environment (local dev without
    // a real S3 backing). In production a 404 means the upload never landed.
    const allowAdvisoryFallback =
      this.configService.get<string>('NODE_ENV') !== 'production';

    if (!objectExists) {
      if (allowAdvisoryFallback && typeof dto.fileSize === 'number') {
        actualSize = dto.fileSize;
      } else {
        // No object in S3 and no permitted advisory fallback — the client never
        // completed the PUT. Do not promote a phantom row.
        throw new BadRequestException(
          'Uploaded object not found; complete the upload before confirming',
        );
      }
    }

    if (typeof actualSize === 'number' && actualSize > maxBytes) {
      // Oversized — purge object + free the slot, then reject.
      await this.purgeObject(media.s3Key);
      await this.prisma.productMedia
        .delete({ where: { id: media.id } })
        .catch(() => undefined);
      this.logger.warn(
        `Rejected oversized ${media.type} media ${media.id} for product ${productId}: ${actualSize} bytes > cap ${maxBytes} (slot freed, object purged)`,
      );
      throw new BadRequestException(
        `File exceeds the maximum allowed size of ${maxBytes} bytes for ${media.type} media`,
      );
    }

    return this.prisma.productMedia.update({
      where: { id: media.id },
      data: {
        status: ProductMediaStatus.CONFIRMED,
        caption: dto.caption ?? media.caption,
        altText: dto.altText ?? media.altText,
        sortOrder: dto.sortOrder ?? media.sortOrder,
      },
    });
  }

  /**
   * Delete a product media row and best-effort purge its S3 object. Frees the
   * reserved cap slot regardless of PENDING/CONFIRMED status.
   *
   * @throws NotFoundException media row not found / not owned by product
   */
  async deleteProductMedia(productId: string, mediaId: string) {
    const media = await this.prisma.productMedia.findUnique({
      where: { id: mediaId },
    });
    if (!media || media.productId !== productId) {
      throw new NotFoundException('Media not found');
    }

    await this.prisma.productMedia.delete({ where: { id: mediaId } });
    await this.purgeObject(media.s3Key);

    return { deleted: true, mediaId };
  }

  /**
   * List media for a product. Public read paths pass `confirmedOnly=true` so
   * abandoned/in-flight PENDING reservations never leak to customers; admin
   * surfaces may list everything.
   */
  async listProductMedia(productId: string, confirmedOnly = false) {
    return this.prisma.productMedia.findMany({
      where: {
        productId,
        ...(confirmedOnly ? { status: ProductMediaStatus.CONFIRMED } : {}),
      },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GC / MAINTENANCE
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Sweep orphan PENDING ProductMedia rows older than `olderThanMinutes` (rows
   * whose client abandoned the PUT after the presign-URL TTL elapsed), freeing
   * the reserved cap slot. Best-effort purges each row's S3 object. Intended to
   * be driven by the `store-media-gc` cron (every ~30 min); idempotent.
   *
   * @returns count of swept rows
   */
  async gcOrphanPendingProductMedia(olderThanMinutes = 60): Promise<{
    swept: number;
  }> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    const orphans = await this.prisma.productMedia.findMany({
      where: {
        status: ProductMediaStatus.PENDING,
        createdAt: { lt: cutoff },
      },
      select: { id: true, s3Key: true },
    });

    if (orphans.length === 0) {
      return { swept: 0 };
    }

    const ids = orphans.map((o) => o.id);
    // Free the cap slots first (the authoritative reservation), then best-effort
    // purge S3. Deleting by the snapshotted id set is idempotent.
    const result = await this.prisma.productMedia.deleteMany({
      where: { id: { in: ids } },
    });

    await Promise.all(orphans.map((o) => this.purgeObject(o.s3Key)));

    this.logger.log(`store-media-gc swept ${result.count} orphan PENDING rows`);
    return { swept: result.count };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTERNALS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Best-effort S3 object delete; never throws (callers have already committed
   * the authoritative DB change). Generic and reused by product + future
   * article media.
   */
  private async purgeObject(key: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (e) {
      this.logger.warn(
        `Best-effort S3 delete failed for ${key}: ${(e as Error)?.message}`,
      );
    }
  }

  /**
   * Validate filename + MIME against the per-type allowlist and ensure the
   * extension matches the declared MIME. Strips directory components AND
   * normalizes the remaining basename to a strict safe-filename allowlist to
   * defeat path traversal and key-canonicalization issues in the S3 key.
   * Generic over the per-type MIME map so article media (M4) can reuse it by
   * adding its own map.
   */
  private validateMediaInput(
    type: ProductMediaType,
    fileName: string,
    mimeType: string,
  ): { safeFileName: string; normalizedMimeType: string } {
    if (typeof fileName !== 'string' || typeof mimeType !== 'string') {
      throw new BadRequestException('filename and mime are required');
    }

    const allowMap =
      type === ProductMediaType.VIDEO ? VIDEO_MIME_TYPES : IMAGE_MIME_TYPES;

    const normalizedMimeType = mimeType.trim().toLowerCase();
    const allowedExtensions = allowMap[normalizedMimeType];
    if (!allowedExtensions) {
      throw new BadRequestException(
        `Unsupported ${type} file type: ${mimeType}`,
      );
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

    // Normalize the basename to a strict safe-filename allowlist. The UUID
    // prefix in the key already guarantees uniqueness; this removes %, ?, #,
    // spaces, Unicode, and control characters that break S3 key canonicalization
    // and signed-URL/CDN parsing. The extension was already validated above.
    const safeFileName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeFileName || safeFileName === '.' || safeFileName === '..') {
      throw new BadRequestException('Invalid file name');
    }

    return { safeFileName, normalizedMimeType };
  }
}
