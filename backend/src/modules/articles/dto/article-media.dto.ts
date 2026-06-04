import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ArticleMediaType } from '@prisma/client';

/**
 * Allowed media MIME types by media kind, mapped to permitted file-name
 * extensions. The presign endpoint validates the client-declared `mimeType`
 * against the entry for the requested `type` and signs that exact Content-Type,
 * so a client cannot PUT a different type than was reserved.
 *
 * Images mirror the store/document image set; video accepts the web-deliverable
 * container set (mp4/webm/quicktime) per the task MIME allowlist.
 */
export const ALLOWED_ARTICLE_MEDIA_MIME: Readonly<
  Record<ArticleMediaType, Readonly<Record<string, readonly string[]>>>
> = {
  IMAGE: {
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
    // non-standard alias some mobile browsers send; intentionally accepted
    'image/jpg': ['jpg', 'jpeg'],
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

/** Per-type cap on an article's media rows (PENDING + CONFIRMED): 15 IMAGE + 3 VIDEO. */
export const ARTICLE_MEDIA_CAP: Readonly<Record<ArticleMediaType, number>> = {
  IMAGE: 15,
  VIDEO: 3,
};

/** Authoritative per-type max stored byte size, enforced via HeadObject at confirm. */
export const ARTICLE_MEDIA_MAX_BYTES: Readonly<
  Record<ArticleMediaType, number>
> = {
  IMAGE: 15 * 1024 * 1024, // 15 MiB
  VIDEO: 200 * 1024 * 1024, // 200 MiB
};

/** Largest per-type byte cap — bounds the advisory `fileSize` field in confirm. */
export const ARTICLE_MEDIA_MAX_ANY_BYTES = ARTICLE_MEDIA_MAX_BYTES.VIDEO;

/**
 * Body for POST /api/articles/:id/media/presign.
 *
 * `type` selects the cap bucket (IMAGE max 15, VIDEO max 3) and the MIME/byte
 * allowlist applied at confirm. `fileName` is sanitized to a basename and its
 * extension is matched against the declared `mimeType` (anti path-traversal +
 * anti extension/MIME mismatch). Mirrors the store-media row-reservation flow.
 */
export class PresignArticleMediaDto {
  @IsEnum(ArticleMediaType)
  type!: ArticleMediaType;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  mimeType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}

/**
 * Body for POST /api/articles/:id/media/:mediaId/confirm.
 *
 * The authoritative object size is read from S3 (HeadObject); `fileSize` is an
 * advisory fallback used only in non-production when HeadObject cannot run.
 * Bounded by the largest per-type cap so a crafted huge value cannot reach the
 * size-comparison logic.
 */
export class ConfirmArticleMediaDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(ARTICLE_MEDIA_MAX_ANY_BYTES)
  fileSize?: number;
}
