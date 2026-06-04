import { IsEmail, IsString, Length, Matches } from 'class-validator';

/** Public: verify a one-time login code → CUSTOMER token pair (Section 4.4). */
export class VerifyOtpDto {
  @IsEmail()
  email!: string;

  // 6-digit numeric code, mirroring the platform OTP (randomInt(100000,1000000)).
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'otp must be a 6-digit code' })
  otp!: string;
}
