import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * A shipping/billing address supplied at checkout. The buyer `stateCode` is the
 * GST place-of-supply and drives CGST/SGST-vs-IGST; it MUST be a 2-digit GST
 * state code. Persisted verbatim as JSON onto Order.shippingAddress /
 * Order.billingAddress (immutable snapshot — never re-read from the Customer's
 * mutable Address rows after the order is placed).
 */
export class CheckoutAddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city!: string;

  /** 2-digit GST state code (place of supply). */
  @IsString()
  @Matches(/^[0-9]{2}$/, {
    message: 'stateCode must be a 2-digit GST state code',
  })
  stateCode!: string;

  @IsString()
  @Length(4, 12)
  postalCode!: string;

  /**
   * ISO-3166-1 alpha-2 country code (uppercase). Defaults to 'IN' downstream when
   * omitted. Constrained to two uppercase letters so a junk value ('XX', '12')
   * can never be persisted onto the immutable order address snapshot.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'country must be a 2-letter uppercase ISO-3166-1 alpha-2 code',
  })
  country?: string;
}
