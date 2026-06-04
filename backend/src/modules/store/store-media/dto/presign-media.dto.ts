import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { ProductMediaType } from '@prisma/client';

/**
 * Body for POST /api/admin/store/products/:id/media/presign.
 *
 * `type` selects the cap bucket (IMAGE max 10, VIDEO max 1) and the MIME/byte
 * allowlist applied at confirm time. `filename` is sanitized to a basename and
 * its extension is matched against the declared `mime` (anti path-traversal +
 * anti extension/MIME mismatch, mirroring DocumentService).
 */
export class PresignMediaDto {
  @IsEnum(ProductMediaType)
  type!: ProductMediaType;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  mime!: string;
}
