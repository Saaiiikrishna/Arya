import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsInt,
  IsEnum,
  IsUUID,
  Min,
  Max,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ProductStatus, ProductType } from '@prisma/client';

export class CreateProductDto {
  @IsString()
  @MaxLength(300)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  shortDescription?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  seoDescription?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  shortDescription?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  seoDescription?: string;
}

export class ProductQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Category slug filter. */
  @IsOptional()
  @IsString()
  category?: string;

  /** Single tag filter (case-insensitive exact match). */
  @IsOptional()
  @IsString()
  tag?: string;

  /** Free-text search over name / subtitle / brand. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  featured?: boolean;

  /** Inclusive min price filter, in RUPEES (converted to paise at boundary). */
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  minPrice?: number;

  /** Inclusive max price filter, in RUPEES (converted to paise at boundary). */
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  maxPrice?: number;

  /** Sort key. */
  @IsOptional()
  @IsString()
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'popular' | 'featured';
}

/**
 * Query DTO for the ADMIN product list (`GET /admin/store/products`). Unlike the
 * public {@link ProductQueryDto}, it accepts a `status` filter spanning
 * DRAFT/ACTIVE/ARCHIVED and searches title/slug only. Lives in the `dto/` folder
 * (discoverable via the directory scan) and is validated by the global
 * ValidationPipe (whitelist + implicit conversion).
 */
export class AdminProductQueryDto {
  /** Narrow to a single lifecycle status; omit to list ALL statuses. */
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  /** Free-text search over product name / slug (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
