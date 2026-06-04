import {
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  IsInt,
  IsBoolean,
  Min,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ProductMediaType } from '@prisma/client';

/**
 * Allowed media MIME types by media kind. The presign endpoint validates the
 * client-declared `mimeType` against the entry for the requested `type` and
 * signs that exact Content-Type, so a client cannot PUT a different type than
 * was reserved. (Section 9 — MIME allowlist extended for media.)
 */
export const ALLOWED_MEDIA_MIME: Readonly<
  Record<ProductMediaType, Readonly<Record<string, readonly string[]>>>
> = {
  IMAGE: {
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/webp': ['webp'],
    'image/heic': ['heic'],
    'image/heif': ['heif'],
  },
  VIDEO: {
    'video/mp4': ['mp4'],
    'video/webm': ['webm'],
    'video/quicktime': ['mov', 'qt'],
  },
};

/** Per-type cap on a product's media rows (PENDING + CONFIRMED). (Section 9) */
export const PRODUCT_MEDIA_CAP: Readonly<Record<ProductMediaType, number>> = {
  IMAGE: 10,
  VIDEO: 1,
};

/** Authoritative per-type max stored byte size, enforced via HeadObject at confirm. */
export const MEDIA_MAX_BYTES: Readonly<Record<ProductMediaType, number>> = {
  IMAGE: 15 * 1024 * 1024, // 15 MiB
  VIDEO: 200 * 1024 * 1024, // 200 MiB
};

/**
 * Reserve a media cap slot and request a presigned PUT URL. The service inserts
 * a `ProductMedia(status=PENDING)` row inside a transaction, counts existing
 * (PENDING+CONFIRMED) rows of the same `type` against the cap, and only then
 * issues the URL. (Section 4.1 / Section 9)
 */
export class PresignMediaDto {
  @IsEnum(ProductMediaType)
  type!: ProductMediaType;

  /** Original file name (basename only; directory components are stripped). */
  @IsString()
  @MaxLength(255)
  fileName!: string;

  /** Declared MIME type — validated against the allowlist for `type`. */
  @IsString()
  @MaxLength(120)
  mimeType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  altText?: string;
}

/**
 * Confirm a previously-reserved media upload. The service runs HeadObject to
 * read the authoritative stored size, enforces the per-type byte cap + MIME, and
 * flips the row PENDING→CONFIRMED. (Section 4.1 / Section 9)
 */
export class ConfirmMediaDto {
  @IsUUID()
  mediaId!: string;

  /** Advisory client-reported size; the authoritative size comes from HeadObject. */
  @IsOptional()
  @IsInt()
  @Min(0)
  fileSize?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

/** Query for the admin media-list endpoint. */
export class MediaListQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  confirmedOnly?: boolean;
}
