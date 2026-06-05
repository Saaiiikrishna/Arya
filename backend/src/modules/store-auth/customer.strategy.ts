import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * JWT payload minted for store customers. role is ALWAYS "CUSTOMER" and
 * sub is ALWAYS the Customer.id. These tokens are signed with a DEDICATED
 * customer secret (JWT_CUSTOMER_SECRET, falling back to JWT_SECRET only when
 * unset) and validated by THIS dedicated strategy, so a platform token —
 * signed with JWT_SECRET — is cryptographically rejected here (signature
 * mismatch) before any role/table check even runs. The role assertion below
 * is retained purely as defense-in-depth.
 */
export interface CustomerJwtPayload {
  sub: string;
  email?: string | null;
  role: 'CUSTOMER';
  tokenId?: string;
  jti?: string; // Unique per-token id — makes every refresh token distinct
}

/**
 * Single shared resolution of the customer signing/verification secret. ALL
 * customer token sign + verify paths (this strategy, StoreAuthService, the
 * inline dual-auth verifiers in OrdersController / ReturnsService) MUST use this
 * so a token signed for customers always verifies on the customer path and a
 * platform token never does. Falls back to JWT_SECRET only when the dedicated
 * key is unset (keeps existing deployments working until the key is provisioned).
 */
export function resolveCustomerSecret(config: ConfigService): string {
  return (
    config.get<string>('JWT_CUSTOMER_SECRET') ||
    config.get<string>('JWT_SECRET')!
  );
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
      // Dedicated customer secret (JWT_CUSTOMER_SECRET, JWT_SECRET fallback). A
      // platform token signed with JWT_SECRET fails the signature check here.
      secretOrKey: resolveCustomerSecret(configService),
    });
  }

  async validate(payload: CustomerJwtPayload) {
    // Defense-in-depth role assertion. With a distinct JWT_CUSTOMER_SECRET a
    // platform token never reaches here (signature mismatch); this still guards
    // the fallback case where the customer secret equals JWT_SECRET.
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
