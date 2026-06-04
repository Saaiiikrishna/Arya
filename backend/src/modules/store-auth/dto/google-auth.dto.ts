import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Public: exchange a Google ID token for a CUSTOMER token pair (Section 4.4).
 * The token is a JWT issued by Google; bound the length so a pathological body
 * cannot be forced through the verification path.
 */
export class GoogleAuthDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  token!: string;
}
