import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  ArrayMaxSize,
  MaxLength,
  MinLength,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ArticleStatus } from '@prisma/client';

/**
 * Maximum number of tags accepted on an article. Bounds the GIN array-overlap
 * (&&) related-articles query and keeps the tag list index-friendly.
 */
export const ARTICLE_TAGS_MAX = 25;

/**
 * Max serialized byte size for an article `body` rich-text block document, and
 * the max nesting depth allowed. `@IsObject()` only checks `typeof === 'object'`
 * (it accepts `[]`, `{}`, and arbitrarily deep/large nesting), so the body is
 * additionally bounded here to stop a client submitting an unbounded payload —
 * mirroring how the catalog module caps tab-section content size.
 */
export const ARTICLE_BODY_MAX_BYTES = 200_000; // ~200 KB serialized
export const ARTICLE_BODY_MAX_DEPTH = 32;

/** Compute the maximum nesting depth of a JSON-like value (objects + arrays). */
function jsonDepth(value: unknown, depth = 0): number {
  if (depth > ARTICLE_BODY_MAX_DEPTH) return depth; // bail early; already too deep
  if (Array.isArray(value)) {
    let max = depth;
    for (const v of value) max = Math.max(max, jsonDepth(v, depth + 1));
    return max;
  }
  if (value !== null && typeof value === 'object') {
    let max = depth;
    for (const v of Object.values(value as Record<string, unknown>)) {
      max = Math.max(max, jsonDepth(v, depth + 1));
    }
    return max;
  }
  return depth;
}

/**
 * Validate that a value is a NON-NULL PLAIN OBJECT (not an array, not a scalar)
 * representing a rich-text block document, bounded by a serialized-size and a
 * nesting-depth cap. Rejects oversized / deeply-nested / array / scalar bodies.
 */
function IsArticleBody(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isArticleBody',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value)
          ) {
            return false;
          }
          let serialized: string;
          try {
            serialized = JSON.stringify(value);
          } catch {
            return false; // circular / non-serializable
          }
          if (Buffer.byteLength(serialized, 'utf8') > ARTICLE_BODY_MAX_BYTES) {
            return false;
          }
          return jsonDepth(value) <= ARTICLE_BODY_MAX_DEPTH;
        },
        defaultMessage(): string {
          return `body must be a JSON object no larger than ${ARTICLE_BODY_MAX_BYTES} bytes and no deeper than ${ARTICLE_BODY_MAX_DEPTH} levels`;
        },
      },
    });
  };
}

/**
 * Body for POST /api/articles (author submit) and POST /api/articles/draft
 * (author save-as-draft). The route — not a client-supplied status — selects the
 * created state (SUBMITTED vs DRAFT), so there is deliberately NO status field
 * here.
 *
 * The identity fields (authorType / authorId / authorName / status / slug /
 * publishedAt / viewCount / reviewedById) are NEVER accepted here — they are
 * pinned server-side from the verified JWT (ArticleAuthorGuard) or derived by
 * the service. The slug is generated race-safely from the title.
 */
export class CreateArticleDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  title!: string;

  /**
   * Rich-text block JSON (editor document). Persisted verbatim; the storefront
   * is responsible for safe rendering. Bounded to a non-null plain object within
   * a serialized-size + nesting-depth cap so a scalar/array or an unbounded
   * payload cannot be stored where a block document is expected.
   */
  @IsArticleBody()
  body!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  excerpt?: string;

  /** Optional S3 key for a pre-uploaded cover image (uploaded via the media flow). */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  coverS3Key?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(ARTICLE_TAGS_MAX)
  @MaxLength(60, { each: true })
  tags?: string[];
}

/**
 * Body for PATCH /api/articles/:id (author edit of own DRAFT/REJECTED article)
 * AND for the optional inline-edit payload of POST /api/articles/:id/submit.
 *
 * All fields optional. Status is intentionally absent: the PATCH edit NEVER
 * changes workflow status (a DRAFT stays DRAFT, a REJECTED stays REJECTED), and
 * submission (DRAFT/REJECTED -> SUBMITTED) is driven by the dedicated submit
 * route, never by a client-supplied status.
 */
export class UpdateArticleDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsArticleBody()
  body?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  excerpt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  coverS3Key?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(ARTICLE_TAGS_MAX)
  @MaxLength(60, { each: true })
  tags?: string[];
}

/**
 * Public list query for GET /api/articles. Pagination + category/tag filters +
 * bounded free-text search over title/excerpt. Only PUBLISHED articles are ever
 * returned by the service regardless of these inputs.
 */
export class ArticleListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }) => Math.trunc(Number(value)))
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }) => Math.trunc(Number(value)))
  limit?: number;

  /** Single tag filter (array overlap on the GIN-indexed tags). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  tag?: string;

  /**
   * Category filter. Articles carry tags, not a category column; the service
   * treats `category` as a tag match so the public filter still works against
   * the existing schema (documented in the service).
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  /** Bounded free-text search over title/excerpt (ILIKE, index-friendly). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

/**
 * Author's own-articles query for GET /api/articles/mine. Pagination + optional
 * status filter. Returns ANY status but only the author's own rows + only safe
 * fields (no admin metrics).
 */
export class MineArticleQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }) => Math.trunc(Number(value)))
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }) => Math.trunc(Number(value)))
  limit?: number;

  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;
}

/**
 * Admin moderation-queue query for GET /api/admin/articles. Pagination +
 * optional status filter + optional free-text search.
 */
export class AdminArticleQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }) => Math.trunc(Number(value)))
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }) => Math.trunc(Number(value)))
  limit?: number;

  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

/** Body for POST /api/admin/articles/:id/reject — reason is required. */
export class RejectArticleDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

/**
 * Body for PATCH /api/admin/articles/:id — admin edit / feature / unpublish.
 *
 * `unpublish=true` pulls a PUBLISHED article off the public listing into the
 * distinct terminal ARCHIVED state (NOT the SUBMITTED moderation queue — use the
 * restore endpoint to bring it back to PUBLISHED). `feature` is not a schema
 * field; featuring is expressed by a reserved "featured" tag the public sort
 * honors.
 */
export class AdminUpdateArticleDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsArticleBody()
  body?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  excerpt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  coverS3Key?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(ARTICLE_TAGS_MAX)
  @MaxLength(60, { each: true })
  tags?: string[];

  /** Toggle the curated "featured" flag (stored as a reserved tag). */
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  /** Pull a PUBLISHED article off the public listing (back to the queue). */
  @IsOptional()
  @IsBoolean()
  unpublish?: boolean;
}
