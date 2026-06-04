import { IsInt, Max, Min } from 'class-validator';
import { MAX_CART_ITEM_QTY } from './add-cart-item.dto';

/**
 * Update the quantity of an existing cart line. qty must be >= 1; to remove a
 * line use DELETE /items/:itemId (qty=0 is not an accepted update).
 */
export class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  @Max(MAX_CART_ITEM_QTY)
  qty!: number;
}
