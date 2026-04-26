import { IsOptional, IsString } from 'class-validator';

export class VerifyReferralDto {
  @IsString()
  query: string; // Can be referral code, email, or phone number
}

export class SetReferrerDto {
  @IsString()
  applicantId: string;

  @IsString()
  referrerId: string; // The verified referrer's ID
}
