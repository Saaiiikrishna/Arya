import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma';
import { EmailService } from '../email/email.service';
import { LoginDto, CreateAdminDto } from './dto';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tokenId?: string; // For refresh token rotation tracking
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const useTls = String(port) === '6380';
    
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port,
      ...(password ? { password } : {}),
      ...(useTls ? { tls: {} } : {}),
    });
  }

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
            accessToken: uuidv4(),
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

  // ─── OTP Authentication ────────────────────────

  async sendOtp(email: string) {
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Valid email is required');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    
    // Store in Redis with 5 minute expiration (300 seconds)
    await this.redis.set(`otp:${normalizedEmail}`, otp, 'EX', 300);

    // Always log OTP in development for testing
    this.logger.log(`[OTP] Code for ${normalizedEmail}: ${otp}`);

    // Send OTP email via SES
    try {
      await this.emailService.sendEmail({
        to: normalizedEmail,
        subject: 'Your Aryavartham Login Code',
        htmlBody: `
          <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 40px; background: #faf8f5; border: 1px solid #e8e4de;">
            <h2 style="color: #1a3a2a; margin-bottom: 8px;">Aryavartham</h2>
            <p style="color: #6b5b4f; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">The Founder's Club</p>
            <hr style="border: none; border-top: 1px solid #e8e4de; margin: 24px 0;" />
            <p style="color: #2a2a2a;">Your verification code is:</p>
            <div style="text-align: center; padding: 24px; margin: 16px 0; background: #1a3a2a; color: #faf8f5;">
              <span style="font-size: 32px; font-family: monospace; letter-spacing: 8px; font-weight: bold;">${otp}</span>
            </div>
            <p style="color: #6b5b4f; font-size: 13px;">This code expires in 5 minutes. Do not share it with anyone.</p>
          </div>
        `,
      });
    } catch (error) {
      this.logger.warn(`Failed to send OTP email to ${normalizedEmail}, but OTP is logged above for dev use`);
    }

    // For test account, include OTP in response so it can be shown on screen
    const isTestAccount = normalizedEmail === 'test@arya.com';
    return { success: true, message: 'OTP sent to your email', ...(isTestAccount && { otp }) };
  }

  async verifyOtp(email: string, otp: string) {
    if (!email || !otp) {
      throw new BadRequestException('Email and OTP are required');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const storedOtp = await this.redis.get(`otp:${normalizedEmail}`);

    if (!storedOtp) {
      throw new UnauthorizedException('No OTP found for this email or it has expired. Please request a new one.');
    }

    if (storedOtp !== otp) {
      throw new UnauthorizedException('Invalid OTP. Please try again.');
    }

    // OTP is valid - clear it
    await this.redis.del(`otp:${normalizedEmail}`);

    // Check if admin
    const admin = await this.prisma.admin.findUnique({ where: { email: normalizedEmail } });
    if (admin) {
      if (!admin.isActive) throw new UnauthorizedException('Account is disabled');
      const payload: JwtPayload = { sub: admin.id, email: admin.email, role: admin.role };
      return {
        accessToken: this.jwtService.sign(payload),
        refreshToken: this.jwtService.sign(payload, {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: '7d' as any,
        }),
        admin: {
          id: admin.id,
          email: admin.email,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: admin.role,
          avatarUrl: (admin as any).avatarUrl,
        },
      };
    }

    // Find or create applicant
    let applicant = await this.prisma.applicant.findUnique({ where: { email: normalizedEmail } });
    if (!applicant) {
      let batch = await this.prisma.batch.findFirst({ where: { status: 'FILLING' } as any, orderBy: { batchNumber: 'asc' } });
      if (!batch) {
        const lastBatch = await this.prisma.batch.findFirst({ orderBy: { batchNumber: 'desc' } });
        batch = await this.prisma.batch.create({ data: { batchNumber: ((lastBatch as any)?.batchNumber ?? 0) + 1 } as any });
      }
      applicant = await this.prisma.applicant.create({
        data: {
          email: normalizedEmail,
          firstName: normalizedEmail.split('@')[0],
          lastName: '',
          accessToken: uuidv4(),
          batchId: (batch as any).id,
        } as any,
      });
    }

    const jwtPayload: JwtPayload = { sub: (applicant as any).id, email: (applicant as any).email, role: 'APPLICANT' };
    return {
      accessToken: this.jwtService.sign(jwtPayload),
      refreshToken: this.jwtService.sign(jwtPayload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: '7d' as any,
      }),
      admin: {
        id: (applicant as any).id,
        email: (applicant as any).email,
        firstName: (applicant as any).firstName,
        lastName: (applicant as any).lastName,
        role: 'APPLICANT',
        avatarUrl: (applicant as any).avatarUrl,
      },
    };
  }
}
