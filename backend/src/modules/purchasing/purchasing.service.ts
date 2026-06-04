import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseOrderStatus, SupplierStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService, StockActor } from '../inventory/inventory.service';
import {
  CreatePurchaseOrderDto,
  CreateSupplierDto,
  ListPurchaseOrdersQueryDto,
  ListSuppliersQueryDto,
  PO_LIST_MAX_LIMIT,
  ReceivePoLinesDto,
  SUPPLIER_LIST_MAX_LIMIT,
  UpdateSupplierDto,
} from './dto';

/** NumberSequence scope for purchase-order human references. */
const PO_SEQUENCE_SCOPE = 'PO';
const PO_DEFAULT_PREFIX = 'PO';
/** Zero-padding width of the numeric part of a PO number ({prefix}-{year}-{000001}). */
const PO_NUMBER_PAD = 6;
/** Default admin list page size when the caller omits `limit`. */
const DEFAULT_LIST_LIMIT = 50;

const PO_LINE_INCLUDE = {
  lines: {
    orderBy: [{ skuId: 'asc' }, { lotNo: 'asc' }] as const,
    include: {
      sku: { select: { id: true, skuCode: true, name: true } },
    },
  },
  supplier: { select: { id: true, name: true, code: true, status: true } },
  warehouse: { select: { id: true, code: true, name: true, isActive: true } },
} satisfies Prisma.PurchaseOrderInclude;

@Injectable()
export class PurchasingService {
  private readonly logger = new Logger(PurchasingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  //  SUPPLIERS (CRUD — deactivate, never hard-delete)
  // ─────────────────────────────────────────────────────────────

  async createSupplier(dto: CreateSupplierDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.code) {
          const clash = await tx.supplier.findUnique({
            where: { code: dto.code },
          });
          if (clash) {
            throw new ConflictException(
              `Supplier code "${dto.code}" already exists`,
            );
          }
        }
        return tx.supplier.create({
          data: {
            name: dto.name,
            code: dto.code ?? null,
            contactName: dto.contactName ?? null,
            email: dto.email ?? null,
            phone: dto.phone ?? null,
            gstin: dto.gstin ?? null,
            addressLine1: dto.addressLine1 ?? null,
            city: dto.city ?? null,
            stateCode: dto.stateCode ?? null,
            leadTimeDays: dto.leadTimeDays ?? null,
            notes: dto.notes ?? null,
          },
        });
      });
    } catch (err) {
      throw this.mapSupplierCodeConflict(err, dto.code ?? '');
    }
  }

  async listSuppliers(query: ListSuppliersQueryDto) {
    const where: Prisma.SupplierWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { gstin: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(
      query.limit ?? DEFAULT_LIST_LIMIT,
      SUPPLIER_LIST_MAX_LIMIT,
    );
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getSupplier(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.findUnique({ where: { id } });
        if (!supplier) throw new NotFoundException('Supplier not found');

        if (dto.code && dto.code !== supplier.code) {
          const clash = await tx.supplier.findUnique({
            where: { code: dto.code },
          });
          if (clash) {
            throw new ConflictException(
              `Supplier code "${dto.code}" already exists`,
            );
          }
        }

        return tx.supplier.update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.code !== undefined && { code: dto.code }),
            ...(dto.contactName !== undefined && {
              contactName: dto.contactName,
            }),
            ...(dto.email !== undefined && { email: dto.email }),
            ...(dto.phone !== undefined && { phone: dto.phone }),
            ...(dto.gstin !== undefined && { gstin: dto.gstin }),
            ...(dto.addressLine1 !== undefined && {
              addressLine1: dto.addressLine1,
            }),
            ...(dto.city !== undefined && { city: dto.city }),
            ...(dto.stateCode !== undefined && { stateCode: dto.stateCode }),
            ...(dto.leadTimeDays !== undefined && {
              leadTimeDays: dto.leadTimeDays,
            }),
            ...(dto.notes !== undefined && { notes: dto.notes }),
            ...(dto.status !== undefined && { status: dto.status }),
          },
        });
      });
    } catch (err) {
      throw this.mapSupplierCodeConflict(err, dto.code ?? '');
    }
  }

  /**
   * Soft-delete: flip status to INACTIVE. POs reference the supplier (RESTRICT).
   * Uses a single CAS `updateMany` (WHERE status=ACTIVE) so the deactivate is
   * idempotent and TOCTOU-free in one round-trip — a concurrent deactivation
   * makes this a no-op rather than racing a read-then-write (mirrors the CAS in
   * placePurchaseOrder / cancelPurchaseOrder).
   */
  async deactivateSupplier(id: string) {
    const flipped = await this.prisma.supplier.updateMany({
      where: { id, status: SupplierStatus.ACTIVE },
      data: { status: SupplierStatus.INACTIVE },
    });
    // Either we flipped it (count 1) or it was already INACTIVE / does not exist
    // (count 0). Disambiguate the no-op by reading the row: 404 if missing, else
    // return the (already / now) INACTIVE supplier.
    if (flipped.count === 0) {
      const supplier = await this.prisma.supplier.findUnique({ where: { id } });
      if (!supplier) throw new NotFoundException('Supplier not found');
      return supplier;
    }
    return this.getSupplier(id);
  }

  private mapSupplierCodeConflict(err: unknown, code: string): unknown {
    // Already-typed HTTP exceptions (e.g. the in-tx ConflictException / 404) pass
    // straight through — this mapper only translates a raw Prisma P2002.
    if (err instanceof HttpException) return err;
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictException(`Supplier code "${code}" already exists`);
    }
    return err;
  }

  // ─────────────────────────────────────────────────────────────
  //  PURCHASE ORDERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a DRAFT PO. Validates supplier (must be ACTIVE) + warehouse (active),
   * every line SKU exists, and that any per-line warehouseId equals the header
   * warehouse (the schema models warehouse at the header). Computes subtotal /
   * taxTotal / grandTotal in paise from the lines. PO number is allocated via the
   * advisory-locked NumberSequence.
   */
  async createPurchaseOrder(dto: CreatePurchaseOrderDto, actor: StockActor) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    if (supplier.status !== SupplierStatus.ACTIVE) {
      throw new BadRequestException(
        'Cannot raise a purchase order against an inactive supplier',
      );
    }

    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: dto.warehouseId },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    if (!warehouse.isActive) {
      throw new BadRequestException(
        'Cannot receive into an inactive warehouse',
      );
    }

    // Reject any per-line warehouse that disagrees with the header (single
    // receiving warehouse per PO — schema invariant).
    for (const line of dto.lines) {
      if (line.warehouseId && line.warehouseId !== dto.warehouseId) {
        throw new BadRequestException(
          `Line warehouse ${line.warehouseId} does not match PO warehouse ${dto.warehouseId} — a PO receives into one warehouse`,
        );
      }
    }

    // Validate all SKUs exist (and capture nothing else — costs are caller-supplied).
    const skuIds = Array.from(new Set(dto.lines.map((l) => l.skuId)));
    const skus = await this.prisma.sku.findMany({
      where: { id: { in: skuIds } },
      select: { id: true },
    });
    if (skus.length !== skuIds.length) {
      const found = new Set(skus.map((s) => s.id));
      const missing = skuIds.filter((id) => !found.has(id));
      throw new BadRequestException(`Unknown SKU(s): ${missing.join(', ')}`);
    }

    // Normalize lot numbers (default 1) and guard the (sku, lotNo) uniqueness the
    // DB enforces — surface a 400 instead of a raw P2002 on insert.
    const seen = new Set<string>();
    const lines = dto.lines.map((l) => {
      const lotNo = l.lotNo ?? 1;
      const key = `${l.skuId}:${lotNo}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          `Duplicate line for SKU ${l.skuId} lot ${lotNo} — same SKU must use distinct lot numbers`,
        );
      }
      seen.add(key);
      return {
        skuId: l.skuId,
        lotNo,
        orderedQty: l.orderedQty,
        unitCost: l.unitCostPaise,
        taxBps: l.taxBps ?? 0,
      };
    });

    const totals = this.computeTotals(lines);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Re-validate supplier + warehouse activeness INSIDE the create tx so a
        // concurrent deactivation between the pre-checks above and the insert is
        // still caught (TOCTOU close). The pre-checks above stay for early/cheap
        // rejection of unknown ids before the lock + sequence bump.
        const supplierNow = await tx.supplier.findUnique({
          where: { id: dto.supplierId },
          select: { status: true },
        });
        if (!supplierNow) throw new NotFoundException('Supplier not found');
        if (supplierNow.status !== SupplierStatus.ACTIVE) {
          throw new BadRequestException(
            'Cannot raise a purchase order against an inactive supplier',
          );
        }
        const warehouseNow = await tx.warehouse.findUnique({
          where: { id: dto.warehouseId },
          select: { isActive: true },
        });
        if (!warehouseNow) throw new NotFoundException('Warehouse not found');
        if (!warehouseNow.isActive) {
          throw new BadRequestException(
            'Cannot receive into an inactive warehouse',
          );
        }

        // Allocate the PO number inside the SAME tx so a failed create rolls the
        // sequence bump back — no gap in the PO sequence on insert failure.
        const poNumber = await this.nextPoNumber(tx);

        return tx.purchaseOrder.create({
          data: {
            poNumber,
            supplierId: dto.supplierId,
            warehouseId: dto.warehouseId,
            status: PurchaseOrderStatus.DRAFT,
            subtotal: totals.subtotal,
            taxTotal: totals.taxTotal,
            grandTotal: totals.grandTotal,
            notes: dto.notes ?? null,
            createdById: actor.id,
            lines: {
              create: lines.map((l) => ({
                skuId: l.skuId,
                lotNo: l.lotNo,
                orderedQty: l.orderedQty,
                unitCost: l.unitCost,
                taxBps: l.taxBps,
              })),
            },
          },
          include: PO_LINE_INCLUDE,
        });
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Purchase order number collision — please retry',
        );
      }
      throw err;
    }
  }

  async listPurchaseOrders(query: ListPurchaseOrdersQueryDto) {
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit ?? DEFAULT_LIST_LIMIT, PO_LIST_MAX_LIMIT);
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          supplier: { select: { id: true, name: true, code: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          _count: { select: { lines: true } },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getPurchaseOrder(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: PO_LINE_INCLUDE,
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  /**
   * Place a PO: DRAFT → SUBMITTED. CAS-guarded on status='DRAFT' so a double
   * submit (or a submit racing a cancel) cannot move a non-draft PO. Idempotent
   * in effect: a re-submit of an already-SUBMITTED PO returns the current PO
   * without error; submitting a terminal PO is a 409.
   */
  async placePurchaseOrder(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === PurchaseOrderStatus.SUBMITTED) {
      return this.getPurchaseOrder(id);
    }
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new ConflictException(
        `Cannot submit a purchase order in status ${po.status}`,
      );
    }
    const moved = await this.prisma.purchaseOrder.updateMany({
      where: { id, status: PurchaseOrderStatus.DRAFT },
      data: { status: PurchaseOrderStatus.SUBMITTED, submittedAt: new Date() },
    });
    if (moved.count !== 1) {
      throw new ConflictException(
        'Purchase order was concurrently modified — reload and retry',
      );
    }
    return this.getPurchaseOrder(id);
  }

  /**
   * Cancel a PO. Permitted only while nothing has been received (DRAFT or
   * SUBMITTED with zero receipts). A PARTIALLY_RECEIVED/RECEIVED PO is immutable
   * for cancellation — its stock movements are already committed. CAS-guarded.
   */
  async cancelPurchaseOrder(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: { select: { receivedQty: true } } },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === PurchaseOrderStatus.CANCELLED) {
      return this.getPurchaseOrder(id);
    }
    if (
      po.status !== PurchaseOrderStatus.DRAFT &&
      po.status !== PurchaseOrderStatus.SUBMITTED
    ) {
      throw new ConflictException(
        `Cannot cancel a purchase order in status ${po.status}`,
      );
    }
    const anyReceived = po.lines.some((l) => l.receivedQty > 0);
    if (anyReceived) {
      throw new ConflictException(
        'Cannot cancel a purchase order that already has received stock',
      );
    }
    const moved = await this.prisma.purchaseOrder.updateMany({
      where: {
        id,
        status: {
          in: [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.SUBMITTED],
        },
      },
      data: { status: PurchaseOrderStatus.CANCELLED },
    });
    if (moved.count !== 1) {
      throw new ConflictException(
        'Purchase order was concurrently modified — reload and retry',
      );
    }
    return this.getPurchaseOrder(id);
  }

  // ─────────────────────────────────────────────────────────────
  //  RECEIVING
  // ─────────────────────────────────────────────────────────────

  /**
   * Receive one or more PO lines in a single atomic, idempotent transaction.
   *
   * For each line, inside ONE $transaction:
   *  1. Acquire an advisory lock on the PO (`po_receive_{poId}`, the Section 5.2
   *     key) so two concurrent receipts of the same PO serialize — protects the
   *     receivedQty CAS and the PO-status recompute from interleaving.
   *  2. Re-read the line; CAS-bump `receivedQty` guarded so it NEVER exceeds
   *     `orderedQty` (the over-receive guard). A receipt that would overshoot is
   *     a 409, not a silent clamp.
   *  3. Increment StockLevel.onHand via InventoryService.receiveStock (writes the
   *     IN/PURCHASE StockMovement, creating the StockLevel row if first receipt).
   *  4. Recompute and persist PO status: RECEIVED if every line is fully received,
   *     else PARTIALLY_RECEIVED. A DRAFT PO is auto-advanced past SUBMITTED on
   *     first receipt; a CANCELLED PO rejects receipts.
   *
   * Idempotency: the receivedQty CAS is the dedupe — replaying the same physical
   * receipt is the caller's responsibility, but the over-receive guard ensures a
   * double-fire can never push onHand past orderedQty for that line.
   */
  async receivePurchaseOrder(
    poId: string,
    dto: ReceivePoLinesDto,
    actor: StockActor,
  ) {
    // Reject duplicate lineIds in one request up front (would double-count).
    const lineIds = dto.lines.map((l) => l.lineId);
    if (new Set(lineIds).size !== lineIds.length) {
      throw new BadRequestException(
        'Duplicate lineId in receive request — combine quantities per line',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // (1) serialize all receipts against this PO (Section 5.2 key).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`po_receive_${poId}`}))`;

      const po = await tx.purchaseOrder.findUnique({
        where: { id: poId },
        include: { lines: true },
      });
      if (!po) throw new NotFoundException('Purchase order not found');
      if (po.status === PurchaseOrderStatus.CANCELLED) {
        throw new ConflictException(
          'Cannot receive against a cancelled purchase order',
        );
      }
      if (po.status === PurchaseOrderStatus.DRAFT) {
        throw new BadRequestException(
          'Submit the purchase order before receiving stock',
        );
      }

      const lineById = new Map(po.lines.map((l) => [l.id, l]));

      // Resolve + validate every requested line FIRST, then sort the work into
      // ascending (skuId, warehouseId) order before touching stock. Each
      // receiveStock call below takes its own per-(sku, warehouse) advisory lock;
      // iterating in a stable global order (Section 5.1) prevents two concurrent
      // receives of the same PO with lines in opposite order from deadlocking on
      // those sub-locks. The PO warehouse is fixed at the header, so the sort key
      // is effectively skuId, but we include warehouseId for spec-exactness.
      const work = dto.lines.map((recv) => {
        const line = lineById.get(recv.lineId);
        if (!line) {
          throw new NotFoundException(
            `PO line ${recv.lineId} not found on purchase order ${poId}`,
          );
        }
        return { recv, line };
      });
      // All lines receive into po.warehouseId (single header warehouse), so the
      // (skuId, warehouseId) ordering reduces to skuId; tie-break on lotNo for a
      // fully deterministic order.
      work.sort((a, b) => {
        if (a.line.skuId !== b.line.skuId)
          return a.line.skuId < b.line.skuId ? -1 : 1;
        return a.line.lotNo - b.line.lotNo;
      });

      for (const { recv, line } of work) {
        const remaining = line.orderedQty - line.receivedQty;
        if (remaining <= 0) {
          throw new ConflictException(
            `PO line ${recv.lineId} is already fully received`,
          );
        }
        if (recv.receivedQty > remaining) {
          throw new BadRequestException(
            `Receiving ${recv.receivedQty} exceeds remaining ${remaining} for PO line ${recv.lineId}`,
          );
        }

        // (2) CAS-bump receivedQty, guarded so it never exceeds orderedQty.
        const bumped = await tx.purchaseOrderLine.updateMany({
          where: {
            id: line.id,
            receivedQty: line.receivedQty,
            orderedQty: { gte: line.receivedQty + recv.receivedQty },
          },
          data: { receivedQty: { increment: recv.receivedQty } },
        });
        if (bumped.count !== 1) {
          throw new ConflictException(
            `PO line ${recv.lineId} was concurrently received — reload and retry`,
          );
        }

        // (3) stock IN — into the PO header warehouse.
        await this.inventory.receiveStock(tx, {
          skuId: line.skuId,
          warehouseId: po.warehouseId,
          qty: recv.receivedQty,
          actor,
          reference: po.id,
        });
      }

      // (4) recompute PO status from the freshly-bumped lines.
      const refreshed = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: poId },
        select: { orderedQty: true, receivedQty: true },
      });
      const fullyReceived = refreshed.every(
        (l) => l.receivedQty >= l.orderedQty,
      );
      const nextStatus = fullyReceived
        ? PurchaseOrderStatus.RECEIVED
        : PurchaseOrderStatus.PARTIALLY_RECEIVED;

      await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          status: nextStatus,
          receivedAt: fullyReceived ? new Date() : po.receivedAt,
        },
      });
    });

    return this.getPurchaseOrder(poId);
  }

  // ─────────────────────────────────────────────────────────────
  //  AUTO-REORDER → DRAFT PO  (best-effort helper)
  // ─────────────────────────────────────────────────────────────

  /**
   * Build DRAFT PO(s) from the inventory reorder report, grouped by the supplier
   * most-recently used for each SKU (best-effort — the schema has no SKU→supplier
   * FK, so we infer it from the latest non-cancelled PO line for that SKU). SKUs
   * with no purchase history are skipped (no supplier to address). One DRAFT PO is
   * created per (supplier, warehouse) bucket.
   *
   * Returns a summary of created drafts. Idempotency: the store-reorder-alerts
   * cron (Section 7) owns the "skip SKUs already on an open PO" gate and passes
   * the already-covered SKU ids in `opts.excludeSkuIds`; this helper honours that
   * exclusion so a second daily run (or two replicas firing together) does not
   * draft duplicate POs for the same under-stocked SKU. Callers that want the raw
   * builder with no dedup may omit `excludeSkuIds`.
   */
  async reorderToDraftPo(
    actor: StockActor,
    warehouseId?: string,
    opts?: { excludeSkuIds?: Iterable<string> },
  ) {
    const report = await this.inventory.getReorderReport(warehouseId);
    const exclude = new Set(opts?.excludeSkuIds ?? []);
    const rows = report.data.filter(
      (r) => (r.suggestedOrderQty ?? 0) > 0 && !exclude.has(r.skuId),
    );
    if (rows.length === 0) {
      return {
        created: [],
        skipped: [],
        message: 'Nothing below reorder point',
      };
    }

    // Resolve a supplier + last-known unit cost per SKU from purchase history.
    const skuIds = Array.from(new Set(rows.map((r) => r.skuId)));
    const { supplierBySku, costBySku } =
      await this.resolveSuppliersForSkus(skuIds);

    // Group reorder rows into (supplierId, warehouseId) buckets.
    type Bucket = {
      supplierId: string;
      warehouseId: string;
      lines: { skuId: string; qty: number; unitCost: number }[];
    };
    const buckets = new Map<string, Bucket>();
    const skipped: { skuId: string; reason: string }[] = [];

    for (const r of rows) {
      const supplierId = supplierBySku.get(r.skuId);
      if (!supplierId) {
        skipped.push({ skuId: r.skuId, reason: 'no supplier history' });
        continue;
      }
      const key = `${supplierId}:${r.warehouseId}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { supplierId, warehouseId: r.warehouseId, lines: [] };
        buckets.set(key, bucket);
      }
      bucket.lines.push({
        skuId: r.skuId,
        qty: r.suggestedOrderQty,
        // last-known unit cost (fallback 0 — admin edits before submitting).
        unitCost: costBySku.get(r.skuId) ?? 0,
      });
    }

    const created: { poNumber: string; supplierId: string; lines: number }[] =
      [];
    for (const bucket of buckets.values()) {
      // Totals via the shared helper so this path can never diverge from
      // createPurchaseOrder if computeTotals ever gains rounding logic (auto-draft
      // always uses taxBps=0, so taxTotal stays 0 today).
      const totals = this.computeTotals(
        bucket.lines.map((l) => ({
          orderedQty: l.qty,
          unitCost: l.unitCost,
          taxBps: 0,
        })),
      );

      try {
        const po = await this.prisma.$transaction(async (tx) => {
          // Re-validate supplier activeness inside the tx (TOCTOU close, mirrors
          // createPurchaseOrder). A concurrent deactivation skips this bucket.
          const supplier = await tx.supplier.findUnique({
            where: { id: bucket.supplierId },
            select: { status: true },
          });
          if (!supplier || supplier.status !== SupplierStatus.ACTIVE) {
            return null;
          }
          // Allocate the number inside the same tx so a failed insert rolls the
          // sequence bump back (no gap) — same invariant as createPurchaseOrder.
          const poNumber = await this.nextPoNumber(tx);
          return tx.purchaseOrder.create({
            data: {
              poNumber,
              supplierId: bucket.supplierId,
              warehouseId: bucket.warehouseId,
              status: PurchaseOrderStatus.DRAFT,
              subtotal: totals.subtotal,
              taxTotal: totals.taxTotal,
              grandTotal: totals.grandTotal,
              autoGenerated: true,
              createdById: actor.id,
              lines: {
                create: bucket.lines.map((l, i) => ({
                  skuId: l.skuId,
                  lotNo: i + 1,
                  orderedQty: l.qty,
                  unitCost: l.unitCost,
                  taxBps: 0,
                })),
              },
            },
          });
        });

        if (!po) {
          for (const l of bucket.lines)
            skipped.push({ skuId: l.skuId, reason: 'supplier inactive' });
          continue;
        }

        created.push({
          poNumber: po.poNumber,
          supplierId: po.supplierId,
          lines: bucket.lines.length,
        });
      } catch (err) {
        // A PO-number collision (tiny hash race) is retryable — surface it as a
        // skip rather than letting it abort the whole reorder pass. Mirrors
        // createPurchaseOrder's P2002 backstop.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          for (const l of bucket.lines)
            skipped.push({
              skuId: l.skuId,
              reason: 'PO number collision — retry reorder',
            });
          continue;
        }
        throw err;
      }
    }

    return { created, skipped };
  }

  /**
   * For each SKU, find the supplierId of the most recent non-cancelled PO line,
   * plus that line's unitCost as a price hint. One query ordered newest-first; the
   * first row seen per SKU wins. No per-SKU N+1.
   */
  private async resolveSuppliersForSkus(skuIds: string[]): Promise<{
    supplierBySku: Map<string, string>;
    costBySku: Map<string, number>;
  }> {
    const supplierBySku = new Map<string, string>();
    const costBySku = new Map<string, number>();
    if (skuIds.length === 0) return { supplierBySku, costBySku };

    const lines = await this.prisma.purchaseOrderLine.findMany({
      where: {
        skuId: { in: skuIds },
        purchaseOrder: { status: { not: PurchaseOrderStatus.CANCELLED } },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        skuId: true,
        unitCost: true,
        purchaseOrder: { select: { supplierId: true } },
      },
    });

    for (const l of lines) {
      if (!supplierBySku.has(l.skuId)) {
        supplierBySku.set(l.skuId, l.purchaseOrder.supplierId);
        costBySku.set(l.skuId, l.unitCost);
      }
    }
    return { supplierBySku, costBySku };
  }

  // ─────────────────────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────────────────────

  private computeTotals(
    lines: { orderedQty: number; unitCost: number; taxBps: number }[],
  ): { subtotal: number; taxTotal: number; grandTotal: number } {
    let subtotal = 0;
    let taxTotal = 0;
    for (const l of lines) {
      const lineNet = l.unitCost * l.orderedQty;
      subtotal += lineNet;
      // Integer-paise tax: floor(net * bps / 10000).
      taxTotal += Math.floor((lineNet * l.taxBps) / 10_000);
    }
    return { subtotal, taxTotal, grandTotal: subtotal + taxTotal };
  }

  /**
   * Allocate the next gapless-enough PO number via NumberSequence under a
   * transaction-scoped advisory lock, then bump `lastValue`. The advisory lock
   * serializes concurrent allocations so two POs never read the same lastValue;
   * the `@unique` on poNumber is the final backstop. Format: `{prefix}-{year}-{000001}`.
   *
   * Pass an open `tx` to allocate the number INSIDE the same transaction that
   * creates the PO row — so a failed PO insert rolls the sequence bump back and
   * leaves no gap. Called without `tx` it opens its own short transaction.
   */
  private async nextPoNumber(tx?: Prisma.TransactionClient): Promise<string> {
    const run = async (db: Prisma.TransactionClient): Promise<string> => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`numseq_${PO_SEQUENCE_SCOPE}`}))`;

      const existing = await db.numberSequence.findUnique({
        where: { scope: PO_SEQUENCE_SCOPE },
      });
      const prefix = existing?.prefix ?? PO_DEFAULT_PREFIX;
      const next = (existing?.lastValue ?? 0) + 1;

      await db.numberSequence.upsert({
        where: { scope: PO_SEQUENCE_SCOPE },
        create: {
          scope: PO_SEQUENCE_SCOPE,
          prefix: PO_DEFAULT_PREFIX,
          lastValue: next,
        },
        update: { lastValue: next },
      });

      const year = new Date().getFullYear();
      return `${prefix}-${year}-${String(next).padStart(PO_NUMBER_PAD, '0')}`;
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }
}
