import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL', 'https://aryavartham.com');
  }

  /**
   * Issue a referral certificate
   */
  async issueCertificate(applicantId: string, title: string) {
    try {
      const applicant = await this.prisma.applicant.findUnique({
        where: { id: applicantId }
      });

      if (!applicant) return null;

      const credentialId = `ARYA-${uuidv4().substring(0, 8).toUpperCase()}`;
      const now = new Date();
      
      // Generate LinkedIn Add to Profile URL
      const linkedinUrl = this.generateLinkedInUrl({
        name: title,
        issueYear: now.getFullYear(),
        issueMonth: now.getMonth() + 1,
        certId: credentialId,
        certUrl: `${this.frontendUrl}/verify/${credentialId}`,
      });

      const certificate = await this.prisma.certificate.create({
        data: {
          applicantId,
          title,
          credentialId,
          linkedinUrl,
          url: `${this.frontendUrl}/certificates/${credentialId}`, // Mock URL for now
        }
      });

      this.logger.log(`Issued certificate ${title} to ${applicant.email}`);
      return certificate;
    } catch (error) {
      this.logger.error(`Failed to issue certificate for ${applicantId}`, error);
      return null;
    }
  }

  private generateLinkedInUrl(params: {
    name: string;
    issueYear: number;
    issueMonth: number;
    certId: string;
    certUrl: string;
  }) {
    const baseUrl = 'https://www.linkedin.com/profile/add';
    const query = new URLSearchParams({
      startTask: 'CERTIFICATION_NAME',
      name: params.name,
      organizationName: 'Aryavartham',
      issueYear: String(params.issueYear),
      issueMonth: String(params.issueMonth),
      certId: params.certId,
      certUrl: params.certUrl,
    });

    return `${baseUrl}?${query.toString()}`;
  }

  async getApplicantCertificates(applicantId: string) {
    return this.prisma.certificate.findMany({
      where: { applicantId },
      orderBy: { createdAt: 'desc' }
    });
  }
}
