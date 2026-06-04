import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReservationStatus,
  StockMovementReason,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateWarehouseDto,
  InventoryMatrixQueryDto,
  MovementQueryDto,
  StockAdjustDto,
  StockTransferDto,
  UpdateWarehouseDto,
} from './dto';

/** A unit of work for a stock primitive: reserve/release/commit `qty` of `skuId` at `warehouseId`. */
export interface StockLine {
  skuId: string;
  warehouseId: string;
  qty: number;
}

/** Accepts either the PrismaService (self) or an open transaction client. */
type Db = PrismaService | Prisma.TransactionClient;

/** Identity of the actor performing a mutation — sourced from the JWT by the caller, never the body. */
export interface StockActor {
  id: string;
  role?: string;
}

const SYSTEM_ACTOR: StockActor = { id: 'SYSTEM', role: 'SYSTEM' };

const MAX_PAGE_LIMIT = 200;
const DEFAULT_PAGE_LIMIT = 50;
/** Hard cap on rows the reorder report will materialise, so the endpoint cannot OOM. */
const REORDER_REPORT_LIMIT = 500;

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────
  //  Lock-ordering helpers (Section 5.1 — deadlock elimination)
  // ─────────────────────────────────────────────────────────────

  /** Stable advisory-lock key for one (sku, warehouse) stock-level row. */
  private static lockKey(skuId: string, warehouseId: string): string {
    return `stock_${skuId}_${warehouseId}`;
  }

  /**
   * Compute the deterministic, deduped, ascending-(skuId, warehouseId) lock-key
   * ordering for a fully-expanded line set. Callers MUST pass the FULLY expanded
   * set (bundle members already expanded) — this method does not expand bundles.
   */
  static lockKeys(lines: StockLine[]): string[] {
    const keys = new Set<string>();
    for (const l of lines)
      keys.add(InventoryService.lockKey(l.skuId, l.warehouseId));
    return Array.from(keys).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /**
   * Acquire every advisory lock for the given line set, ascending by (skuId,
   * warehouseId), BEFORE any mutation. This single up-front, globally-ordered
   * acquisition is what prevents the A-then-B / B-then-A multi-SKU deadlock the
   * single-lock services never faced (Section 5.1). The locks are transaction
   * scoped and auto-release at commit/rollback.
   */
  private async acquireLocks(
    tx: Prisma.TransactionClient,
    lines: StockLine[],
  ): Promise<void> {
    // Derive the canonical, deduped, ascending key order via the SINGLE shared
    // implementation (lockKeys) so the public key list and the actual acquisition
    // order can never drift apart — even if the lockKey format ever changes.
    for (const key of InventoryService.lockKeys(lines)) {
      // pg_advisory_xact_lock takes a 32-bit int; hashtext(key) maps the stable
      // string key to that space. Collision probability (~N²/2³²) is negligible at
      // realistic concurrency and a collision is non-exploitable for oversell (the
      // version CAS still holds) — at worst two unrelated rows serialize briefly.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }
  }

  /**
   * Coalesce a raw line set into per-(sku, warehouse) totals. Two cart items for
   * the same sku/warehouse (e.g. a bundle member that is also bought standalone)
   * must reserve their SUM under one CAS, not race two partial CAS bumps.
   */
  private static coalesce(lines: StockLine[]): StockLine[] {
    const byKey = new Map<string, StockLine>();
    for (const l of lines) {
      if (!Number.isInteger(l.qty) || l.qty <= 0) {
        throw new BadRequestException(
          `Invalid quantity ${l.qty} for SKU ${l.skuId} — must be a positive integer`,
        );
      }
      const key = InventoryService.lockKey(l.skuId, l.warehouseId);
      const existing = byKey.get(key);
      if (existing) existing.qty += l.qty;
      else
        byKey.set(key, {
          skuId: l.skuId,
          warehouseId: l.warehouseId,
          qty: l.qty,
        });
    }
    return Array.from(byKey.values());
  }

  /** Run `work` inside `db` if it is already a transaction, else open a fresh one. */
  private async withTx<T>(
    db: Db,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (this.isTransactionClient(db)) {
      return work(db);
    }
    return (db as PrismaService).$transaction(work);
  }

  private isTransactionClient(db: Db): db is Prisma.TransactionClient {
    // Explicit discriminator: PrismaService carries the IS_PRISMA_SERVICE marker;
    // an interactive Prisma.TransactionClient does not. This is immune to Prisma
    // internal changes (e.g. a tx client gaining a `$transaction` method), unlike
    // duck-typing on the presence of `$transaction`.
    return (db as PrismaService).IS_PRISMA_SERVICE !== true;
  }

  // ─────────────────────────────────────────────────────────────
  //  EXPORTED PRIMITIVES (used by checkout / returns / procurement)
  // ─────────────────────────────────────────────────────────────

  /**
   * Reserve the FULL multi-line set atomically. This is the multi-SKU entry point.
   *
   * Algorithm (Sections 5.1 / 5.2 / 8.4):
   *  1. Coalesce duplicate (sku, warehouse) lines into summed quantities.
   *  2. Acquire EVERY advisory lock up front, ascending (skuId, warehouseId),
   *     BEFORE any mutation — prevents multi-SKU deadlock.
   *  3. For each line: re-read the locked StockLevel, assert available >= qty,
   *     `updateMany` CAS bump `reserved` guarded by `version` AND the
   *     `onHand - reserved - qty >= 0` invariant, then create a StockReservation
   *     (ACTIVE, TTL) + a StockMovement(RESERVE) audit row.
   *  4. If ANY line fails, throw — the whole tx rolls back (no partial reservation).
   *
   * @returns the created StockReservation ids (one per coalesced line).
   */
  async reserveMany(
    db: Db,
    lines: StockLine[],
    opts: {
      orderId?: string;
      cartId?: string;
      expiresAt: Date;
      actor?: StockActor;
      referenceType?: string;
    },
  ): Promise<string[]> {
    if (!lines || lines.length === 0) {
      throw new BadRequestException('reserveMany requires at least one line');
    }
    // The audit trail's triggeredBy MUST come from the JWT (CLAUDE.md / 4ebf502).
    // Refuse to silently attribute a stock reservation to SYSTEM if a caller
    // (checkout, procurement) forgot to pass the actor.
    const actor = this.requireActor(opts.actor);
    const coalesced = InventoryService.coalesce(lines);

    return this.withTx(db, async (tx) => {
      // (2) one globally-ordered up-front lock pass over the full set.
      await this.acquireLocks(tx, coalesced);

      const reservationIds: string[] = [];
      for (const line of coalesced) {
        const level = await tx.stockLevel.findUnique({
          where: {
            skuId_warehouseId: {
              skuId: line.skuId,
              warehouseId: line.warehouseId,
            },
          },
        });
        if (!level) {
          throw new ConflictException(
            `INSUFFICIENT_STOCK: no stock record for SKU ${line.skuId} at warehouse ${line.warehouseId}`,
          );
        }

        const available = level.onHand - level.reserved;
        if (available < line.qty) {
          throw new ConflictException(
            `INSUFFICIENT_STOCK: SKU ${line.skuId} has ${available} available, need ${line.qty}`,
          );
        }

        // (3) CAS bump reserved, guarded by version + the available>=0 invariant.
        const bumped = await tx.stockLevel.updateMany({
          where: {
            id: level.id,
            version: level.version,
            // Defense-in-depth: SQL-level guarantee that available stays >= 0.
            onHand: { gte: level.reserved + line.qty },
          },
          data: {
            reserved: { increment: line.qty },
            version: { increment: 1 },
          },
        });
        if (bumped.count !== 1) {
          // Lost the optimistic race despite holding the advisory lock (should not
          // happen under the lock, but assert rather than silently oversell).
          throw new ConflictException(
            `INSUFFICIENT_STOCK: concurrent update prevented reserving SKU ${line.skuId}`,
          );
        }

        const reservation = await tx.stockReservation.create({
          data: {
            orderId: opts.orderId ?? null,
            cartId: opts.cartId ?? null,
            skuId: line.skuId,
            warehouseId: line.warehouseId,
            quantity: line.qty,
            status: 'ACTIVE',
            expiresAt: opts.expiresAt,
          },
        });
        reservationIds.push(reservation.id);

        await this.writeMovement(tx, {
          skuId: line.skuId,
          warehouseId: line.warehouseId,
          type: StockMovementType.RESERVE,
          reason: StockMovementReason.RESERVATION,
          quantity: 0,
          reservedDelta: line.qty,
          balanceAfter: level.onHand,
          referenceType:
            opts.referenceType ?? (opts.orderId ? 'ORDER' : 'CART'),
          referenceId: opts.orderId ?? opts.cartId ?? null,
          actor,
        });
      }

      return reservationIds;
    });
  }

  /**
   * Release a single reservation: flip ACTIVE→RELEASED and decrement `reserved`
   * as ONE coupled CAS pair inside ONE tx, so a cron + delayed-job double-fire
   * cannot double-decrement (Section 5.2). Idempotent: a second run finds the
   * status already flipped and is a no-op.
   *
   * @param expired when true the terminal status is EXPIRED (cron sweep) rather
   *                than RELEASED (explicit cancel).
   * @returns true if this call performed the release, false if it was already terminal.
   */
  async releaseReservation(
    db: Db,
    reservationId: string,
    opts: { expired?: boolean; actor?: StockActor } = {},
  ): Promise<boolean> {
    const actor = opts.actor ?? SYSTEM_ACTOR;
    const terminal: ReservationStatus = opts.expired ? 'EXPIRED' : 'RELEASED';

    return this.withTx(db, async (tx) => {
      const reservation = await tx.stockReservation.findUnique({
        where: { id: reservationId },
      });
      if (!reservation)
        throw new NotFoundException(`Reservation ${reservationId} not found`);
      if (reservation.status !== 'ACTIVE') {
        // Already terminal (CONSUMED / RELEASED / EXPIRED) — no-op, no double-decrement.
        return false;
      }

      await this.acquireLocks(tx, [
        {
          skuId: reservation.skuId,
          warehouseId: reservation.warehouseId,
          qty: reservation.quantity,
        },
      ]);

      // Section 5.2 — "ONE coupled CAS pair". The level decrement is performed and
      // asserted BEFORE the reservation status flip so that any StockLevel CAS
      // failure rolls the whole tx back cleanly WITHOUT ever having touched the
      // reservation row. This eliminates the window where the reservation looked
      // TERMINAL to a concurrent reader while `reserved` had not yet been
      // decremented. Order: find level → (lock already held) → CAS decrement level
      // → flip reservation, all in one tx.
      const level = await tx.stockLevel.findUnique({
        where: {
          skuId_warehouseId: {
            skuId: reservation.skuId,
            warehouseId: reservation.warehouseId,
          },
        },
      });
      if (!level) {
        throw new ConflictException(
          `Stock record missing for SKU ${reservation.skuId} during release`,
        );
      }

      const dec = await tx.stockLevel.updateMany({
        where: {
          id: level.id,
          version: level.version,
          reserved: { gte: reservation.quantity },
        },
        data: {
          reserved: { decrement: reservation.quantity },
          version: { increment: 1 },
        },
      });
      if (dec.count !== 1) {
        throw new ConflictException(
          `Failed to decrement reserved for SKU ${reservation.skuId} during release (invariant guard)`,
        );
      }

      // Only after the counter is safely decremented do we flip the status. The
      // flip is still guarded by status='ACTIVE' so only the first of two
      // concurrent runs reaches this point (the loser's earlier ACTIVE read +
      // this CAS makes the 2nd run a no-op via rollback of its own decrement).
      const flipped = await tx.stockReservation.updateMany({
        where: { id: reservationId, status: 'ACTIVE' },
        data: { status: terminal },
      });
      if (flipped.count !== 1) {
        // Another worker won the race between our read and write — roll back the
        // decrement we just applied so `reserved` is not double-decremented.
        throw new ConflictException(
          `Reservation ${reservationId} was concurrently finalized during release`,
        );
      }

      await this.writeMovement(tx, {
        skuId: reservation.skuId,
        warehouseId: reservation.warehouseId,
        type: StockMovementType.RELEASE,
        reason: StockMovementReason.RELEASE,
        quantity: 0,
        reservedDelta: -reservation.quantity,
        balanceAfter: level.onHand,
        referenceType: reservation.orderId ? 'ORDER' : 'CART',
        referenceId: reservation.orderId ?? reservation.cartId ?? null,
        actor,
        note: opts.expired
          ? 'Reservation expired (TTL)'
          : 'Reservation released',
      });

      return true;
    });
  }

  /**
   * Commit (fulfil) a single reservation on payment capture: flip ACTIVE→CONSUMED
   * AND decrement BOTH `onHand` and `reserved` as ONE coupled CAS pair, so a
   * webhook + retry double-fire cannot double-decrement (Section 5.2). Emits an
   * OUT/SALE movement. Idempotent: a non-ACTIVE reservation is a no-op.
   *
   * @returns true if this call performed the commit, false if already terminal.
   */
  async commitReservation(
    db: Db,
    reservationId: string,
    opts: { actor?: StockActor } = {},
  ): Promise<boolean> {
    const actor = opts.actor ?? SYSTEM_ACTOR;

    return this.withTx(db, async (tx) => {
      const reservation = await tx.stockReservation.findUnique({
        where: { id: reservationId },
      });
      if (!reservation)
        throw new NotFoundException(`Reservation ${reservationId} not found`);
      if (reservation.status !== 'ACTIVE') return false;

      await this.acquireLocks(tx, [
        {
          skuId: reservation.skuId,
          warehouseId: reservation.warehouseId,
          qty: reservation.quantity,
        },
      ]);

      const flipped = await tx.stockReservation.updateMany({
        where: { id: reservationId, status: 'ACTIVE' },
        data: { status: 'CONSUMED' },
      });
      if (flipped.count !== 1) return false;

      const level = await tx.stockLevel.findUnique({
        where: {
          skuId_warehouseId: {
            skuId: reservation.skuId,
            warehouseId: reservation.warehouseId,
          },
        },
      });
      if (!level) {
        throw new ConflictException(
          `Stock record missing for SKU ${reservation.skuId} during commit`,
        );
      }

      // Commit decrements onHand AND reserved together, guarded so neither goes < 0.
      const dec = await tx.stockLevel.updateMany({
        where: {
          id: level.id,
          version: level.version,
          onHand: { gte: reservation.quantity },
          reserved: { gte: reservation.quantity },
        },
        data: {
          onHand: { decrement: reservation.quantity },
          reserved: { decrement: reservation.quantity },
          version: { increment: 1 },
        },
      });
      if (dec.count !== 1) {
        throw new ConflictException(
          `Failed to commit stock for SKU ${reservation.skuId} (onHand/reserved invariant guard)`,
        );
      }

      const newOnHand = level.onHand - reservation.quantity;
      await this.writeMovement(tx, {
        skuId: reservation.skuId,
        warehouseId: reservation.warehouseId,
        type: StockMovementType.OUT,
        reason: StockMovementReason.SALE,
        quantity: -reservation.quantity,
        reservedDelta: -reservation.quantity,
        balanceAfter: newOnHand,
        referenceType: 'ORDER',
        referenceId: reservation.orderId ?? null,
        actor,
        note: 'Reservation consumed (sale)',
      });

      // Best-effort low-stock signal for the reorder/alerts pipeline.
      this.maybeFlagLowStock(
        reservation.skuId,
        reservation.warehouseId,
        newOnHand,
        level.reorderPoint,
      );
      return true;
    });
  }

  /**
   * Add stock (procurement receive / return restock). CAS-bumps onHand under the
   * (sku, warehouse) advisory lock and writes an IN movement. EXPORTED for the
   * procurement and returns modules.
   */
  async restock(
    db: Db,
    line: StockLine,
    opts: {
      reason?: StockMovementReason;
      referenceType?: string;
      referenceId?: string | null;
      actor?: StockActor;
      note?: string;
    } = {},
  ): Promise<void> {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new BadRequestException(
        'restock quantity must be a positive integer',
      );
    }
    const actor = opts.actor ?? SYSTEM_ACTOR;

    await this.withTx(db, async (tx) => {
      await this.acquireLocks(tx, [line]);
      const level = await this.lockedLevelOrThrow(
        tx,
        line.skuId,
        line.warehouseId,
      );

      const bumped = await tx.stockLevel.updateMany({
        where: { id: level.id, version: level.version },
        data: { onHand: { increment: line.qty }, version: { increment: 1 } },
      });
      if (bumped.count !== 1) {
        throw new ConflictException(
          `Concurrent update prevented restock of SKU ${line.skuId}`,
        );
      }

      await this.writeMovement(tx, {
        skuId: line.skuId,
        warehouseId: line.warehouseId,
        type:
          opts.reason === StockMovementReason.RETURN
            ? StockMovementType.RETURN
            : StockMovementType.IN,
        reason: opts.reason ?? StockMovementReason.PURCHASE,
        quantity: line.qty,
        reservedDelta: 0,
        balanceAfter: level.onHand + line.qty,
        referenceType: opts.referenceType ?? null,
        referenceId: opts.referenceId ?? null,
        actor,
        note: opts.note,
      });
    });
  }

  /**
   * Pick the single active warehouse (with a NON-NULL state_code) that can fulfil
   * ALL lines from available stock — single-warehouse-per-order (Section 8.4).
   * Ordered by Warehouse.priority DESC then most-available. Warehouses with a
   * NULL state_code are SKIPPED (M2a guard: GST place-of-supply is required to
   * compute CGST/SGST vs IGST and the seller GSTIN). Throws 409
   * NO_FULFILLABLE_WAREHOUSE if none qualifies.
   *
   * NOTE: this is an UNLOCKED availability read used only to FIX the (sku,
   * warehouse) set before checkout takes the globally-ordered locks. The
   * authoritative re-check happens under those locks in reserveMany.
   *
   * The parameter is intentionally `{ skuId; qty }[]` (NOT `StockLine[]`): this
   * method DECIDES the warehouse, so any `warehouseId` a caller might carry is
   * irrelevant and would be silently ignored. Keying the type on (skuId, qty)
   * only makes that contract honest — callers cannot pass a pre-allocated line
   * expecting allocation to be skipped.
   */
  async allocateWarehouse(
    lines: { skuId: string; qty: number }[],
  ): Promise<string> {
    if (!lines || lines.length === 0) {
      throw new BadRequestException(
        'allocateWarehouse requires at least one line',
      );
    }
    // Coalesce per-sku demand (warehouse not yet decided, so key on sku only).
    const demand = new Map<string, number>();
    for (const l of lines) {
      if (!Number.isInteger(l.qty) || l.qty <= 0) {
        throw new BadRequestException(`Invalid quantity for SKU ${l.skuId}`);
      }
      demand.set(l.skuId, (demand.get(l.skuId) ?? 0) + l.qty);
    }
    const skuIds = Array.from(demand.keys());

    // Candidate warehouses: active AND state_code present (M2a). Highest priority first.
    const warehouses = await this.prisma.warehouse.findMany({
      where: { isActive: true, stateCode: { not: null } },
      orderBy: [{ priority: 'desc' }, { code: 'asc' }],
      select: { id: true },
    });
    if (warehouses.length === 0) {
      throw new ConflictException(
        'NO_FULFILLABLE_WAREHOUSE: no active warehouse with a configured state code is available',
      );
    }

    const levels = await this.prisma.stockLevel.findMany({
      where: {
        skuId: { in: skuIds },
        warehouseId: { in: warehouses.map((w) => w.id) },
      },
      select: { skuId: true, warehouseId: true, onHand: true, reserved: true },
    });

    // available[warehouseId][skuId]
    const avail = new Map<string, Map<string, number>>();
    for (const lvl of levels) {
      let perWh = avail.get(lvl.warehouseId);
      if (!perWh) {
        perWh = new Map();
        avail.set(lvl.warehouseId, perWh);
      }
      perWh.set(lvl.skuId, Math.max(0, lvl.onHand - lvl.reserved));
    }

    // The warehouse list is already ordered priority-DESC then code-ASC, so the
    // FIRST warehouse that can fulfil every line is the correct single-warehouse
    // pick (priority dominates; ties broken deterministically by code).
    let chosen: string | null = null;
    for (const wh of warehouses) {
      const perWh = avail.get(wh.id);
      if (!perWh) continue; // warehouse stocks none of the demanded SKUs
      let fulfillsAll = true;
      for (const [skuId, need] of demand) {
        if ((perWh.get(skuId) ?? 0) < need) {
          fulfillsAll = false;
          break;
        }
      }
      if (fulfillsAll) {
        chosen = wh.id;
        break;
      }
    }

    if (!chosen) {
      throw new ConflictException(
        'NO_FULFILLABLE_WAREHOUSE: no single warehouse can fulfil every line of this order. ' +
          'Some items can’t ship together right now — please order them separately or reduce quantities.',
      );
    }
    return chosen;
  }

  // ─────────────────────────────────────────────────────────────
  //  ADMIN: Warehouse CRUD (deactivate, never hard-delete)
  // ─────────────────────────────────────────────────────────────

  async createWarehouse(dto: CreateWarehouseDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Uniqueness check INSIDE the tx; the unique constraint is the real
        // serializer (two concurrent creates both passing a pre-tx check would
        // otherwise produce an unhandled P2002 → 500). Caught below as 409.
        const existing = await tx.warehouse.findUnique({
          where: { code: dto.code },
        });
        if (existing)
          throw new ConflictException(
            `Warehouse code "${dto.code}" already exists`,
          );

        // Only one default warehouse at a time.
        if (dto.isDefault) {
          await tx.warehouse.updateMany({
            where: { isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.warehouse.create({
          data: {
            code: dto.code,
            name: dto.name,
            addressLine1: dto.addressLine1,
            addressLine2: dto.addressLine2,
            city: dto.city,
            stateCode: dto.stateCode,
            postalCode: dto.postalCode,
            country: dto.country ?? 'IN',
            gstin: dto.gstin,
            priority: dto.priority ?? 0,
            isDefault: dto.isDefault ?? false,
          },
        });
      });
    } catch (err) {
      throw this.mapWarehouseCodeConflict(err, dto.code);
    }
  }

  async listWarehouses(includeInactive = true) {
    return this.prisma.warehouse.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ priority: 'desc' }, { code: 'asc' }],
    });
  }

  async getWarehouse(id: string) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    return warehouse;
  }

  async updateWarehouse(id: string, dto: UpdateWarehouseDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const warehouse = await tx.warehouse.findUnique({ where: { id } });
        if (!warehouse) throw new NotFoundException('Warehouse not found');

        // Uniqueness check INSIDE the tx (the unique constraint backstops it; a
        // concurrent rename to the same code surfaces as P2002 → 409, never 500).
        if (dto.code && dto.code !== warehouse.code) {
          const clash = await tx.warehouse.findUnique({
            where: { code: dto.code },
          });
          if (clash)
            throw new ConflictException(
              `Warehouse code "${dto.code}" already exists`,
            );
        }

        if (dto.isDefault === true) {
          await tx.warehouse.updateMany({
            where: { isDefault: true, id: { not: id } },
            data: { isDefault: false },
          });
        }
        return tx.warehouse.update({
          where: { id },
          data: {
            ...(dto.code !== undefined && { code: dto.code }),
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.addressLine1 !== undefined && {
              addressLine1: dto.addressLine1,
            }),
            ...(dto.addressLine2 !== undefined && {
              addressLine2: dto.addressLine2,
            }),
            ...(dto.city !== undefined && { city: dto.city }),
            ...(dto.stateCode !== undefined && { stateCode: dto.stateCode }),
            ...(dto.postalCode !== undefined && { postalCode: dto.postalCode }),
            ...(dto.country !== undefined && { country: dto.country }),
            ...(dto.gstin !== undefined && { gstin: dto.gstin }),
            ...(dto.priority !== undefined && { priority: dto.priority }),
            ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
            ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          },
        });
      });
    } catch (err) {
      throw this.mapWarehouseCodeConflict(err, dto.code ?? '');
    }
  }

  /**
   * Map a Prisma P2002 (unique-constraint) violation on `warehouse.code` to a
   * 409 ConflictException with a clear message; re-throw everything else
   * unchanged (NotFound/Conflict from the tx body pass straight through).
   */
  private mapWarehouseCodeConflict(err: unknown, code: string): unknown {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictException(`Warehouse code "${code}" already exists`);
    }
    return err;
  }

  /**
   * Deactivate a warehouse (isActive=false). NEVER a hard delete — StockLevel and
   * StockMovement FKs are RESTRICT and the audit trail must survive. A deactivated
   * warehouse is skipped by allocateWarehouse.
   */
  async deactivateWarehouse(id: string) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    if (!warehouse.isActive) return warehouse;
    return this.prisma.warehouse.update({
      where: { id },
      data: { isActive: false, isDefault: false },
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  ADMIN: Stock views
  // ─────────────────────────────────────────────────────────────

  /** Stock matrix with available = onHand - reserved computed per row. */
  async getStockMatrix(query: InventoryMatrixQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const skip = (page - 1) * limit;

    const where: Prisma.StockLevelWhereInput = {};
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.skuId) where.skuId = query.skuId;
    if (query.search) {
      where.sku = {
        OR: [
          { skuCode: { contains: query.search, mode: 'insensitive' } },
          { name: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    // The `belowReorder` filter is a column-to-column comparison
    // (`onHand - reserved <= reorderPoint`) that Prisma's typed `where` cannot
    // express. Pushing it into SQL keeps pagination correct: the page-of-ids and
    // the total are both computed under the SAME predicate, so `limit`/`total`/
    // `totalPages` stay consistent (the previous Node-side post-filter broke the
    // pagination contract — short/empty pages and a meaningless total).
    if (query.belowReorder) {
      return this.getBelowReorderMatrixPage(
        {
          warehouseId: query.warehouseId,
          skuId: query.skuId,
          search: query.search,
        },
        page,
        limit,
        skip,
      );
    }

    const [rows, total] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where,
        include: {
          sku: {
            select: { id: true, skuCode: true, name: true, isActive: true },
          },
          warehouse: {
            select: { id: true, code: true, name: true, isActive: true },
          },
        },
        orderBy: [{ skuId: 'asc' }, { warehouseId: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.stockLevel.count({ where }),
    ]);

    const data = rows.map((r) => this.decorateLevel(r));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Below-reorder page of the stock matrix. The `onHand - reserved <= reorderPoint`
   * predicate is a column-to-column comparison Prisma can't express in `where`, so
   * we resolve the matching ids + total via `$queryRaw` (filter pushed fully into
   * SQL), then hydrate the page with the normal typed include. This keeps the
   * pagination contract intact (page size and total agree on the same predicate).
   */
  private async getBelowReorderMatrixPage(
    filter: { warehouseId?: string; skuId?: string; search?: string },
    page: number,
    limit: number,
    skip: number,
  ) {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`(sl.on_hand - sl.reserved) <= sl.reorder_point`,
    ];
    if (filter.warehouseId) {
      conditions.push(
        Prisma.sql`sl.warehouse_id = ${filter.warehouseId}::uuid`,
      );
    }
    if (filter.skuId) {
      conditions.push(Prisma.sql`sl.sku_id = ${filter.skuId}::uuid`);
    }
    // Mirror the typed query's case-insensitive search over sku code / name.
    let joinClause = Prisma.sql``;
    if (filter.search) {
      const like = `%${filter.search}%`;
      joinClause = Prisma.sql`JOIN skus s ON s.id = sl.sku_id`;
      conditions.push(
        Prisma.sql`(s.sku_code ILIKE ${like} OR s.name ILIKE ${like})`,
      );
    }
    const whereSql = Prisma.join(conditions, ' AND ');

    const idRows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT sl.id
      FROM stock_levels sl
      ${joinClause}
      WHERE ${whereSql}
      ORDER BY sl.sku_id ASC, sl.warehouse_id ASC
      LIMIT ${limit} OFFSET ${skip}
    `);
    const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM stock_levels sl
        ${joinClause}
        WHERE ${whereSql}
      `,
    );
    const total = Number(countRows[0]?.count ?? 0n);

    const ids = idRows.map((r) => r.id);
    const rows = ids.length
      ? await this.prisma.stockLevel.findMany({
          where: { id: { in: ids } },
          include: {
            sku: {
              select: { id: true, skuCode: true, name: true, isActive: true },
            },
            warehouse: {
              select: { id: true, code: true, name: true, isActive: true },
            },
          },
        })
      : [];
    // Preserve the SQL ordering (findMany on `id IN` does not guarantee order).
    const byId = new Map(rows.map((r) => [r.id, r]));
    const data = ids
      .map((id) => byId.get(id))
      .filter((r): r is (typeof rows)[number] => r !== undefined)
      .map((r) => this.decorateLevel(r));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Per-SKU stock across warehouses + recent movements. */
  async getSkuInventory(skuId: string, movementLimit = 50) {
    const sku = await this.prisma.sku.findUnique({
      where: { id: skuId },
      select: {
        id: true,
        skuCode: true,
        name: true,
        isActive: true,
        reorderPoint: true,
      },
    });
    if (!sku) throw new NotFoundException('SKU not found');

    const [levels, movements] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where: { skuId },
        include: {
          warehouse: {
            select: { id: true, code: true, name: true, isActive: true },
          },
        },
        orderBy: { warehouseId: 'asc' },
      }),
      this.prisma.stockMovement.findMany({
        where: { skuId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(movementLimit, MAX_PAGE_LIMIT),
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
        },
      }),
    ]);

    const decorated = levels.map((l) => this.decorateLevel(l));
    const totals = decorated.reduce(
      (acc, l) => {
        acc.onHand += l.onHand;
        acc.reserved += l.reserved;
        acc.available += l.available;
        return acc;
      },
      { onHand: 0, reserved: 0, available: 0 },
    );

    return { sku, totals, levels: decorated, movements };
  }

  /** Append-only StockMovement ledger with filters + pagination. */
  async listMovements(query: MovementQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const skip = (page - 1) * limit;

    const where: Prisma.StockMovementWhereInput = {};
    if (query.skuId) where.skuId = query.skuId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.type) where.type = query.type;
    if (query.reason) where.reason = query.reason;
    if (query.referenceType) where.referenceType = query.referenceType;
    if (query.referenceId) where.referenceId = query.referenceId;

    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          sku: { select: { id: true, skuCode: true, name: true } },
          warehouse: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return {
      data: rows,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Reorder report: stock levels where available <= reorderPoint. The reorderPoint
   * is read off the StockLevel row (per-warehouse threshold); 0 thresholds with 0
   * suggested qty are excluded as noise.
   */
  async getReorderReport(warehouseId?: string) {
    // The reorder predicate (`onHand - reserved <= reorderPoint` AND a non-zero
    // threshold/qty) is pushed FULLY into SQL — never iterated in Node over the
    // whole table (Section 8.8 forbids Node-side table iteration; at 10k+ rows the
    // old load-everything-then-filter approach could OOM). A hard `LIMIT` caps the
    // worst case even when many SKUs are simultaneously below threshold.
    const conditions: Prisma.Sql[] = [
      Prisma.sql`(sl.on_hand - sl.reserved) <= sl.reorder_point`,
      Prisma.sql`(sl.reorder_point > 0 OR sl.reorder_qty > 0)`,
    ];
    if (warehouseId) {
      conditions.push(Prisma.sql`sl.warehouse_id = ${warehouseId}::uuid`);
    }
    const whereSql = Prisma.join(conditions, ' AND ');

    const idRows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT sl.id
      FROM stock_levels sl
      WHERE ${whereSql}
      ORDER BY sl.sku_id ASC, sl.warehouse_id ASC
      LIMIT ${REORDER_REPORT_LIMIT}
    `);
    const ids = idRows.map((r) => r.id);
    if (ids.length === 0) return { data: [], count: 0 };

    const levels = await this.prisma.stockLevel.findMany({
      where: { id: { in: ids } },
      include: {
        sku: {
          select: { id: true, skuCode: true, name: true, isActive: true },
        },
        warehouse: {
          select: { id: true, code: true, name: true, isActive: true },
        },
      },
    });
    // Preserve the SQL ordering (`id IN` does not guarantee order).
    const byId = new Map(levels.map((l) => [l.id, l]));
    const data = ids
      .map((id) => byId.get(id))
      .filter((l): l is (typeof levels)[number] => l !== undefined)
      .map((l) => this.decorateLevel(l))
      .map((l) => ({
        ...l,
        shortfall: Math.max(0, l.reorderPoint - l.available),
        suggestedOrderQty: l.reorderQty,
      }));

    return { data, count: data.length };
  }

  // ─────────────────────────────────────────────────────────────
  //  ADMIN: Manual adjust + inter-warehouse transfer
  // ─────────────────────────────────────────────────────────────

  /**
   * Manual single-(sku, warehouse) onHand adjustment by a signed delta, under the
   * stock-level advisory lock with a CAS bump and a non-negative invariant assert.
   * Writes an ADJUST movement. Actor is the JWT subject (pinned by the controller).
   */
  async adjust(dto: StockAdjustDto, actor: StockActor) {
    if (!Number.isInteger(dto.quantityDelta) || dto.quantityDelta === 0) {
      throw new BadRequestException('quantityDelta must be a non-zero integer');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.acquireLocks(tx, [
        { skuId: dto.skuId, warehouseId: dto.warehouseId, qty: 1 },
      ]);
      const level = await this.lockedLevelOrThrow(
        tx,
        dto.skuId,
        dto.warehouseId,
      );

      const newOnHand = level.onHand + dto.quantityDelta;
      // Invariant: onHand never negative, and never below what is already reserved
      // (would imply overselling already-committed holds).
      if (newOnHand < 0) {
        throw new BadRequestException(
          `Adjustment would make onHand negative (${level.onHand} + ${dto.quantityDelta})`,
        );
      }
      if (newOnHand < level.reserved) {
        throw new ConflictException(
          `Adjustment would drop onHand (${newOnHand}) below reserved (${level.reserved}) for SKU ${dto.skuId}`,
        );
      }

      const updated = await tx.stockLevel.updateMany({
        where: { id: level.id, version: level.version },
        data: { onHand: newOnHand, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          `Concurrent update prevented adjustment of SKU ${dto.skuId}`,
        );
      }

      await this.writeMovement(tx, {
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        type: StockMovementType.ADJUST,
        reason: dto.reason ?? StockMovementReason.MANUAL_ADJUST,
        quantity: dto.quantityDelta,
        reservedDelta: 0,
        balanceAfter: newOnHand,
        referenceType: 'ADJUSTMENT',
        referenceId: null,
        actor,
        note: dto.note,
      });

      this.maybeFlagLowStock(
        dto.skuId,
        dto.warehouseId,
        newOnHand,
        level.reorderPoint,
      );
      return {
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        onHand: newOnHand,
        reserved: level.reserved,
      };
    });
  }

  /**
   * Inter-warehouse transfer of a SKU. Acquires BOTH (sku, fromWh) and (sku, toWh)
   * stock-level advisory locks in the GLOBAL order (Section 5.1) before mutating,
   * so a concurrent reverse transfer cannot deadlock. Decrements source onHand
   * (guarded available >= qty) and increments destination onHand, writing a paired
   * TRANSFER OUT / TRANSFER IN movement.
   */
  async transfer(dto: StockTransferDto, actor: StockActor) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException(
        'Source and destination warehouses must differ',
      );
    }
    if (!Number.isInteger(dto.quantity) || dto.quantity <= 0) {
      throw new BadRequestException(
        'Transfer quantity must be a positive integer',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // BOTH endpoints locked in global order before any mutation.
      await this.acquireLocks(tx, [
        {
          skuId: dto.skuId,
          warehouseId: dto.fromWarehouseId,
          qty: dto.quantity,
        },
        { skuId: dto.skuId, warehouseId: dto.toWarehouseId, qty: dto.quantity },
      ]);

      const fromLevel = await this.lockedLevelOrThrow(
        tx,
        dto.skuId,
        dto.fromWarehouseId,
      );
      const toLevel = await this.lockedLevelOrThrow(
        tx,
        dto.skuId,
        dto.toWarehouseId,
      );

      const fromAvailable = fromLevel.onHand - fromLevel.reserved;
      if (fromAvailable < dto.quantity) {
        throw new ConflictException(
          `INSUFFICIENT_STOCK: source warehouse has ${fromAvailable} available, need ${dto.quantity}`,
        );
      }

      const decremented = await tx.stockLevel.updateMany({
        where: {
          id: fromLevel.id,
          version: fromLevel.version,
          onHand: { gte: fromLevel.reserved + dto.quantity },
        },
        data: {
          onHand: { decrement: dto.quantity },
          version: { increment: 1 },
        },
      });
      if (decremented.count !== 1) {
        throw new ConflictException(
          `Concurrent update prevented transfer out of SKU ${dto.skuId}`,
        );
      }

      const incremented = await tx.stockLevel.updateMany({
        where: { id: toLevel.id, version: toLevel.version },
        data: {
          onHand: { increment: dto.quantity },
          version: { increment: 1 },
        },
      });
      if (incremented.count !== 1) {
        throw new ConflictException(
          `Concurrent update prevented transfer in of SKU ${dto.skuId}`,
        );
      }

      const fromOnHand = fromLevel.onHand - dto.quantity;
      const toOnHand = toLevel.onHand + dto.quantity;

      await this.writeMovement(tx, {
        skuId: dto.skuId,
        warehouseId: dto.fromWarehouseId,
        type: StockMovementType.TRANSFER,
        reason: StockMovementReason.TRANSFER,
        quantity: -dto.quantity,
        reservedDelta: 0,
        balanceAfter: fromOnHand,
        referenceType: 'TRANSFER',
        referenceId: dto.toWarehouseId,
        actor,
        note: dto.note ?? `Transfer to warehouse ${dto.toWarehouseId}`,
      });
      await this.writeMovement(tx, {
        skuId: dto.skuId,
        warehouseId: dto.toWarehouseId,
        type: StockMovementType.TRANSFER,
        reason: StockMovementReason.TRANSFER,
        quantity: dto.quantity,
        reservedDelta: 0,
        balanceAfter: toOnHand,
        referenceType: 'TRANSFER',
        referenceId: dto.fromWarehouseId,
        actor,
        note: dto.note ?? `Transfer from warehouse ${dto.fromWarehouseId}`,
      });

      this.maybeFlagLowStock(
        dto.skuId,
        dto.fromWarehouseId,
        fromOnHand,
        fromLevel.reorderPoint,
      );
      return {
        skuId: dto.skuId,
        from: { warehouseId: dto.fromWarehouseId, onHand: fromOnHand },
        to: { warehouseId: dto.toWarehouseId, onHand: toOnHand },
        quantity: dto.quantity,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  Internal helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Resolve the actor for a request-initiated mutation. `reserveMany` is always
   * triggered by a real principal (customer JWT at checkout, admin JWT in
   * procurement), so a missing/blank actor is a programming error, not a SYSTEM
   * path — refuse it rather than poisoning the audit trail with triggeredBy=SYSTEM
   * (CLAUDE.md security constraint / 4ebf502). The automated cron/webhook paths
   * (release/commit/restock) intentionally still allow SYSTEM_ACTOR.
   */
  private requireActor(actor?: StockActor): StockActor {
    if (!actor || !actor.id || actor.id.trim().length === 0) {
      throw new InternalServerErrorException(
        'Actor required for stock reservation — identity must be sourced from the JWT',
      );
    }
    return actor;
  }

  /** Read a StockLevel that is expected to exist under an already-acquired lock. */
  private async lockedLevelOrThrow(
    tx: Prisma.TransactionClient,
    skuId: string,
    warehouseId: string,
  ) {
    const level = await tx.stockLevel.findUnique({
      where: { skuId_warehouseId: { skuId, warehouseId } },
    });
    if (!level) {
      throw new NotFoundException(
        `No stock record for SKU ${skuId} at warehouse ${warehouseId} — create the SKU/warehouse stock row first`,
      );
    }
    return level;
  }

  /** Append-only audit write. `triggeredBy`/`actorRole` come from the trusted actor (JWT), never the body. */
  private async writeMovement(
    tx: Prisma.TransactionClient,
    m: {
      skuId: string;
      warehouseId: string;
      type: StockMovementType;
      reason: StockMovementReason;
      quantity: number;
      reservedDelta: number;
      balanceAfter: number | null;
      referenceType: string | null;
      referenceId: string | null;
      actor: StockActor;
      note?: string;
    },
  ): Promise<void> {
    await tx.stockMovement.create({
      data: {
        skuId: m.skuId,
        warehouseId: m.warehouseId,
        type: m.type,
        reason: m.reason,
        quantity: m.quantity,
        reservedDelta: m.reservedDelta,
        balanceAfter: m.balanceAfter,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        triggeredBy: m.actor.id || 'SYSTEM',
        actorRole: m.actor.role ?? null,
        note: m.note ?? null,
      },
    });
  }

  /** Attach the derived available = onHand - reserved field to a StockLevel row. */
  private decorateLevel<T extends { onHand: number; reserved: number }>(
    level: T,
  ) {
    return { ...level, available: level.onHand - level.reserved };
  }

  /**
   * Best-effort low-stock log hook. Realtime emission + admin notifications are
   * owned by the store-jobs/store-realtime modules (built in parallel) which
   * consume the reorder report; this only records the signal so it is never lost.
   */
  private maybeFlagLowStock(
    skuId: string,
    warehouseId: string,
    onHand: number,
    reorderPoint: number,
  ): void {
    if (reorderPoint > 0 && onHand <= reorderPoint) {
      this.logger.warn(
        `Low stock: SKU ${skuId} at warehouse ${warehouseId} onHand=${onHand} <= reorderPoint=${reorderPoint}`,
      );
    }
  }
}
