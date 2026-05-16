import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { InterviewDecision } from '@prisma/client';

@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Admin: Slot management ───────────────────────────────

  async createSlot(batchId: string, startTime: string, endTime: string, capacity: number, notes?: string) {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (end <= start) throw new BadRequestException('End time must be after start time');
    if (start < new Date()) throw new BadRequestException('Cannot create slots in the past');
    if (capacity < 1) throw new BadRequestException('Capacity must be at least 1');

    return this.prisma.interviewSlot.create({
      data: { batchId, startTime: start, endTime: end, capacity, notes },
    });
  }

  async deleteSlot(slotId: string) {
    const slot = await this.prisma.interviewSlot.findUnique({
      where: { id: slotId },
      include: { bookings: { where: { status: { in: ['CONFIRMED', 'PENDING'] } } } },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (slot.bookings.length > 0) {
      throw new BadRequestException('Cannot delete a slot with active bookings');
    }
    return this.prisma.interviewSlot.delete({ where: { id: slotId } });
  }

  async getAdminSlots(batchId: string) {
    return this.prisma.interviewSlot.findMany({
      where: { batchId },
      include: {
        _count: { select: { bookings: true } },
        bookings: {
          select: {
            id: true,
            status: true,
            decision: true,
            score: true,
            applicant: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });
  }

  async recordDecision(
    bookingId: string,
    decision: InterviewDecision,
    score: number | undefined,
    notes: string | undefined,
    adminId: string,
  ) {
    const booking = await this.prisma.interviewBooking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');

    const [updated] = await this.prisma.$transaction([
      this.prisma.interviewBooking.update({
        where: { id: bookingId },
        data: {
          status: 'COMPLETED',
          decision,
          score,
          notes,
          decidedAt: new Date(),
          decidedById: adminId,
        },
      }),
      ...(decision === 'SELECTED'
        ? [this.prisma.applicant.update({ where: { id: booking.applicantId }, data: { status: 'ELIGIBLE' } })]
        : decision === 'REJECTED'
        ? [this.prisma.applicant.update({ where: { id: booking.applicantId }, data: { status: 'REMOVED' } })]
        : []),
    ]);

    this.logger.log(`Interview decision ${decision} recorded for booking ${bookingId}`);
    return updated;
  }

  // ─── Applicant: Slot booking ──────────────────────────────

  async getAvailableSlots(batchId: string) {
    const now = new Date();
    const slots = await this.prisma.interviewSlot.findMany({
      where: { batchId, startTime: { gt: now } },
      include: { _count: { select: { bookings: true } } },
      orderBy: { startTime: 'asc' },
    });

    return slots.map((slot) => ({
      ...slot,
      availableSeats: slot.capacity - slot._count.bookings,
      isFull: slot._count.bookings >= slot.capacity,
    }));
  }

  async getMyBooking(applicantId: string) {
    return this.prisma.interviewBooking.findUnique({
      where: { applicantId },
      include: { slot: true },
    });
  }

  async bookSlot(applicantId: string, slotId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.interviewBooking.findUnique({ where: { applicantId } });
        if (existing) {
          throw new BadRequestException('You already have an interview booking. Cancel it first to choose another slot.');
        }

        const [slot, applicant] = await Promise.all([
          tx.interviewSlot.findUnique({
            where: { id: slotId },
            include: { _count: { select: { bookings: true } } },
          }),
          tx.applicant.findUnique({ where: { id: applicantId }, select: { batchId: true } }),
        ]);

        if (!slot) throw new NotFoundException('Slot not found');
        if (!applicant) throw new NotFoundException('Applicant not found');
        if (applicant.batchId !== slot.batchId) throw new BadRequestException('Slot belongs to a different batch');
        if (new Date() >= slot.startTime) throw new BadRequestException('This slot has already passed');
        if (slot._count.bookings >= slot.capacity) throw new BadRequestException('This slot is fully booked');

        return tx.interviewBooking.create({
          data: { slotId, applicantId, status: 'CONFIRMED' },
          include: { slot: true },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async cancelBooking(applicantId: string) {
    const booking = await this.prisma.interviewBooking.findUnique({
      where: { applicantId },
      include: { slot: true },
    });
    if (!booking) throw new NotFoundException('No booking found to cancel');

    const msUntilSlot = booking.slot.startTime.getTime() - Date.now();
    if (msUntilSlot < 24 * 3_600_000) {
      throw new BadRequestException('Bookings cannot be cancelled within 24 hours of the interview');
    }

    return this.prisma.interviewBooking.delete({ where: { applicantId } });
  }

  // ─── Video submissions ────────────────────────────────────

  async submitVideo(
    applicantId: string,
    videoUrl1?: string,
    videoUrl2?: string,
    videoUrl3?: string,
  ) {
    if (!videoUrl1 && !videoUrl2 && !videoUrl3) {
      throw new BadRequestException('At least one video URL is required');
    }

    const urls = [videoUrl1, videoUrl2, videoUrl3].filter(Boolean) as string[];
    for (const url of urls) {
      if (!url.startsWith('https://')) {
        throw new BadRequestException('Video URLs must use HTTPS');
      }
    }

    const applicant = await this.prisma.applicant.findUnique({
      where: { id: applicantId },
      select: { batchId: true },
    });
    if (!applicant) throw new NotFoundException('Applicant not found');

    return this.prisma.videoSubmission.upsert({
      where: { applicantId },
      create: { applicantId, batchId: applicant.batchId, videoUrl1, videoUrl2, videoUrl3 },
      update: { videoUrl1, videoUrl2, videoUrl3 },
    });
  }

  async getMyVideo(applicantId: string) {
    return this.prisma.videoSubmission.findUnique({ where: { applicantId } });
  }

  async getVideoSubmissions(batchId: string) {
    return this.prisma.videoSubmission.findMany({
      where: { batchId },
      include: {
        applicant: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { submittedAt: 'asc' },
    });
  }

  async reviewVideo(
    submissionId: string,
    score: number,
    reviewNotes: string | undefined,
    adminId: string,
  ) {
    const sub = await this.prisma.videoSubmission.findUnique({ where: { id: submissionId } });
    if (!sub) throw new NotFoundException('Video submission not found');

    return this.prisma.videoSubmission.update({
      where: { id: submissionId },
      data: { score, reviewNotes, reviewedAt: new Date(), reviewedById: adminId },
    });
  }
}
