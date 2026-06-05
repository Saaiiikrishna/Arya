import { IsOptional, IsString, MinLength } from 'class-validator';

// `refreshToken` is OPTIONAL: the browser now sends the token as an HttpOnly
// cookie (`arya_store_refresh`) and the controller reads it from there. The body
// field remains for non-browser API clients that present the token directly.
export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}
