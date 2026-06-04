import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * CustomerJwtGuard: merge a guest cart into the authenticated customer's cart
 * (Section 4.4 / 8.2). The customer identity is taken from the JWT — only the
 * raw guest cart session token is supplied here so the server can locate (by
 * SHA-256 hash) the guest cart to claim. The cart id is NOT accepted: knowing a
 * Cart.id UUID must never be sufficient to claim a cart (IDOR rule, Section 9).
 */
export class ConvertGuestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  cartToken!: string;
}
