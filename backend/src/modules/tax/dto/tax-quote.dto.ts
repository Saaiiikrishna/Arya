import {
  IsString,
  IsOptional,
  IsInt,
  IsArray,
  ValidateNested,
  ArrayNotEmpty,
  ArrayMaxSize,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Upper bound per line: ₹1 crore in paise (1_00_00_000.00 = 10_000_000_00). */
export const MAX_TAXABLE_VALUE_PAISE = 10_000_000_00;

/**
 * One line of a PUBLIC tax quote. `taxableValuePaise` is the post-discount
 * taxable value in INTEGER PAISE (lineSubtotal - lineDiscount), bounded to keep
 * the integer rounding arithmetic well within IEEE-754 safe-integer range.
 *
 * The public quote path accepts ONLY `hsnCode` (or neither) to drive rate
 * resolution. It deliberately does NOT accept `taxClassId`: TaxClass UUIDs are
 * admin-managed internal identifiers, and exposing them would (a) leak a
 * 404/400/active-vs-inactive enumeration oracle to anonymous callers and (b)
 * surface internal 404 HTTP statuses on a public surface. Checkout (the
 * internal caller) resolves TaxClass server-side from the SKU.
 */
export class TaxQuoteLineDto {
  @IsInt({ message: 'taxableValuePaise must be an integer number of paise' })
  @Min(0, { message: 'taxableValuePaise cannot be negative' })
  @Max(MAX_TAXABLE_VALUE_PAISE, {
    message: 'taxableValuePaise exceeds the ₹1 crore per-line maximum',
  })
  taxableValuePaise!: number;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{2,8}$/, { message: 'hsnCode must be 2–8 numeric digits' })
  hsnCode?: string;
}

/**
 * Public tax quote request. `buyerStateCode` is a 2-digit GST state code
 * (e.g. '27' Maharashtra, '29' Karnataka) — the place of supply (buyer shipping
 * state).
 *
 * The seller state is NEVER accepted from the client: the service always
 * resolves it from the single configured seller GSTIN in SiteSettings. Allowing
 * a client-supplied seller state would let an anonymous caller force an
 * intra-state (CGST+SGST) vs inter-state (IGST) result that diverges from what
 * checkout will compute.
 */
export class TaxQuoteDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TaxQuoteLineDto)
  lines!: TaxQuoteLineDto[];

  @IsString()
  @Matches(/^[0-9]{2}$/, { message: 'buyerStateCode must be a 2-digit GST state code' })
  buyerStateCode!: string;
}
