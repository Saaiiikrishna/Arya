import { IsInt, IsUUID, Max, Min } from 'class-validator';

/**
 * Maximum quantity for a single cart line. A generous upper bound that still
 * prevents an integer-overflow / pathological-reservation attempt via one line
 * (per-line, not per-order — checkout re-validates availability under lock).
 */
export const MAX_CART_ITEM_QTY = 1000;

/**
 * Add a SKU to the cart (or merge into the existing line for that SKU).
 * No price is accepted from the client — the unit price is snapshotted
 * server-side from the SKU (sale/base/PriceTier) at add time. (Section 4.5)
 */
export class AddCartItemDto {
  @IsUUID()
  skuId!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_CART_ITEM_QTY)
  qty!: number;
}
