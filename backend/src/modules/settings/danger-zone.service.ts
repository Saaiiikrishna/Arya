import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';

@Injectable()
export class DangerZoneService {
  private readonly logger = new Logger(DangerZoneService.name);

  constructor(private readonly prisma: PrismaService) {}

  private validateIdentifier(name: string) {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      throw new UnauthorizedException('Invalid database identifier format.');
    }
  }

  async getTables() {
    // Relying on pg_stat_user_tables can return 0 if ANALYZE hasn't run.
    // Instead, get tables from information_schema and do exact counts.
    const tablesRaw = await this.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;

    const tables = [];
    for (const t of tablesRaw) {
      if (t.table_name === '_prisma_migrations') continue;
      
      this.validateIdentifier(t.table_name);
      try {
        const countRes = await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT COUNT(*) as exact_count FROM "${t.table_name}"`
        );
        const count = countRes[0]?.exact_count ? Number(countRes[0].exact_count) : 0;
        
        tables.push({
          table_name: t.table_name,
          row_count: count
        });
      } catch (err) {
        this.logger.error(`Error counting rows for ${t.table_name}: ${err.message}`);
        tables.push({ table_name: t.table_name, row_count: 0 });
      }
    }

    // Sort alphabetically
    return tables.sort((a, b) => a.table_name.localeCompare(b.table_name));
  }

  async getTableData(tableName: string) {
    this.validateIdentifier(tableName);
    
    // Get primary key
    const pkRaw = await this.prisma.$queryRaw<{ column_name: string }[]>`
      SELECT a.attname as column_name
      FROM   pg_index i
      JOIN   pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE  i.indrelid = ${tableName}::regclass
      AND    i.indisprimary;
    `;
    const pkColumn = pkRaw.length > 0 ? pkRaw[0].column_name : null;

    // Get columns via information schema
    const columnsRaw = await this.prisma.$queryRaw<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tableName}
      ORDER BY ordinal_position
    `;

    // Fetch top 50 rows
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "${tableName}" LIMIT 50`
    );

    return {
      tableName,
      pkColumn,
      columns: columnsRaw,
      rows
    };
  }

  async deleteRow(tableName: string, pkColumn: string, rowId: string) {
    this.validateIdentifier(tableName);
    this.validateIdentifier(pkColumn);

    this.logger.warn(`DangerZone: Deleting row from ${tableName} where ${pkColumn} = ${rowId}`);
    
    // Pass as parameter for the value, but identifiers must be inline
    try {
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM "${tableName}" WHERE "${pkColumn}" = $1`,
        rowId
      );
      return { success: true, message: 'Row successfully deleted' };
    } catch (e: any) {
      this.logger.error(e);
      throw new BadRequestException(`Failed to delete row: ${e.message}`);
    }
  }

  async clearColumn(tableName: string, columnName: string) {
    this.validateIdentifier(tableName);
    this.validateIdentifier(columnName);

    this.logger.warn(`DangerZone: Clearing data from ${tableName}.${columnName}`);
    
    try {
      // Attempt to set to NULL first. If it's a non-nullable field, it will throw.
      await this.prisma.$executeRawUnsafe(`UPDATE "${tableName}" SET "${columnName}" = NULL`);
      return { success: true, message: `Column ${columnName} successfully cleared (set to NULL).` };
    } catch (e: any) {
      if (e.message.includes('null value in column')) {
        // Fallback: try setting to defaults, or empty values based on typical DB rules.
        // Actually, it's safer to just return the error and let the user know they can't NULL it.
        throw new BadRequestException(
          `Cannot reset this column because the schema enforces it (NOT NULL constraints).`
        );
      }
      throw new BadRequestException(`Failed to clear column: ${e.message}`);
    }
  }

  async truncateTable(tableName: string) {
    if (tableName === '_prisma_migrations') {
      throw new UnauthorizedException('Cannot truncate migration history.');
    }
    this.validateIdentifier(tableName);

    this.logger.warn(`Truncating table: ${tableName}`);
    await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tableName}" CASCADE`);
    return { success: true, message: `Table ${tableName} truncated successfully.` };
  }

  async truncateAllTables() {
    this.logger.warn('TRUNCATING ALL TABLES IN THE DATABASE');
    const tables = await this.getTables();

    for (const t of tables) {
      if (t.table_name === '_prisma_migrations' || t.table_name === 'admins') {
        continue;
      }
      this.logger.warn(`Bulk truncated table: ${t.table_name}`);
      await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE "${t.table_name}" CASCADE`);
    }

    return { success: true, message: 'All unprotected tables were successfully truncated.' };
  }
}
