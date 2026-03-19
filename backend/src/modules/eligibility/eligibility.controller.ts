import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { EligibilityService } from './eligibility.service';
import { JwtAuthGuard } from '../auth/guards';
import { CriteriaOperator } from '@prisma/client';

@Controller('api/admin/eligibility')
@UseGuards(JwtAuthGuard)
export class EligibilityController {
  constructor(private readonly eligibilityService: EligibilityService) {}

  @Post()
  async create(@Body() body: {
    questionId: string;
    operator: CriteriaOperator;
    value: any;
    weight?: number;
  }) {
    return this.eligibilityService.createCriteria(body);
  }

  @Get()
  async findAll() {
    return this.eligibilityService.findAll();
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.eligibilityService.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.eligibilityService.remove(id);
  }

  @Post('screen/:batchId')
  async screenBatch(@Param('batchId') batchId: string) {
    return this.eligibilityService.screenBatch(batchId);
  }

  @Get('evaluate/:applicantId')
  async evaluate(@Param('applicantId') applicantId: string) {
    return this.eligibilityService.evaluateApplicant(applicantId);
  }
}
