import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { EmailService } from '../email';
import { NotificationService } from '../notifications/notification.service';

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notifications: NotificationService,
  ) {}

  async create(data: {
    batchId?: string;
    title: string;
    content: string;
    deadline?: string;
    sendEmail?: boolean;
  }) {
    const announcement = await this.prisma.announcement.create({
      data: {
        batchId: data.batchId || null,
        title: data.title,
        content: data.content,
        deadline: data.deadline ? new Date(data.deadline) : null,
      },
    });

    // Send email notifications to all batch participants
    if (data.sendEmail && data.batchId) {
      const applicants = await this.prisma.applicant.findMany({
        where: { batchId: data.batchId, status: { not: 'REMOVED' } },
        select: { id: true, email: true, firstName: true, phone: true },
      });

      const deadlineStr = data.deadline
        ? new Date(data.deadline).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : 'No specific deadline';
      // Dispatch in parallel rather than serially blocking the request per recipient.
      await Promise.allSettled(
        applicants.map((applicant) =>
          this.emailService.sendTemplatedEmail(
            applicant.email,
            'announcement',
            {
              firstName: applicant.firstName,
              title: data.title,
              content: data.content,
              deadline: deadlineStr,
            },
            applicant.id,
          ),
        ),
      );

      // Also fan the broadcast out over WhatsApp (best-effort, never throws).
      await Promise.allSettled(
        applicants.map((applicant) =>
          this.notifications.platformAnnouncement(
            {
              id: applicant.id,
              email: applicant.email,
              firstName: applicant.firstName,
              phone: applicant.phone,
            },
            data.title,
            data.content,
          ),
        ),
      );

      this.logger.log(
        `Announcement "${data.title}" emailed to ${applicants.length} participants`,
      );
    }

    return announcement;
  }

  async findAll(batchId?: string) {
    const where: any = {};
    if (batchId) where.batchId = batchId;

    return this.prisma.announcement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        batch: { select: { batchNumber: true, name: true } },
      },
    });
  }

  async findActive(batchId?: string) {
    const now = new Date();
    const where: any = {
      isActive: true,
      OR: [{ deadline: null }, { deadline: { gte: now } }],
    };
    if (batchId) where.batchId = batchId;

    return this.prisma.announcement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: string,
    data: { title?: string; content?: string; deadline?: string; isActive?: boolean },
  ) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
    });
    if (!announcement) throw new NotFoundException('Announcement not found');

    return this.prisma.announcement.update({
      where: { id },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.content && { content: data.content }),
        ...(data.deadline !== undefined && {
          deadline: data.deadline ? new Date(data.deadline) : null,
        }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  async delete(id: string) {
    await this.prisma.announcement.delete({ where: { id } });
    return { success: true };
  }
}
