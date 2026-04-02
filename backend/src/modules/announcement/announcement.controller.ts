import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AnnouncementService } from './announcement.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('api')
export class AnnouncementController {
  constructor(private readonly announcementService: AnnouncementService) {}

  // ─── Public: Get active announcements for a batch ──────
  @Get('announcements/active')
  async getActive(@Query('batchId') batchId?: string) {
    return this.announcementService.findActive(batchId);
  }

  // ─── Admin ─────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('admin/announcements')
  async findAll(@Query('batchId') batchId?: string) {
    return this.announcementService.findAll(batchId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/announcements')
  async create(
    @Body()
    body: {
      batchId?: string;
      title: string;
      content: string;
      deadline?: string;
      sendEmail?: boolean;
    },
  ) {
    return this.announcementService.create(body);
  }

  @UseGuards(JwtAuthGuard)
  @Put('admin/announcements/:id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      content?: string;
      deadline?: string;
      isActive?: boolean;
    },
  ) {
    return this.announcementService.update(id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('admin/announcements/:id')
  async delete(@Param('id') id: string) {
    return this.announcementService.delete(id);
  }
}
