import { IsEnum, IsOptional, IsUUID } from 'class-validator';

/**
 * Which purchase path the /build page CTA chose for a DIY guide:
 *  - BUNDLE     → "Buy the full set": adds the single sellable BUNDLE Sku.
 *  - COMPONENTS → "Buy individual components": adds each SKU-backed BOM line at
 *                 its declared quantity.
 */
export enum AddDiyMode {
  BUNDLE = 'BUNDLE',
  COMPONENTS = 'COMPONENTS',
}

/**
 * Body for `POST /api/store/diy/:guideId/add-to-cart` (architecture 4.12).
 *
 * IDENTITY/OWNERSHIP NOTE: `cartId` is accepted ONLY to mirror the documented
 * request shape and let the client assert which cart it believes it is acting on.
 * The authoritative cart is ALWAYS the one resolved by the guard from the
 * X-Cart-Token / CUSTOMER JWT (`req.cart`) — the service ignores any cartId that
 * does not match the guard-resolved cart (no bare-Cart.id trust → no IDOR).
 */
export class AddDiyBundleDto {
  @IsEnum(AddDiyMode)
  mode!: AddDiyMode;

  /** Advisory only — must equal the guard-resolved cart; never trusted as identity. */
  @IsOptional()
  @IsUUID()
  cartId?: string;
}
