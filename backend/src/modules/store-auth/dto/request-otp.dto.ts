import { IsEmail } from 'class-validator';

/** Public: request a one-time login code for a customer email (Section 4.4). */
export class RequestOtpDto {
  @IsEmail()
  email!: string;
}
