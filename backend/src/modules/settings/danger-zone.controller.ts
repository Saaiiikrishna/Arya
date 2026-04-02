import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Query
} from '@nestjs/common';
import { DangerZoneService } from './danger-zone.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('api/admin/danger-zone')
@UseGuards(JwtAuthGuard)
export class DangerZoneController {
  constructor(private readonly dangerZoneService: DangerZoneService) {}

  @Get('tables')
  async getTables() {
    return this.dangerZoneService.getTables();
  }

  @Get('tables/:tableName/data')
  async getTableData(@Param('tableName') tableName: string) {
    return this.dangerZoneService.getTableData(tableName);
  }

  @Delete('tables/:tableName/rows')
  async deleteRow(
    @Param('tableName') tableName: string,
    @Query('pkColumn') pkColumn: string,
    @Query('id') id: string
  ) {
    return this.dangerZoneService.deleteRow(tableName, pkColumn, id);
  }

  @Delete('tables/:tableName/columns/:columnName')
  async clearColumn(
    @Param('tableName') tableName: string,
    @Param('columnName') columnName: string
  ) {
    return this.dangerZoneService.clearColumn(tableName, columnName);
  }

  @Post('truncate-all')
  async truncateAllTables() {
    return this.dangerZoneService.truncateAllTables();
  }

  @Post('truncate/:tableName')
  async truncateTable(@Param('tableName') tableName: string) {
    return this.dangerZoneService.truncateTable(tableName);
  }
}
