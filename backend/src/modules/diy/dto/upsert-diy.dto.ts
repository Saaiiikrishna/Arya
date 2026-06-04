import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';

/** Anti-DoS bounds on the upserted guide so an admin cannot store an unbounded blob. */
const MAX_STEPS = 100;
const MAX_BOM_ITEMS = 200;
const MAX_STEP_MEDIA = 20;

/** One {url,type,caption} media reference embedded on a DIY step (stored as JSON). */
export class DiyStepMediaDto {
  // Defense-in-depth against stored XSS: these URLs are persisted in the DiyStep
  // JSON column and served verbatim to the public /build view, where the frontend
  // renders them in <img>/<video> tags. Restricting to http(s) blocks
  // `javascript:`/`data:` URIs at the write boundary. `require_tld:false` allows
  // localhost/CDN hosts without a public TLD in non-prod.
  @IsString()
  @MaxLength(2048)
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  url!: string;

  /** Free-form media type label (e.g. 'IMAGE' | 'VIDEO'); kept loose to mirror the JSON shape. */
  @IsString()
  @MaxLength(20)
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  caption?: string;
}

export class UpsertDiyStepDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(20000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  codeLanguage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  code?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STEP_MEDIA)
  @ValidateNested({ each: true })
  @Type(() => DiyStepMediaDto)
  media?: DiyStepMediaDto[];

  /** Optional explicit order; if omitted the array index is used. */
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/**
 * One BOM line. The DB CHECK requires at least one identity column
 * (skuId | productId | freeTextName) — service re-asserts this with a 400 so the
 * error is friendly rather than a raw constraint-violation 500.
 */
export class UpsertDiyBomItemDto {
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  freeTextName?: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/**
 * Upsert a product's DIY guide together with its full ordered step list and BOM.
 * Steps and BOM are REPLACED wholesale (delete-then-recreate inside one tx) so the
 * admin editor can send the canonical desired state; this avoids per-row diffing.
 */
export class UpsertDiyDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  difficulty?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedMinutes?: number;

  /** Optional link to an existing ComponentBundle (buy-the-full-set). */
  @IsOptional()
  @IsUUID()
  bundleId?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsArray()
  @ArrayMaxSize(MAX_STEPS)
  @ValidateNested({ each: true })
  @Type(() => UpsertDiyStepDto)
  steps!: UpsertDiyStepDto[];

  @IsArray()
  @ArrayMaxSize(MAX_BOM_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => UpsertDiyBomItemDto)
  bom!: UpsertDiyBomItemDto[];
}
