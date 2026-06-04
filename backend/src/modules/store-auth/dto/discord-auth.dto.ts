import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Public: exchange a Discord OAuth2 authorization code for a CUSTOMER token pair.
 * The `code` is opaque to us — a bounded string forwarded to Discord's token
 * endpoint. The `state` is the anti-CSRF nonce (RFC 6749 §10.12) that was minted
 * by StoreAuthService.getDiscordAuthUrl(), round-tripped through Discord, and is
 * verified + single-use-consumed in discordLogin() before the code is exchanged.
 * It is a 16-byte hex string (32 chars) but bounded loosely here.
 */
export class DiscordAuthDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  state!: string;
}
