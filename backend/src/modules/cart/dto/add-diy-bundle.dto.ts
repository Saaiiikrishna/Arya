import { IsEnum, IsUUID } from 'class-validator';

/**
 * Which purchase path a DIY /build CTA chose (architecture 4.5 / 4.12):
 *  - BUNDLE     → "Buy the full set": adds the single sellable BUNDLE Sku linked
 *                 to the guide's ComponentBundle at quantity 1.
 *  - COMPONENTS → "Buy individual components": adds every SKU-backed BOM line of
 *                 the guide at its declared quantity (free-text / product-only BOM
 *                 rows are skipped — they are not purchasable SKUs).
 */
export enum AddDiyMode {
  BUNDLE = 'BUNDLE',
  COMPONENTS = 'COMPONENTS',
}

/**
 * Body for `POST /api/store/cart/:id/diy-bundle` (architecture 4.5).
 *
 * The cart resolves the published DIY guide by `guideId`, then — depending on
 * `mode` — adds either the bundle's sellable SKU (BUNDLE) or all of the guide's
 * purchasable BOM components (COMPONENTS) to the guard-resolved cart. No prices
 * are accepted from the client; unit prices are snapshotted server-side from the
 * live SKU exactly as the normal add-item path does.
 *
 * IDENTITY/OWNERSHIP: the cart is ALWAYS the one the {@link CartAccessGuard}
 * resolved from the X-Cart-Token / CUSTOMER JWT (`req.cart`); a bare Cart.id is
 * never trusted (no IDOR). This DTO carries only the guide reference + mode.
 */
export class AddDiyBundleDto {
  /** The published DIY guide whose bundle / BOM components are being added. */
  @IsUUID()
  guideId!: string;

  @IsEnum(AddDiyMode)
  mode!: AddDiyMode;
}
