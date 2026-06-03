import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { AdminGuard } from '../auth/guards';

/**
 * Admin-only window into the notification log: browse what was sent across
 * email + WhatsApp, and re-send an email notification that failed or needs
 * to go out again.
 */
@Controller('api/admin/notifications')
@UseGuards(AdminGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  async list(
    @Query('applicantId') applicantId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.listNotifications({
      applicantId,
      status,
      type,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post(':id/resend')
  async resend(@Param('id') id: string) {
    return this.notifications.resendNotification(id);
  }
}
