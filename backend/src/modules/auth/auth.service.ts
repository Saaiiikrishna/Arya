import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma';
import { LoginDto, CreateAdminDto } from './dto';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const admin = await this.prisma.admin.findUnique({
      where: { email: dto.email },
    });

    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION') as any,
      }),
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
      },
    };
  }

  async googleLogin(token: string) {
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(this.configService.get<string>('GOOGLE_CLIENT_ID'));

    try {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) throw new UnauthorizedException('Invalid Google Token');

      const email = payload.email;
      const avatarUrl = payload.picture;
      let admin = await this.prisma.admin.findUnique({ where: { email } });

      if (admin) {
        if (!admin.isActive) throw new UnauthorizedException('Account is disabled');
        
        // Update avatar if changed
        if (avatarUrl && (admin as any).avatarUrl !== avatarUrl) {
          admin = await this.prisma.admin.update({
            where: { id: admin.id },
            data: { avatarUrl } as any,
          });
        }

        const jwtPayload: JwtPayload = { sub: (admin as any).id, email: (admin as any).email, role: (admin as any).role };
        return {
          accessToken: this.jwtService.sign(jwtPayload),
          refreshToken: this.jwtService.sign(jwtPayload, { secret: this.configService.get<string>('JWT_REFRESH_SECRET'), expiresIn: '7d' as any }),
          admin: { 
            id: (admin as any).id, 
            email: (admin as any).email, 
            firstName: (admin as any).firstName, 
            lastName: (admin as any).lastName, 
            role: (admin as any).role,
            avatarUrl: (admin as any).avatarUrl 
          },
        };
      }

      // If not admin, check/create Applicant
      let applicant = await this.prisma.applicant.findUnique({ where: { email } });
      if (!applicant) {
        let batch = await this.prisma.batch.findFirst({ where: { status: 'FILLING' } as any, orderBy: { batchNumber: 'asc' } });
        if (!batch) {
          const lastBatch = await this.prisma.batch.findFirst({ orderBy: { batchNumber: 'desc' } });
          batch = await this.prisma.batch.create({ data: { batchNumber: ((lastBatch as any)?.batchNumber ?? 0) + 1 } as any });
        }
        applicant = await this.prisma.applicant.create({
          data: {
            email,
            firstName: payload.given_name || 'Founder',
            lastName: payload.family_name || '',
            accessToken: require('uuid').v4(),
            batchId: (batch as any).id,
            avatarUrl,
          } as any
        });
      } else if (avatarUrl && (applicant as any).avatarUrl !== avatarUrl) {
        // Update avatar if changed
        applicant = await this.prisma.applicant.update({
          where: { id: (applicant as any).id },
          data: { avatarUrl } as any,
        });
      }

      const jwtPayload: JwtPayload = { sub: (applicant as any).id, email: (applicant as any).email, role: 'APPLICANT' };
      return {
        accessToken: this.jwtService.sign(jwtPayload),
        refreshToken: this.jwtService.sign(jwtPayload, { secret: this.configService.get<string>('JWT_REFRESH_SECRET'), expiresIn: '7d' as any }),
        admin: { 
          id: (applicant as any).id, 
          email: (applicant as any).email, 
          firstName: (applicant as any).firstName, 
          lastName: (applicant as any).lastName, 
          role: 'APPLICANT',
          avatarUrl: (applicant as any).avatarUrl 
        },
      };
    } catch (e) {
      console.error('Google Login Error:', e);
      throw new UnauthorizedException('Google Authentication Failed');
    }
  }

  async testRazorpay(email: string) {
    let applicant = await this.prisma.applicant.findUnique({ where: { email } });
    if (!applicant) {
      let batch = await this.prisma.batch.findFirst({ where: { status: 'FILLING' }, orderBy: { batchNumber: 'asc' } });
      if (!batch) {
        const lastBatch = await this.prisma.batch.findFirst({ orderBy: { batchNumber: 'desc' } });
        batch = await this.prisma.batch.create({ data: { batchNumber: (lastBatch?.batchNumber ?? 0) + 1 } });
      }
      applicant = await this.prisma.applicant.create({
        data: {
          email,
          firstName: 'Razorpay',
          lastName: 'Reviewer',
          accessToken: require('uuid').v4(),
          batchId: batch.id
        }
      });
    }

    const jwtPayload: JwtPayload = { sub: applicant.id, email: applicant.email, role: 'APPLICANT' };
    return {
      accessToken: this.jwtService.sign(jwtPayload),
      refreshToken: this.jwtService.sign(jwtPayload, { secret: this.configService.get<string>('JWT_REFRESH_SECRET'), expiresIn: '7d' as any }),
      admin: { id: applicant.id, email: applicant.email, firstName: applicant.firstName, lastName: applicant.lastName, role: 'APPLICANT' },
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const admin = await this.prisma.admin.findUnique({
        where: { id: payload.sub },
      });

      if (!admin || !admin.isActive) {
        throw new UnauthorizedException('Invalid token');
      }

      const newPayload: JwtPayload = {
        sub: admin.id,
        email: admin.email,
        role: admin.role,
      };

      return {
        accessToken: this.jwtService.sign(newPayload),
        refreshToken: this.jwtService.sign(newPayload, {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION') as any,
        }),
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async createAdmin(dto: CreateAdminDto) {
    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const admin = await this.prisma.admin.create({
      data: {
        email: dto.email,
        passwordHash: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });

    return {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      role: admin.role,
    };
  }

  async validateUser(payload: JwtPayload) {
    if (payload.role === 'APPLICANT') {
      const applicant = await this.prisma.applicant.findUnique({
        where: { id: payload.sub },
      });
      if (!applicant) throw new UnauthorizedException('Applicant not found');
      return { ...applicant, role: 'APPLICANT' };
    }

    const admin = await this.prisma.admin.findUnique({
      where: { id: payload.sub },
    });

    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Admin not found or inactive');
    }

    return admin;
  }
}
