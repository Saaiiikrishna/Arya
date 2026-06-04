import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsEnum,
  IsObject,
  IsArray,
  ValidateNested,
  MaxLength,
  registerDecorator,
  type ValidationOptions,
  type ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductTabSectionType } from '@prisma/client';

/** Max characters for any single string field inside a section payload. */
const MAX_SECTION_TEXT = 50_000;
/** Max array members for SPEC_TABLE rows / MEDIA items. */
const MAX_SECTION_ITEMS = 200;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isHttpsUrl(v: unknown): boolean {
  if (typeof v !== 'string' || v.length > 2000) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Structural validator for a tab section `content` payload, discriminated by the
 * sibling `type` field. Enforces the documented shape per type and, critically,
 * requires https URLs in MEDIA items so a stored `javascript:`/`data:` URI can't
 * become a stored-XSS vector when the storefront renders the section. RICH_TEXT
 * `html` is additionally sanitized server-side at persist time. (Security
 * IMPORTANT — TabSection content per-type validation.)
 */
function IsValidSectionContent(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isValidSectionContent',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (!isPlainObject(value)) return false;
          const type = (args.object as TabSectionInputDto).type;
          switch (type) {
            case ProductTabSectionType.RICH_TEXT:
              return (
                typeof value.html === 'string' &&
                value.html.length <= MAX_SECTION_TEXT
              );
            case ProductTabSectionType.CODE:
              return (
                typeof value.code === 'string' &&
                value.code.length <= MAX_SECTION_TEXT &&
                (value.language === undefined ||
                  (typeof value.language === 'string' &&
                    value.language.length <= 60))
              );
            case ProductTabSectionType.CALLOUT:
              return (
                typeof value.body === 'string' &&
                value.body.length <= MAX_SECTION_TEXT &&
                (value.variant === undefined ||
                  (typeof value.variant === 'string' &&
                    value.variant.length <= 40))
              );
            case ProductTabSectionType.SPEC_TABLE: {
              if (!Array.isArray(value.rows)) return false;
              if (value.rows.length > MAX_SECTION_ITEMS) return false;
              return value.rows.every(
                (r) =>
                  isPlainObject(r) &&
                  typeof r.k === 'string' &&
                  r.k.length <= 300 &&
                  typeof r.v === 'string' &&
                  r.v.length <= 2000,
              );
            }
            case ProductTabSectionType.MEDIA: {
              if (!Array.isArray(value.items)) return false;
              if (value.items.length > MAX_SECTION_ITEMS) return false;
              return value.items.every(
                (it) =>
                  isPlainObject(it) &&
                  isHttpsUrl(it.url) &&
                  (it.type === undefined || typeof it.type === 'string') &&
                  (it.caption === undefined ||
                    (typeof it.caption === 'string' &&
                      it.caption.length <= 500)),
              );
            }
            default:
              // Unknown section type — reject rather than store unvalidated JSON.
              return false;
          }
        },
        defaultMessage(args: ValidationArguments): string {
          const type = (args.object as TabSectionInputDto).type;
          return `content does not match the required shape for section type ${type}`;
        },
      },
    });
  };
}

export class TabSectionInputDto {
  @IsEnum(ProductTabSectionType)
  type!: ProductTabSectionType;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  /**
   * Section payload. Shape depends on `type` and is structurally validated:
   *   RICH_TEXT  { html }          (html sanitized server-side at persist)
   *   SPEC_TABLE { rows: [{ k, v }] }
   *   MEDIA      { items: [{ url(https), type?, caption? }] }
   *   CODE       { code, language? }
   *   CALLOUT    { body, variant? }
   */
  @IsObject()
  @IsValidSectionContent()
  content!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class TabInputDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TabSectionInputDto)
  sections!: TabSectionInputDto[];
}

/**
 * Full replace of a product's ordered tab/section tree (idempotent upsert).
 */
export class UpsertTabsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TabInputDto)
  tabs!: TabInputDto[];
}
