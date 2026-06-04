import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CustomerLoginDto {
  @IsEmail()
  email!: string;

  // MaxLength(128) mirrors RegisterCustomerDto: an unbounded password lets a
  // multi-megabyte body saturate the event loop in bcrypt's linear pre-hash
  // step (bcrypt DoS). Bound it at the DTO boundary, before it reaches bcrypt.
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
