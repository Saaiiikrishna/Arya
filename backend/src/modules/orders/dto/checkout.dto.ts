import { Type } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CheckoutAddressDto } from './address.dto';

/**
 * Body for POST /api/store/checkout (architecture 4.6).
 *
 * The cart is resolved server-side from the guard-pinned identity (CUSTOMER JWT
 * or X-Cart-Token) — NEVER from a client-supplied cartId — so there is no cartId
 * field here (it would be an IDOR vector). Identity (customerId / guest) is pinned
 * from the JWT/guest token by the controller, never from the body.
 *
 * `guestEmail` / `guestPhone` are accepted ONLY for the guest path (where there is
 * no Customer record carrying them) and are used for the order receipt + coupon
 * anti-farming key. For a registered customer they are ignored in favour of the
 * JWT-resolved identity.
 */
export class CheckoutDto {
  @ValidateNested()
  @Type(() => CheckoutAddressDto)
  shippingAddress!: CheckoutAddressDto;

  /** Optional distinct billing address; defaults to the shipping address. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutAddressDto)
  billingAddress?: CheckoutAddressDto;

  /** Guest contact (guest path only). */
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  guestEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  guestPhone?: string;
}
