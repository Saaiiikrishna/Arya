import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { InventoryMatrixQueryDto } from './inventory-query.dto';

/**
 * Reproduces the global ValidationPipe contract: transform on, implicit
 * conversion on. Query params always arrive as STRINGS, so the DTO must coerce
 * "1"/"50" to numbers BEFORE @IsInt/@Min/@Max run — a regression here returned
 * the raw string and made every paginated inventory request 400 with
 * "page must be an integer number / limit must not be greater than 200 …".
 */
function build(input: Record<string, unknown>) {
  const dto = plainToInstance(InventoryMatrixQueryDto, input, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: false });
  return { dto, errors };
}

describe('InventoryMatrixQueryDto — page/limit coercion', () => {
  it('accepts numeric STRING page/limit (the real query-string case) as numbers', () => {
    const { dto, errors } = build({ page: '1', limit: '50' });
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(50);
    expect(typeof dto.page).toBe('number');
    expect(typeof dto.limit).toBe('number');
  });

  it('coerces blank page/limit to the DTO defaults', () => {
    const { dto, errors } = build({ page: '', limit: '' });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 1, limit: 50 });
  });

  it('passes validation when page/limit are absent (service applies its own default)', () => {
    // class-transformer does not invoke the @Transform for keys missing from the
    // payload, but the field is @IsOptional and inventory.service defaults a
    // missing page/limit — so an absent value must simply not 400.
    expect(build({}).errors).toHaveLength(0);
  });

  it('rejects out-of-range / non-integer values', () => {
    expect(build({ page: '0' }).errors.length).toBeGreaterThan(0); // @Min(1)
    expect(build({ limit: '999' }).errors.length).toBeGreaterThan(0); // @Max(200)
    expect(build({ page: 'banana' }).errors.length).toBeGreaterThan(0); // @IsInt
    expect(build({ limit: '1.5' }).errors.length).toBeGreaterThan(0); // @IsInt
  });

  it('accepts numeric page/limit passed as actual numbers too', () => {
    const { dto, errors } = build({ page: 2, limit: 200 });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 2, limit: 200 });
  });
});
