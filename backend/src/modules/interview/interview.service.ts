import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { NotificationService } from '../notifications/notification.service';
import { BackfillService } from '../automation/backfill.service';
import { BookingStatus, InterviewDecision } from '@prisma/client';

// Statuses that occupy a seat in a slot. COMPLETED / NO_SHOW / CANCELLED
// bookings no longer consume capacity and must be excluded from availability.
const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
];

@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly backfill: BackfillService,
  ) {}

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

    // Idempotency / race guard. Two admins can both read an undecided booking,
    // both pass a plain status check, and apply conflicting terminal decisions
    // plus duplicate backfill. To make this safe we perform an atomic
    // compare-and-set inside the transaction: conditionally update the booking
    // ONLY while it is still undecided (decision IS NULL), then check the
    // affected-row count. Exactly one concurrent call can flip NULL -> decision,
    // so only the winner runs the applicant status change + backfill enqueue.
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.interviewBooking.updateMany({
        where: { id: bookingId, decision: null },
        data: {
          status: 'COMPLETED',
          decision,
          score,
          notes,
          decidedAt: new Date(),
          decidedById: adminId,
        },
      });

      // We lost the CAS (a concurrent call already recorded a decision) — or a
      // decision was recorded between our initial read and this update.
      if (count === 0) {
        throw new BadRequestException(
          'A decision has already been recorded for this booking.',
        );
      }

      if (decision === 'SELECTED') {
        await tx.applicant.update({
          where: { id: booking.applicantId },
          data: { status: 'ELIGIBLE' },
        });
      } else if (decision === 'REJECTED') {
        await tx.applicant.update({
          where: { id: booking.applicantId },
          data: { status: 'REMOVED' },
        });
      }

      // Return the freshly-updated booking to preserve the previous response
      // shape (the committed booking row). The CAS above guarantees the row
      // exists, so this re-read is always non-null.
      const row = await tx.interviewBooking.findUnique({ where: { id: bookingId } });
      if (!row) throw new NotFoundException('Booking not found');
      return row;
    });

    this.logger.log(`Interview decision ${decision} recorded for booking ${bookingId}`);

    // Notify the applicant of the interview outcome (best-effort, post-commit).
    // Only reached when THIS call won the compare-and-set above; a loser throws
    // before this point, so notifications/backfill never fire twice.
    if (decision === 'SELECTED' || decision === 'REJECTED') {
      const applicant = await this.prisma.applicant.findUnique({
        where: { id: booking.applicantId },
        select: {
          id: true,
          email: true,
          firstName: true,
          phone: true,
          batchId: true,
          batch: { select: { batchNumber: true } },
        },
      });
      if (applicant) {
        const cohortNumber = applicant.batch?.batchNumber ?? '';
        void this.notifications.interviewDecision(
          { id: applicant.id, email: applicant.email, firstName: applicant.firstName, phone: applicant.phone },
          decision === 'SELECTED',
          cohortNumber,
        );
        // A rejected interviewee leaves a closed (interview-stage) batch — pull a
        // replacement from the next batch to keep the cohort full. Best-effort.
        if (decision === 'REJECTED' && applicant.batchId) {
          void this.backfill.enqueueBackfill(applicant.batchId, 1);
        }
      }
    }

    return updated;
  }

  // ─── Applicant: Slot booking ──────────────────────────────

  async getAvailableSlots(batchId: string) {
    const now = new Date();
    const slots = await this.prisma.interviewSlot.findMany({
      where: { batchId, startTime: { gt: now } },
      include: {
        _count: {
          select: {
            bookings: { where: { status: { in: ACTIVE_BOOKING_STATUSES } } },
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });

    return slots.map((slot) => ({
      ...slot,
      availableSeats: Math.max(0, slot.capacity - slot._count.bookings),
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
    const booking = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.interviewBooking.findUnique({ where: { applicantId } });
        // applicantId is @unique, so at most one booking row can exist. An
        // active booking blocks re-booking; a finished/cancelled one must be
        // removed first to free the unique slot for a new booking.
        if (existing) {
          if (
            existing.status === BookingStatus.PENDING ||
            existing.status === BookingStatus.CONFIRMED
          ) {
            throw new BadRequestException(
              'You already have an interview booking. Cancel it first to choose another slot.',
            );
          }
          throw new BadRequestException(
            'You already have a finished interview booking and cannot book another slot.',
          );
        }

        const applicant = await tx.applicant.findUnique({
          where: { id: applicantId },
          select: { batchId: true },
        });
        if (!applicant) throw new NotFoundException('Applicant not found');

        const slot = await tx.interviewSlot.findUnique({ where: { id: slotId } });
        if (!slot) throw new NotFoundException('Slot not found');
        if (applicant.batchId !== slot.batchId) throw new BadRequestException('Slot belongs to a different batch');
        if (new Date() >= slot.startTime) throw new BadRequestException('This slot has already passed');

        // Count only seat-occupying bookings so capacity is computed correctly.
        const activeBookings = await tx.interviewBooking.count({
          where: { slotId, status: { in: ACTIVE_BOOKING_STATUSES } },
        });
        if (activeBookings >= slot.capacity) {
          throw new BadRequestException('This slot is fully booked');
        }

        return tx.interviewBooking.create({
          data: { slotId, applicantId, status: 'CONFIRMED' },
          include: { slot: true },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    // Notify the applicant that their interview is scheduled (best-effort,
    // post-commit so it never blocks/aborts the Serializable transaction).
    const applicant = await this.prisma.applicant.findUnique({
      where: { id: applicantId },
      select: { id: true, email: true, firstName: true, phone: true },
    });
    if (applicant) {
      const start = booking.slot.startTime;
      const dateStr = start.toLocaleDateString();
      const timeStr = start.toLocaleTimeString();
      // InterviewSlot has no meeting-link field, so none is available yet. Pass a
      // human-readable fallback instead of an empty string to avoid a broken
      // join link / empty anchor in the notification template.
      void this.notifications.interviewScheduled(
        applicant,
        dateStr,
        timeStr,
        'To be shared closer to the date',
      );
    }

    return booking;
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
    if (!applicant.batchId) {
      throw new BadRequestException('Applicant is not assigned to a batch');
    }

    if (!applicant.batchId) throw new BadRequestException('Applicant is not assigned to a batch');
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
