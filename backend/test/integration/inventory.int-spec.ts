/**
 * INTEGRATION spec for InventoryService against a REAL Postgres (`arya_test`).
 *
 * These tests exercise the genuine oversell-guard machinery — the per-(sku,
 * warehouse) `pg_advisory_xact_lock` acquisition plus the version + `onHand -
 * reserved - qty >= 0` optimistic CAS — with NO database mocks. The only
 * non-DB collaborator is the in-memory EventEmitter2 supplied by the harness;
 * InventoryService touches no S3/Razorpay/SES SDK, so nothing else is stubbed.
 *
 * Invariants asserted:
 *  (1) Oversell is impossible under concurrency: 15 racing single-unit reserves
 *      against onHand=10 → EXACTLY 10 succeed, 5 fail; reserved never exceeds
 *      onHand and available never goes negative.
 *  (2) commit flips ACTIVE→CONSUMED and decrements onHand AND reserved together.
 *  (3) release flips ACTIVE→RELEASED and returns the held units (reserved down,
 *      onHand unchanged).
 *  (4) allocateWarehouse skips a NULL-state_code warehouse and throws
 *      NO_FULFILLABLE_WAREHOUSE when none can fulfil.
 */
import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient, ReservationStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  getPrisma,
  truncateAll,
  closeAll,
  newEvents,
} from './harness';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  InventoryService,
  StockActor,
  StockLine,
} from '../../src/modules/inventory/inventory.service';

// The singleton from the harness is always a PrismaService — type it as such so
// every seed/re-read Prisma call in this suite is compiler-checked. (The dedicated
// concurrency client below is a raw PrismaClient + PrismaPg adapter, which is
// structurally INCOMPATIBLE with PrismaService — see makeConcurrencyClient — so it
// must remain `any`; that incompatibility is the documented reason for the cast.)
let prisma: PrismaService;
let svc: InventoryService;

/**
 * The concurrency test fires 15 interactive `$transaction`s that each take the
 * per-(sku, warehouse) `pg_advisory_xact_lock`. To let every advisory-lock waiter
 * hold its OWN connection at once (so the race is decided purely by the version +
 * `onHand - reserved - qty >= 0` CAS, not by pool-connection starvation), the
 * concurrent reserves run through a DEDICATED client whose pg pool is sized to
 * the fan-out. It carries the `IS_PRISMA_SERVICE` marker the service uses to
 * decide it owns the commit boundary, so `reserveMany` still opens + commits its
 * OWN `$transaction` per call (the real path; no DB mocks). It is disconnected at
 * test end and the suite then waits for backend quiescence (see
 * waitForArenaQuiescent) before the next TRUNCATE.
 */
function makeConcurrencyClient(connectionString: string): any {
  const pool = new Pool({ connectionString, max: 20 });
  const adapter = new PrismaPg(pool as any);
  const client = new PrismaClient({ adapter });
  (client as any).IS_PRISMA_SERVICE = true;
  return client;
}

// A real principal — reserveMany.requireActor() refuses a missing/blank actor
// (it would otherwise poison the audit trail with triggeredBy=SYSTEM). Typed as
// the service's StockActor (role is optional there) for maintainability; the id is
// a single module-load UUID, reused across tests (it only needs to be non-blank).
const ACTOR: StockActor = { id: randomUUID(), role: 'ADMIN' };

// Seeded ids (regenerated each test via beforeEach → seedBaseStock).
let productId: string;
let skuId: string;
let warehouseId: string;

beforeAll(async () => {
  prisma = await getPrisma();
  svc = new InventoryService(prisma, newEvents());
});

afterAll(async () => {
  await closeAll();
});

beforeEach(async () => {
  // Defensive barrier: ensure no leftover backend (a losing reserve mid-rollback
  // from the prior test, or a stale connection from a prior jest process) still
  // holds row/advisory locks before TRUNCATE takes ACCESS EXCLUSIVE — otherwise
  // the two can deadlock (40P01) and flake the suite.
  await waitForArenaQuiescent();
  await truncateAll(prisma);
});

/**
 * Seed Product → Sku → Warehouse (active, NON-NULL stateCode) → StockLevel.
 * onHand/reserved are caller-supplied so each test starts from a known floor.
 * Returns the created ids; also sets the module-level convenience vars.
 */
async function seedBaseStock(
  onHand: number,
  reserved = 0,
): Promise<{ productId: string; skuId: string; warehouseId: string }> {
  productId = randomUUID();
  skuId = randomUUID();
  warehouseId = randomUUID();

  await prisma.product.create({
    data: {
      id: productId,
      slug: `prod-${productId}`,
      name: 'Test Product',
    },
  });

  await prisma.sku.create({
    data: {
      id: skuId,
      productId,
      skuCode: `SKU-${skuId}`,
      name: 'Test SKU',
      basePrice: 100000, // integer paise (₹1000)
    },
  });

  await prisma.warehouse.create({
    data: {
      id: warehouseId,
      code: `WH-${warehouseId}`,
      name: 'Primary WH',
      stateCode: 'KA', // NON-NULL → eligible for allocateWarehouse
      isActive: true,
    },
  });

  await prisma.stockLevel.create({
    data: {
      id: randomUUID(),
      skuId,
      warehouseId,
      onHand,
      reserved,
      version: 0,
    },
  });

  return { productId, skuId, warehouseId };
}

/**
 * Re-read the single seeded StockLevel row. The row is always seeded by
 * seedBaseStock, so a null here is a test-setup bug — assert non-null with
 * findUniqueOrThrow so callers get a non-nullable type (now that `prisma` is the
 * strictly-typed PrismaService).
 */
async function readLevel() {
  return prisma.stockLevel.findUniqueOrThrow({
    where: { skuId_warehouseId: { skuId, warehouseId } },
  });
}

const TTL = () => new Date(Date.now() + 60 * 60 * 1000); // 1h in the future

/**
 * Barrier: block (via the singleton connection) until every OTHER backend on
 * `arya_test` is gone. `bigDb.$disconnect()` returns before Postgres has finished
 * rolling back the losing transactions' backends; if the next test's `beforeEach`
 * TRUNCATE (ACCESS EXCLUSIVE) starts while one is still rolling back its row
 * locks, the two deadlock (`40P01`). Waiting for quiescence first makes the suite
 * deterministic without touching the shared harness.
 */
async function waitForArenaQuiescent(maxMs = 10000): Promise<void> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    // Only backends that are ACTIVE or sitting `idle in transaction` can hold
    // row/advisory locks that conflict with the next TRUNCATE. Plain `idle`
    // backends (e.g. the singleton harness pool's own spare connections) hold no
    // locks and never block, so they are intentionally NOT counted here.
    const rows = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = ${'arya_test'} AND pid <> pg_backend_pid()
      AND state IN ('active', 'idle in transaction', 'idle in transaction (aborted)')
    `);
    if (Number(rows[0]?.n ?? 0) === 0 || Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('InventoryService (integration, real Postgres)', () => {
  it('(1) does NOT oversell under concurrency: 15 racing reserves of qty 1 against onHand=10 → exactly 10 succeed, 5 fail; available never negative', async () => {
    await seedBaseStock(10, 0);

    const lines: StockLine[] = [{ skuId, warehouseId, qty: 1 }];

    // Dedicated pool client + its own InventoryService so all 15 advisory-lock
    // waiters can each hold a connection (see makeConcurrencyClient). The seed,
    // re-reads and truncate stay on the singleton; only the racing reserves use
    // this client. It still hits the REAL DB advisory lock + CAS (no mocks).
    const bigDb = makeConcurrencyClient(process.env.DATABASE_URL as string);
    const concurrentSvc = new InventoryService(bigDb, newEvents());

    let results: PromiseSettledResult<string[]>[];
    try {
      // Fire 15 fully concurrent single-unit reservations. Each opens its own
      // interactive $transaction, contends on the SAME advisory lock key, and is
      // gated by the version + (onHand - reserved - qty >= 0) CAS.
      results = await Promise.allSettled(
        Array.from({ length: 15 }, () =>
          concurrentSvc.reserveMany(bigDb, lines, {
            expiresAt: TTL(),
            actor: ACTOR,
          }),
        ),
      );
    } finally {
      await bigDb.$disconnect();
      // Wait out any backend still rolling back a losing transaction so the next
      // test's beforeEach TRUNCATE cannot deadlock against it.
      await waitForArenaQuiescent();
    }

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // EXACTLY 10 fulfilled, 5 rejected — onHand=10 is the hard ceiling.
    expect(fulfilled.length).toBe(10);
    expect(rejected.length).toBe(5);

    // Every rejection must be the oversell guard (INSUFFICIENT_STOCK 409), not a
    // deadlock / unexpected error.
    for (const r of rejected as PromiseRejectedResult[]) {
      expect(r.reason).toBeInstanceOf(ConflictException);
      expect(String(r.reason?.message)).toContain('INSUFFICIENT_STOCK');
    }

    // Authoritative re-read: reserved climbed to exactly 10, onHand untouched,
    // available pinned at 0 — never negative.
    const level = await readLevel();
    expect(level.onHand).toBe(10);
    expect(level.reserved).toBe(10);
    expect(level.onHand - level.reserved).toBe(0);
    expect(level.onHand - level.reserved).toBeGreaterThanOrEqual(0);

    // Exactly 10 ACTIVE reservation rows were created (one per fulfilled call).
    const activeCount = await prisma.stockReservation.count({
      where: { skuId, warehouseId, status: ReservationStatus.ACTIVE },
    });
    expect(activeCount).toBe(10);
  });

  it('(2) reserve → commit decrements onHand AND reserved together (10/0 → 10/1 reserved → 9 onHand / 0 reserved)', async () => {
    await seedBaseStock(10, 0);

    const [reservationId] = await svc.reserveMany(
      prisma,
      [{ skuId, warehouseId, qty: 1 }],
      { expiresAt: TTL(), actor: ACTOR },
    );

    // After reserve: onHand unchanged, reserved bumped.
    const afterReserve = await readLevel();
    expect(afterReserve.onHand).toBe(10);
    expect(afterReserve.reserved).toBe(1);

    const committed = await svc.commitReservation(prisma, reservationId, {
      actor: ACTOR,
    });
    expect(committed).toBe(true);

    // Commit drops BOTH onHand and reserved by the reservation quantity.
    const afterCommit = await readLevel();
    expect(afterCommit.onHand).toBe(9);
    expect(afterCommit.reserved).toBe(0);
    expect(afterCommit.onHand - afterCommit.reserved).toBe(9);

    const reservation = await prisma.stockReservation.findUniqueOrThrow({
      where: { id: reservationId },
    });
    expect(reservation.status).toBe(ReservationStatus.CONSUMED);

    // Idempotency: a second commit is a no-op (already terminal), counters frozen.
    const second = await svc.commitReservation(prisma, reservationId, {
      actor: ACTOR,
    });
    expect(second).toBe(false);
    const stillNine = await readLevel();
    expect(stillNine.onHand).toBe(9);
    expect(stillNine.reserved).toBe(0);
  });

  it('(3) reserve → release returns the held units (reserved back down, onHand unchanged)', async () => {
    await seedBaseStock(10, 0);

    const [reservationId] = await svc.reserveMany(
      prisma,
      [{ skuId, warehouseId, qty: 3 }],
      { expiresAt: TTL(), actor: ACTOR },
    );

    const afterReserve = await readLevel();
    expect(afterReserve.onHand).toBe(10);
    expect(afterReserve.reserved).toBe(3);

    const released = await svc.releaseReservation(prisma, reservationId, {
      actor: ACTOR,
    });
    expect(released).toBe(true);

    // Release returns the units: reserved back to 0, onHand never touched.
    const afterRelease = await readLevel();
    expect(afterRelease.onHand).toBe(10);
    expect(afterRelease.reserved).toBe(0);
    expect(afterRelease.onHand - afterRelease.reserved).toBe(10);

    const reservation = await prisma.stockReservation.findUniqueOrThrow({
      where: { id: reservationId },
    });
    expect(reservation.status).toBe(ReservationStatus.RELEASED);

    // Idempotency: a second release is a no-op (no double-decrement of reserved).
    const second = await svc.releaseReservation(prisma, reservationId, {
      actor: ACTOR,
    });
    expect(second).toBe(false);
    const stillTen = await readLevel();
    expect(stillTen.onHand).toBe(10);
    expect(stillTen.reserved).toBe(0);
  });

  it('(4) allocateWarehouse skips a NULL-state_code warehouse and throws when none can fulfil', async () => {
    // Seed the canonical SKU + an ACTIVE warehouse, but with a NULL stateCode so
    // it is INELIGIBLE for allocation (GST place-of-supply guard, M2a). Give it
    // plenty of stock to prove it is skipped on the state_code rule, not on stock.
    await seedBaseStock(0, 0); // creates product/sku/warehouse + a 0-stock level

    // Null out the seeded warehouse's stateCode and stock it heavily.
    await prisma.warehouse.update({
      where: { id: warehouseId },
      data: { stateCode: null },
    });
    await prisma.stockLevel.update({
      where: { skuId_warehouseId: { skuId, warehouseId } },
      data: { onHand: 100, reserved: 0 },
    });

    // Only candidate warehouse has a NULL state_code → must be skipped → throw.
    await expect(
      svc.allocateWarehouse([{ skuId, qty: 1 }]),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      svc.allocateWarehouse([{ skuId, qty: 1 }]),
    ).rejects.toThrow('NO_FULFILLABLE_WAREHOUSE');

    // Now add a SECOND warehouse that IS eligible (non-null state_code) and stock
    // it → allocation must pick it, proving the NULL-state one was skipped while a
    // valid alternative exists.
    const goodWhId = randomUUID();
    await prisma.warehouse.create({
      data: {
        id: goodWhId,
        code: `WH-${goodWhId}`,
        name: 'Eligible WH',
        stateCode: 'MH',
        isActive: true,
        priority: 5,
      },
    });
    await prisma.stockLevel.create({
      data: {
        id: randomUUID(),
        skuId,
        warehouseId: goodWhId,
        onHand: 50,
        reserved: 0,
        version: 0,
      },
    });

    const chosen = await svc.allocateWarehouse([{ skuId, qty: 1 }]);
    expect(chosen).toBe(goodWhId);

    // And when the eligible warehouse cannot cover demand, it throws again
    // (no fulfillable single warehouse).
    await expect(
      svc.allocateWarehouse([{ skuId, qty: 999 }]),
    ).rejects.toThrow('NO_FULFILLABLE_WAREHOUSE');
  });
});
