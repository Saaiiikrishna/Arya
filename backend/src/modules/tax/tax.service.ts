import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, TaxClass, TaxRate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { UpsertTaxClassDto, UpsertTaxRateDto } from './dto';

/**
 * SiteSettings keys for the single configured seller identity (decision §14.1:
 * SINGLE GSTIN, single-state, v1). Seller state code is derived from the first
 * two digits of the GSTIN, or stored explicitly.
 */
export const SELLER_GSTIN_SETTING_KEY = 'store.sellerGstin';
export const SELLER_STATE_CODE_SETTING_KEY = 'store.sellerStateCode';
export const DEFAULT_GST_BPS_SETTING_KEY = 'store.defaultGstBps';

/** Hard default if no SiteSettings default GST rate is configured: 18%. */
export const FALLBACK_DEFAULT_GST_BPS = 1800;

/**
 * The authenticated actor performing an admin mutation. Identity is ALWAYS
 * sourced from the JWT by the controller, NEVER from the request body
 * (CLAUDE.md security constraint `4ebf502`).
 */
export interface TaxActor {
  id: string;
  role?: string;
}

/** Options that adjust error semantics depending on the calling surface. */
export interface ComputeTaxOptions {
  /**
   * When true, the call originates from the unauthenticated public quote path.
   * An unresolvable/inactive rate input must NOT leak a 404 (or an
   * active-vs-inactive/exists-vs-not enumeration oracle) to anonymous callers;
   * such cases are remapped to a plain BadRequest. The internal checkout path
   * leaves this false so genuine NotFound surfaces for server-side debugging.
   */
  publicQuote?: boolean;
}

/** A single line of input to the pure tax engine. */
export interface TaxLineInput {
  /** Post-discount taxable value in INTEGER PAISE (lineSubtotal - lineDiscount). */
  taxableValuePaise: number;
  /** SKU's assigned TaxClass id (primary resolver). */
  taxClassId?: string | null;
  /** SKU's HSN code (fallback resolver via TaxRate). */
  hsnCode?: string | null;
}

/** The per-line tax breakdown the engine produces. All amounts INTEGER PAISE. */
export interface TaxLineResult {
  cgstBps: number;
  sgstBps: number;
  igstBps: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
}

/**
 * A line whose TOTAL GST rate has already been resolved to integer basis points.
 * This is the input to the fully-pure, deterministic compute step that has no
 * DB access and no hidden state — checkout resolves rates once, then calls
 * {@link TaxService.computeTaxFromResolvedLines} so the exact same arithmetic
 * is reused and persisted on OrderItem.
 */
export interface ResolvedTaxLineInput {
  /** Post-discount taxable value in INTEGER PAISE. */
  taxableValuePaise: number;
  /** Resolved FULL GST rate in integer basis points (1800 = 18%). */
  totalGstBps: number;
}

@Injectable()
export class TaxService {
  private readonly logger = new Logger(TaxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // PURE DETERMINISTIC ENGINE (no DB, no hidden state — unit-testable)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Round-half-up of an integer-paise tax component, computed entirely in
   * integer arithmetic to avoid floating-point drift (Section 8.3):
   *
   *   amount = floor((taxableValue * bps + 5000) / 10000)
   *
   * `taxableValue * bps` is exact integer arithmetic; adding 5000 (= half of
   * the 10000 divisor) before integer division implements round-half-up.
   *
   * This is `static` and pure: identical inputs always yield identical output,
   * with no reliance on instance state. Callers persist the result verbatim.
   */
  static roundHalfUpComponent(taxableValuePaise: number, bps: number): number {
    // Pure math helper: throw plain Error (not an HTTP exception) so it can be
    // unit-tested in isolation without importing NestJS. All callers validate
    // their inputs upstream; this is a secondary defence.
    if (!Number.isInteger(taxableValuePaise) || taxableValuePaise < 0) {
      throw new Error('taxableValuePaise must be a non-negative integer (paise)');
    }
    if (!Number.isInteger(bps) || bps < 0) {
      throw new Error('GST basis points must be a non-negative integer');
    }
    if (bps === 0) return 0;
    // (num + half) integer-divided by 10000. Math.floor on a non-negative
    // exact integer numerator is the integer division.
    return Math.floor((taxableValuePaise * bps + 5000) / 10000);
  }

  /**
   * Pure per-line computation from an ALREADY-RESOLVED total GST rate. No DB,
   * no instance state. Splits the total into CGST+SGST for intra-state supply
   * (buyer state === seller state) or applies it as IGST for inter-state.
   *
   * Rounding is HALF-UP per component per line (never on the sum) — Section 8.3.
   * For intra-state, cgstBps = sgstBps = floor(total/2). If the total is odd
   * (e.g. an unusual rate), the leftover basis point would be silently dropped,
   * so we reject odd totals on the intra-state path to keep CGST+SGST == total.
   */
  static computeLine(
    line: ResolvedTaxLineInput,
    isInterState: boolean,
  ): TaxLineResult {
    const { taxableValuePaise, totalGstBps } = line;

    if (!Number.isInteger(taxableValuePaise) || taxableValuePaise < 0) {
      throw new BadRequestException(
        'taxableValuePaise must be a non-negative integer (paise)',
      );
    }
    if (!Number.isInteger(totalGstBps) || totalGstBps < 0) {
      throw new BadRequestException('totalGstBps must be a non-negative integer');
    }

    if (isInterState) {
      const igstAmount = TaxService.roundHalfUpComponent(taxableValuePaise, totalGstBps);
      return {
        cgstBps: 0,
        sgstBps: 0,
        igstBps: totalGstBps,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount,
      };
    }

    // Intra-state split. CGST and SGST must sum exactly to the total rate.
    if (totalGstBps % 2 !== 0) {
      throw new BadRequestException(
        `Cannot split an odd total GST rate (${totalGstBps} bps) into equal CGST/SGST halves`,
      );
    }
    const halfBps = totalGstBps / 2;
    // Each component rounded INDEPENDENTLY per line (Section 8.3 rule 2/3).
    const cgstAmount = TaxService.roundHalfUpComponent(taxableValuePaise, halfBps);
    const sgstAmount = TaxService.roundHalfUpComponent(taxableValuePaise, halfBps);
    return {
      cgstBps: halfBps,
      sgstBps: halfBps,
      igstBps: 0,
      cgstAmount,
      sgstAmount,
      igstAmount: 0,
    };
  }

  /**
   * PURE deterministic engine entry point. Given lines whose total GST rate is
   * already resolved, plus the intra/inter-state flag, produce per-line tax.
   *
   * This is the function checkout calls so its persisted OrderItem tax and any
   * later admin quote use IDENTICAL arithmetic. It is static and side-effect
   * free; pass `buyerStateCode === sellerStateCode` as `!isInterState`.
   */
  static computeTaxFromResolvedLines(
    lines: ResolvedTaxLineInput[],
    isInterState: boolean,
  ): TaxLineResult[] {
    return lines.map((line) => TaxService.computeLine(line, isInterState));
  }

  /**
   * Normalises a GST state code to its canonical 2-digit form. Accepts a
   * leading-zero numeric code; rejects anything that is not 2 digits.
   */
  static normalizeStateCode(raw: string | null | undefined): string | null {
    if (raw == null) return null;
    const trimmed = String(raw).trim();
    if (!/^[0-9]{2}$/.test(trimmed)) return null;
    return trimmed;
  }

  // ──────────────────────────────────────────────────────────────────────
  // DB-BACKED RATE RESOLUTION + PUBLIC computeTax()
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Resolve the FULL total GST rate (integer bps) for one line:
   *   1. SKU's TaxClass (cgstBps + sgstBps if a split is stored, else igstBps)
   *   2. HSN TaxRate fallback (totalGstBps)
   *   3. SiteSettings default (DEFAULT_GST_BPS_SETTING_KEY), else 18%.
   *
   * TaxClass/TaxRate are batch-prefetched by the caller and passed in maps so
   * this stays O(1) per line and never N+1.
   */
  private resolveTotalBps(
    line: TaxLineInput,
    classMap: Map<string, TaxClass>,
    rateMap: Map<string, TaxRate>,
    defaultBps: number,
  ): number {
    // 1. TaxClass first.
    if (line.taxClassId) {
      const cls = classMap.get(line.taxClassId);
      if (!cls) {
        throw new NotFoundException(`TaxClass ${line.taxClassId} not found`);
      }
      if (!cls.isActive) {
        throw new BadRequestException(`TaxClass ${cls.name} is inactive`);
      }
      // The class total is either its CGST+SGST split OR its IGST column. They
      // must describe the SAME total. assertClassRatesCoherent() guards this at
      // write time, but an old/imported/legacy row could be inconsistent — in
      // that case we must NOT silently pick the larger (Math.max), which would
      // over-tax. Reject the mismatch explicitly and surface it in monitoring.
      const splitTotal = cls.cgstBps + cls.sgstBps;
      if (splitTotal > 0 && cls.igstBps > 0 && splitTotal !== cls.igstBps) {
        this.logger.warn(
          `TaxClass ${cls.id} (${cls.name}) has incoherent rates: ` +
            `cgst+sgst=${splitTotal} bps != igst=${cls.igstBps} bps`,
        );
        throw new BadRequestException(
          `TaxClass ${cls.name} has incoherent GST rates ` +
            `(CGST+SGST=${splitTotal} bps != IGST=${cls.igstBps} bps); fix the class configuration`,
        );
      }
      // Unambiguous: prefer the split if present, else the IGST column.
      const total = splitTotal > 0 ? splitTotal : cls.igstBps;
      if (total <= 0) {
        throw new BadRequestException(
          `TaxClass ${cls.name} has no positive GST rate configured`,
        );
      }
      return total;
    }

    // 2. HSN TaxRate fallback.
    if (line.hsnCode) {
      const rate = rateMap.get(line.hsnCode);
      if (rate) return rate.totalGstBps;
    }

    // 3. SiteSettings default.
    return defaultBps;
  }

  /**
   * Resolve the configured seller state code from the single configured GSTIN
   * (decision §14.1). Order of precedence:
   *   1. explicit SELLER_STATE_CODE_SETTING_KEY,
   *   2. first 2 digits of SELLER_GSTIN_SETTING_KEY.
   * Throws if neither is configured — tax cannot be computed without an origin.
   */
  async resolveSellerStateCode(): Promise<string> {
    const explicit = TaxService.normalizeStateCode(
      await this.settings.get(SELLER_STATE_CODE_SETTING_KEY),
    );
    if (explicit) return explicit;

    const gstin = (await this.settings.get(SELLER_GSTIN_SETTING_KEY))?.trim();
    if (gstin && gstin.length >= 2) {
      const fromGstin = TaxService.normalizeStateCode(gstin.slice(0, 2));
      if (fromGstin) return fromGstin;
    }

    throw new BadRequestException(
      'Seller GST state is not configured (set store.sellerStateCode or store.sellerGstin in settings)',
    );
  }

  /** Resolve the configured default total GST rate (bps); falls back to 18%. */
  async resolveDefaultGstBps(): Promise<number> {
    const raw = await this.settings.get(DEFAULT_GST_BPS_SETTING_KEY);
    if (raw == null) return FALLBACK_DEFAULT_GST_BPS;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10000) {
      this.logger.warn(
        `Invalid ${DEFAULT_GST_BPS_SETTING_KEY}="${raw}" in settings; using ${FALLBACK_DEFAULT_GST_BPS}`,
      );
      return FALLBACK_DEFAULT_GST_BPS;
    }
    return parsed;
  }

  /**
   * THE single entry point used at checkout. Resolves each line's total GST
   * rate (TaxClass → HSN → default), determines intra/inter-state from
   * buyer-vs-seller state, then delegates to the PURE deterministic engine so
   * the persisted OrderItem tax and any later quote are byte-identical.
   *
   * @param lines  one entry per order line (taxable value already net of discount)
   * @param buyerStateCode  place of supply (buyer shipping state), 2-digit
   * @param sellerStateCode optional; if omitted resolves from the single
   *                        configured seller GSTIN in SiteSettings
   * @param options         {@link ComputeTaxOptions}; set `publicQuote` when
   *                        invoked from the unauthenticated quote surface so
   *                        unresolvable rates do not leak 404/oracle responses
   */
  async computeTax(
    lines: TaxLineInput[],
    buyerStateCode: string,
    sellerStateCode?: string,
    options: ComputeTaxOptions = {},
  ): Promise<TaxLineResult[]> {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new BadRequestException('At least one line is required to compute tax');
    }

    const buyer = TaxService.normalizeStateCode(buyerStateCode);
    if (!buyer) {
      throw new BadRequestException('buyerStateCode must be a 2-digit GST state code');
    }

    let seller = TaxService.normalizeStateCode(sellerStateCode);
    if (!seller) {
      if (sellerStateCode != null) {
        throw new BadRequestException('sellerStateCode must be a 2-digit GST state code');
      }
      seller = await this.resolveSellerStateCode();
    }

    const isInterState = buyer !== seller;

    // Batch-prefetch every referenced TaxClass and HSN TaxRate (no N+1).
    const classIds = Array.from(
      new Set(lines.map((l) => l.taxClassId).filter((v): v is string => !!v)),
    );
    const hsnCodes = Array.from(
      new Set(
        lines
          .filter((l) => !l.taxClassId && !!l.hsnCode)
          .map((l) => l.hsnCode as string),
      ),
    );

    const [classes, rates, defaultBps] = await Promise.all([
      classIds.length
        ? this.prisma.taxClass.findMany({ where: { id: { in: classIds } } })
        : Promise.resolve([] as TaxClass[]),
      hsnCodes.length
        ? this.prisma.taxRate.findMany({ where: { hsnCode: { in: hsnCodes } } })
        : Promise.resolve([] as TaxRate[]),
      this.resolveDefaultGstBps(),
    ]);

    const classMap = new Map(classes.map((c) => [c.id, c]));
    const rateMap = new Map(rates.map((r) => [r.hsnCode, r]));

    // Resolve each line's total rate, then run the PURE engine in one shot so
    // the exact arithmetic is the deterministic path checkout reuses.
    const resolved: ResolvedTaxLineInput[] = lines.map((line) => {
      if (!Number.isInteger(line.taxableValuePaise) || line.taxableValuePaise < 0) {
        throw new BadRequestException(
          'taxableValuePaise must be a non-negative integer (paise)',
        );
      }
      let totalGstBps: number;
      try {
        totalGstBps = this.resolveTotalBps(line, classMap, rateMap, defaultBps);
      } catch (e) {
        // On the public quote surface, never leak a 404 (or an exists/active
        // enumeration oracle) for an internal identifier the caller supplied —
        // collapse it to an opaque 400.
        if (options.publicQuote && e instanceof NotFoundException) {
          throw new BadRequestException('Unable to resolve a tax rate for the supplied input');
        }
        throw e;
      }
      return {
        taxableValuePaise: line.taxableValuePaise,
        totalGstBps,
      };
    });

    return TaxService.computeTaxFromResolvedLines(resolved, isInterState);
  }

  // ──────────────────────────────────────────────────────────────────────
  // ADMIN CRUD — TaxClass
  // ──────────────────────────────────────────────────────────────────────

  async listTaxClasses() {
    return this.prisma.taxClass.findMany({ orderBy: { name: 'asc' } });
  }

  async getTaxClass(id: string) {
    const cls = await this.prisma.taxClass.findUnique({ where: { id } });
    if (!cls) throw new NotFoundException('TaxClass not found');
    return cls;
  }

  /**
   * Single source of truth for mapping a TaxClass DTO to the Prisma write shape.
   * Used by BOTH create and update so the two paths can never silently diverge
   * when a column is added (e.g. a future `effectiveFrom`/`description`).
   */
  private buildTaxClassData(dto: UpsertTaxClassDto) {
    return {
      name: dto.name,
      type: dto.type ?? 'GST',
      hsnCode: dto.hsnCode ?? null,
      cgstBps: dto.cgstBps,
      sgstBps: dto.sgstBps,
      igstBps: dto.igstBps,
      isActive: dto.isActive ?? true,
    };
  }

  async createTaxClass(dto: UpsertTaxClassDto, actor: TaxActor) {
    this.assertClassRatesCoherent(dto);
    try {
      const created = await this.prisma.taxClass.create({
        data: this.buildTaxClassData(dto),
      });
      this.audit('CREATE', 'TaxClass', created.id, actor, { before: null, after: created });
      return created;
    } catch (e) {
      throw this.mapUniqueError(e, `A tax class named "${dto.name}" already exists`);
    }
  }

  async updateTaxClass(id: string, dto: UpsertTaxClassDto, actor: TaxActor) {
    const before = await this.getTaxClass(id);
    this.assertClassRatesCoherent(dto);
    try {
      const after = await this.prisma.taxClass.update({
        where: { id },
        data: this.buildTaxClassData(dto),
      });
      this.audit('UPDATE', 'TaxClass', id, actor, { before, after });
      return after;
    } catch (e) {
      throw this.mapUniqueError(e, `A tax class named "${dto.name}" already exists`);
    }
  }

  /**
   * Soft-deactivate rather than hard-delete: SKUs reference TaxClass and order
   * history must remain resolvable. Deactivation removes it from future
   * resolution (computeTax rejects inactive classes) without breaking FKs.
   */
  async deactivateTaxClass(id: string, actor: TaxActor) {
    const before = await this.getTaxClass(id);
    const after = await this.prisma.taxClass.update({
      where: { id },
      data: { isActive: false },
    });
    this.audit('DEACTIVATE', 'TaxClass', id, actor, { before, after });
    return after;
  }

  /**
   * The stored CGST+SGST split and the IGST column must describe the SAME total
   * rate (or one side may be zero if configured single-sided). Reject a class
   * where both are positive but disagree, since a silent mismatch would mislead
   * admins (and resolveTotalBps rejects such rows at read time too).
   */
  private assertClassRatesCoherent(dto: UpsertTaxClassDto) {
    const splitTotal = dto.cgstBps + dto.sgstBps;
    if (splitTotal > 0 && dto.igstBps > 0 && splitTotal !== dto.igstBps) {
      throw new BadRequestException(
        `CGST+SGST (${splitTotal} bps) must equal IGST (${dto.igstBps} bps) for the same tax class`,
      );
    }
    if (dto.cgstBps !== dto.sgstBps && dto.cgstBps > 0 && dto.sgstBps > 0) {
      throw new BadRequestException('CGST and SGST basis points must be equal');
    }
    if (splitTotal === 0 && dto.igstBps === 0) {
      throw new BadRequestException('Tax class must specify a positive GST rate');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // ADMIN CRUD — TaxRate (HSN → bps)
  // ──────────────────────────────────────────────────────────────────────

  async listTaxRates() {
    return this.prisma.taxRate.findMany({ orderBy: { hsnCode: 'asc' } });
  }

  async getTaxRate(id: string) {
    const rate = await this.prisma.taxRate.findUnique({ where: { id } });
    if (!rate) throw new NotFoundException('TaxRate not found');
    return rate;
  }

  /**
   * Parse the optional effectiveFrom ISO string to a Date, rejecting garbage.
   * Returns undefined when not supplied (so Prisma keeps its @default(now()) on
   * create, and leaves the existing value untouched on update).
   */
  private parseEffectiveFrom(raw?: string): Date | undefined {
    if (raw == null) return undefined;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('effectiveFrom must be a valid ISO-8601 date');
    }
    return d;
  }

  /**
   * Upsert by HSN code (hsnCode is @unique). Admins manage the HSN→bps table by
   * HSN, so create-or-update on conflict is the natural operation. An admin may
   * supply effectiveFrom to record when a revised rate took effect (e.g. a GST
   * council change) for forward audit/filing reconstruction.
   */
  async upsertTaxRate(dto: UpsertTaxRateDto, actor: TaxActor) {
    const hsn = dto.hsnCode.trim();
    if (!hsn) throw new BadRequestException('hsnCode is required');
    const effectiveFrom = this.parseEffectiveFrom(dto.effectiveFrom);
    const before = await this.prisma.taxRate.findUnique({ where: { hsnCode: hsn } });
    const after = await this.prisma.taxRate.upsert({
      where: { hsnCode: hsn },
      create: {
        hsnCode: hsn,
        type: dto.type ?? 'GST',
        totalGstBps: dto.totalGstBps,
        description: dto.description ?? null,
        ...(effectiveFrom ? { effectiveFrom } : {}),
      },
      update: {
        type: dto.type ?? 'GST',
        totalGstBps: dto.totalGstBps,
        description: dto.description ?? null,
        ...(effectiveFrom ? { effectiveFrom } : {}),
      },
    });
    this.audit(before ? 'UPDATE' : 'CREATE', 'TaxRate', after.id, actor, {
      before,
      after,
    });
    return after;
  }

  /**
   * Targeted update of a specific TaxRate row by its UUID (findUnique → update).
   * Unlike {@link upsertTaxRate}, this cannot create a new row or overwrite a
   * different HSN by guessing its code — it mutates exactly the addressed record.
   */
  async updateTaxRate(id: string, dto: UpsertTaxRateDto, actor: TaxActor) {
    const before = await this.getTaxRate(id);
    const hsn = dto.hsnCode.trim();
    if (!hsn) throw new BadRequestException('hsnCode is required');
    const effectiveFrom = this.parseEffectiveFrom(dto.effectiveFrom);
    try {
      const after = await this.prisma.taxRate.update({
        where: { id },
        data: {
          hsnCode: hsn,
          type: dto.type ?? 'GST',
          totalGstBps: dto.totalGstBps,
          description: dto.description ?? null,
          ...(effectiveFrom ? { effectiveFrom } : {}),
        },
      });
      this.audit('UPDATE', 'TaxRate', id, actor, { before, after });
      return after;
    } catch (e) {
      throw this.mapUniqueError(e, `HSN code "${hsn}" already maps to another tax rate`);
    }
  }

  async deleteTaxRate(id: string, actor: TaxActor) {
    const before = await this.getTaxRate(id);
    await this.prisma.taxRate.delete({ where: { id } });
    this.audit('DELETE', 'TaxRate', id, actor, { before, after: null });
    return { deleted: true };
  }

  // ──────────────────────────────────────────────────────────────────────

  /**
   * Actor-attributed audit trail for every TaxClass/TaxRate mutation. Tax rate
   * changes directly drive every future order's GST and are compliance-material,
   * so each mutation is logged with the JWT-sourced actor and a before/after
   * snapshot. There is no generic AuditEvent table in the schema, so this emits
   * a structured log line (actor id NEVER taken from the request body —
   * CLAUDE.md security constraint `4ebf502`).
   */
  private audit(
    action: 'CREATE' | 'UPDATE' | 'DEACTIVATE' | 'DELETE',
    entityType: 'TaxClass' | 'TaxRate',
    entityId: string,
    actor: TaxActor,
    snapshot: { before: unknown; after: unknown },
  ): void {
    this.logger.log(
      JSON.stringify({
        audit: 'tax',
        action,
        entityType,
        entityId,
        actorId: actor?.id ?? 'unknown',
        actorRole: actor?.role ?? null,
        before: snapshot.before,
        after: snapshot.after,
        at: new Date().toISOString(),
      }),
    );
  }

  private mapUniqueError(e: unknown, message: string): Error {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return new ConflictException(message);
    }
    return e instanceof Error ? e : new Error(String(e));
  }
}
