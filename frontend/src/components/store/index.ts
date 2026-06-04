/**
 * Store component barrel. Import presentational store components from here:
 *   import { ProductCard, Money, Modal } from '@/components/store';
 *
 * All components are presentational + prop-driven (no direct API calls) except
 * MediaUploader, which takes presign/confirm functions as props. Public-facing
 * components (ProductCard, ArticleCard) use the DESIGN.md §7 `mkt-*` premium layer;
 * admin-facing ones default to strict 0px/matte but accept an `mkt` prop where a
 * rounded variant is also useful.
 */

export { default as Tabs } from './Tabs';
export type { TabsProps, TabItem } from './Tabs';

export { default as Modal } from './Modal';
export type { ModalProps } from './Modal';

export { default as Pagination } from './Pagination';
export type { PaginationProps } from './Pagination';

export { default as Money, formatPaise } from './Money';
export type { MoneyProps } from './Money';

export { default as StockBadge } from './StockBadge';
export type { StockBadgeProps } from './StockBadge';

export { default as ProductCard } from './ProductCard';
export type { ProductCardProps } from './ProductCard';

export { default as ArticleCard } from './ArticleCard';
export type { ArticleCardProps } from './ArticleCard';

export { default as MediaUploader } from './MediaUploader';
export type {
  MediaUploaderProps,
  MediaCaps,
  PresignResult,
} from './MediaUploader';
// Re-export MediaType so callers can type their presign/confirm props straight
// from the barrel without also reaching into '@/lib/storeApi'.
export type { MediaType } from '@/lib/storeApi';

export { default as MediaGallery } from './MediaGallery';
export type { MediaGalleryProps, GalleryMedia } from './MediaGallery';

export { default as CodeBlock } from './CodeBlock';
export type { CodeBlockProps } from './CodeBlock';

export { default as BlockRenderer } from './BlockRenderer';
export type { BlockRendererProps, ContentBlock, BlockType } from './BlockRenderer';

export { default as CartLineItem } from './CartLineItem';
export type { CartLineItemProps } from './CartLineItem';

export { default as PriceSummary } from './PriceSummary';
export type { PriceSummaryProps } from './PriceSummary';
