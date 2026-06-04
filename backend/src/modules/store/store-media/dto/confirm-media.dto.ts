import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_VIDEO_BYTES } from '../store-media.service';

/**
 * Body for POST /api/admin/store/products/:id/media/confirm.
 *
 * `mediaId` identifies the PENDING ProductMedia row reserved at presign.
 * `caption` / `altText` / `sortOrder` are optional display metadata applied as
 * the row is promoted PENDING -> CONFIRMED. The true object size is read
 * authoritatively from S3 (HeadObject); any client-reported size is advisory.
 */
export class ConfirmMediaDto {
  @IsUUID('4')
  @IsString()
  mediaId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  altText?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  /**
   * Advisory only. The authoritative size comes from S3 HeadObject; this is a
   * fallback used when HeadObject cannot be performed (e.g. local dev with no
   * real S3 backing). Bounded by the largest per-type cap so a crafted huge
   * value (e.g. Number.MAX_SAFE_INTEGER) cannot reach the size-comparison logic.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_VIDEO_BYTES)
  fileSize?: number;
}
