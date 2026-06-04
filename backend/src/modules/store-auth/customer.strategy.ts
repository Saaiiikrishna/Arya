import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * JWT payload minted for store customers. role is ALWAYS "CUSTOMER" and
 * sub is ALWAYS the Customer.id. These tokens are signed with the same
 * JWT_SECRET as the platform but are validated by THIS dedicated strategy,
 * so a CUSTOMER token can never resolve against the admin/applicant tables
 * (the platform validateUser() else-branch) and vice-versa.
 */
export interface CustomerJwtPayload {
  sub: string;
  email?: string | null;
  role: 'CUSTOMER';
  tokenId?: string;
}

/**
 * Dedicated Passport strategy named 'jwt-customer'.
 *
 * SEPARATE from the platform JwtStrategy ('jwt'): it looks up the Customer
 * table by payload.sub and asserts payload.role === 'CUSTOMER'. It never calls
 * the platform AuthService.validateUser(), which else-branches to Admin — so a
 * customer token never hits the platform admin path, and an admin/applicant
 * token is rejected here (wrong role / not a Customer row).
 */
@Injectable()
export class CustomerStrategy extends PassportStrategy(
  Strategy,
  'jwt-customer',
) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: CustomerJwtPayload) {
    // Hard role assertion: an admin/applicant/investor token (same JWT_SECRET,
    // valid signature) carries a different role and is rejected here.
    if (!payload || payload.role !== 'CUSTOMER') {
      throw new UnauthorizedException('Customer access required');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: payload.sub },
    });

    // Must be an active, REGISTERED customer — guest rows never carry a JWT.
    if (!customer || !customer.isActive || customer.type !== 'REGISTERED') {
      throw new UnauthorizedException('Customer not found or inactive');
    }

    // Shape returned to req.user. role is pinned from the verified token.
    return {
      id: customer.id,
      email: customer.email,
      phone: customer.phone,
      firstName: customer.firstName,
      lastName: customer.lastName,
      type: customer.type,
      applicantId: customer.applicantId,
      role: 'CUSTOMER' as const,
    };
  }
}
