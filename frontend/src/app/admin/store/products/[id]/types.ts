/**
 * Narrow client-side types for the slices of the admin product-detail tree
 * (`api.adminGetStoreProduct`) that the editor tabs consume. These mirror the
 * Prisma models (Product, Sku, ProductMedia, ProductTab + sections, DiyGuide)
 * closely enough to catch field-name regressions, while staying permissive on
 * fields the editor never reads (index signature on the root).
 *
 * Money fields (basePrice / salePrice / unitPrice) are INTEGER PAISE on the wire.
 */

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type ProductType = 'STANDARD' | 'BUNDLE' | 'DIGITAL';
export type ProductMediaKind = 'IMAGE' | 'VIDEO';

export interface SkuPriceTier {
  id: string;
  minQty: number;
  unitPrice: number; // paise
}

export interface ProductSku {
  id: string;
  skuCode: string;
  barcode?: string | null;
  name?: string | null;
  variantAttributes?: Record<string, unknown> | null;
  hsnCode?: string | null;
  taxClassId?: string | null;
  taxClass?: { id: string; name: string } | null;
  basePrice: number; // paise
  salePrice?: number | null; // paise
  weightGrams?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  reorderPoint?: number | null;
  reorderQty?: number | null;
  isActive?: boolean;
  priceTiers?: SkuPriceTier[];
}

export interface ProductMediaItem {
  id: string;
  type: ProductMediaKind;
  status: 'PENDING' | 'CONFIRMED';
  url?: string | null;
  caption?: string | null;
  altText?: string | null;
}

export interface ProductTabSection {
  id?: string;
  type: 'RICH_TEXT' | 'SPEC_TABLE' | 'MEDIA' | 'CODE' | 'CALLOUT';
  title?: string | null;
  content?: Record<string, unknown> | null;
  sortOrder?: number;
}

export interface ProductTab {
  id?: string;
  title: string;
  isActive?: boolean;
  sortOrder?: number;
  sections?: ProductTabSection[];
}

export interface DiyStepMedia {
  url?: string;
  type?: string;
  caption?: string;
}

export interface DiyStep {
  title?: string;
  body?: string;
  codeLanguage?: string | null;
  code?: string | null;
  media?: DiyStepMedia[];
}

export interface DiyBomItem {
  skuId?: string | null;
  productId?: string | null;
  freeTextName?: string | null;
  quantity?: number;
  note?: string | null;
}

export interface DiyGuide {
  id?: string;
  title?: string;
  summary?: string | null;
  difficulty?: string | null;
  estimatedMinutes?: number | null;
  bundleId?: string | null;
  isPublished?: boolean;
  steps?: DiyStep[];
  bomItems?: DiyBomItem[];
}

/** The full nested product tree returned by `api.adminGetStoreProduct`. */
export interface ProductDetail {
  id: string;
  slug: string;
  name: string;
  subtitle?: string | null;
  brand?: string | null;
  shortDescription?: string | null;
  status: ProductStatus;
  type: ProductType;
  categoryId?: string | null;
  tags?: string[];
  isFeatured?: boolean;
  sortOrder?: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
  skus?: ProductSku[];
  media?: ProductMediaItem[];
  tabs?: ProductTab[];
  diyGuide?: DiyGuide | null;
  // Permissive escape hatch for fields the editor does not read.
  [k: string]: unknown;
}

/** Shared props all editor tabs receive from the detail page. */
export interface TabProps {
  product: ProductDetail;
  onChanged: () => Promise<void> | void;
}
