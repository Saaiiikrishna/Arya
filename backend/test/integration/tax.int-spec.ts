/**
 * Integration spec for TaxService against a REAL Postgres (arya_test) — no DB
 * mocks. Seeds genuine TaxClass / TaxRate rows and exercises the full
 * computeTax() path (rate resolution → pure round-half-up engine).
 *
 * Invariants asserted (all amounts INTEGER PAISE):
 *   1. INTRA-STATE: buyer===seller → CGST = SGST = half the rate, IGST 0.
 *   2. INTER-STATE: buyer!==seller → IGST = full rate, CGST/SGST 0.
 *   3. HALF-UP rounding per component per line on an odd taxable value.
 *   4. Resolution order: SKU TaxClass first, else HSN TaxRate fallback.
 */
import { randomUUID } from 'crypto';
import { TaxRateType } from '@prisma/client';
import {
  getPrisma,
  truncateAll,
  closeAll,
  fakeSettings,
} from './harness';
import {
  TaxService,
  SELLER_STATE_CODE_SETTING_KEY,
} from '../../src/modules/tax/tax.service';

let prisma: Awaited<ReturnType<typeof getPrisma>>;
let svc: TaxService;

// Seller is registered in Karnataka (GST state code 29).
const SELLER_STATE = '29';

beforeAll(async () => {
  prisma = await getPrisma();
  svc = new TaxService(
    prisma,
    fakeSettings({ [SELLER_STATE_CODE_SETTING_KEY]: SELLER_STATE }),
  );
});

afterAll(async () => {
  await closeAll();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

/** Seed a GST 18% TaxClass stored as a CGST+SGST split (900 + 900 bps). */
async function seedGst18Class(): Promise<string> {
  const id = randomUUID();
  await prisma.taxClass.create({
    data: {
      id,
      name: 'GST 18%',
      type: TaxRateType.GST,
      hsnCode: '8471',
      cgstBps: 900,
      sgstBps: 900,
      igstBps: 1800,
      isActive: true,
    },
  });
  return id;
}

/** Seed an HSN→bps TaxRate (5% = 500 bps) used for the fallback path. */
async function seedHsnRate(hsnCode: string, totalGstBps: number): Promise<void> {
  await prisma.taxRate.create({
    data: {
      id: randomUUID(),
      hsnCode,
      type: TaxRateType.GST,
      totalGstBps,
    },
  });
}

describe('TaxService.computeTax — integration (real Postgres)', () => {
  it('(1) INTRA-STATE: buyer state === seller state → CGST+SGST split, IGST 0', async () => {
    const taxClassId = await seedGst18Class();

    // taxable value = 100000 paise (Rs 1000). 18% = 18000 paise total.
    const [line] = await svc.computeTax(
      [{ taxableValuePaise: 100000, taxClassId }],
      SELLER_STATE, // buyer === seller → intra-state
    );

    // CGST = SGST = 9% of 100000 = 9000 paise each; IGST 0.
    expect(line.cgstBps).toBe(900);
    expect(line.sgstBps).toBe(900);
    expect(line.igstBps).toBe(0);
    expect(line.cgstAmount).toBe(9000);
    expect(line.sgstAmount).toBe(9000);
    expect(line.igstAmount).toBe(0);
    // Components sum exactly to the full 18% (18000 paise).
    expect(line.cgstAmount + line.sgstAmount + line.igstAmount).toBe(18000);
  });

  it('(2) INTER-STATE: buyer state !== seller state → IGST full rate, CGST/SGST 0', async () => {
    const taxClassId = await seedGst18Class();

    // Buyer in Maharashtra (27) != seller Karnataka (29) → inter-state.
    const [line] = await svc.computeTax(
      [{ taxableValuePaise: 100000, taxClassId }],
      '27',
    );

    expect(line.cgstBps).toBe(0);
    expect(line.sgstBps).toBe(0);
    expect(line.igstBps).toBe(1800);
    expect(line.cgstAmount).toBe(0);
    expect(line.sgstAmount).toBe(0);
    expect(line.igstAmount).toBe(18000); // full 18% as IGST
  });

  it('(3) HALF-UP rounding per component per line on an odd taxable value', async () => {
    const taxClassId = await seedGst18Class();

    // taxable value = 50 paise. Per intra-state component the engine computes
    // floor((50 * 900 + 5000) / 10000) = floor(50000/10000) = 5.
    // The raw arithmetic value is exactly 4.5 paise, so HALF-UP must round to 5
    // (truncation would have given 4). Rounding is applied INDEPENDENTLY per
    // component, never on the sum.
    const [intra] = await svc.computeTax(
      [{ taxableValuePaise: 50, taxClassId }],
      SELLER_STATE,
    );
    expect(intra.cgstAmount).toBe(5);
    expect(intra.sgstAmount).toBe(5);
    expect(intra.igstAmount).toBe(0);
    // Per-component half-up then sum = 10 paise (proves rounding is per
    // component, not 4.5+4.5=9 rounded once).
    expect(intra.cgstAmount + intra.sgstAmount).toBe(10);

    // Inter-state half-up on the FULL 1800 bps rate. taxable = 25 paise gives a
    // raw value of 25*1800/10000 = 4.5 paise, so HALF-UP must round to 5:
    // floor((25 * 1800 + 5000) / 10000) = floor(50000/10000) = 5 (truncation → 4).
    const [inter] = await svc.computeTax(
      [{ taxableValuePaise: 25, taxClassId }],
      '27',
    );
    expect(inter.igstAmount).toBe(5);
    expect(inter.cgstAmount).toBe(0);
    expect(inter.sgstAmount).toBe(0);
  });

  it('(4a) resolves the rate via the SKU TaxClass FIRST when both class and HSN exist', async () => {
    const taxClassId = await seedGst18Class(); // 18% via class
    // A *different* HSN rate (5%) exists for the same HSN code; the class must win.
    await seedHsnRate('8471', 500);

    const [line] = await svc.computeTax(
      [{ taxableValuePaise: 100000, taxClassId, hsnCode: '8471' }],
      SELLER_STATE,
    );

    // 18% (class), NOT 5% (HSN). Intra-state → 9000 + 9000.
    expect(line.cgstBps).toBe(900);
    expect(line.sgstBps).toBe(900);
    expect(line.cgstAmount).toBe(9000);
    expect(line.sgstAmount).toBe(9000);
    expect(line.igstAmount).toBe(0);
  });

  it('(4b) falls back to the HSN TaxRate when no TaxClass is supplied', async () => {
    // No taxClassId on the line → HSN fallback. 5% = 500 bps total.
    await seedHsnRate('1006', 500);

    // Intra-state: 5% split into CGST 250 bps + SGST 250 bps on 100000 paise.
    const [intra] = await svc.computeTax(
      [{ taxableValuePaise: 100000, hsnCode: '1006' }],
      SELLER_STATE,
    );
    expect(intra.cgstBps).toBe(250);
    expect(intra.sgstBps).toBe(250);
    expect(intra.igstBps).toBe(0);
    expect(intra.cgstAmount).toBe(2500); // 2.5% of 100000
    expect(intra.sgstAmount).toBe(2500);
    expect(intra.igstAmount).toBe(0);

    // Inter-state via the same HSN fallback → full 500 bps as IGST.
    const [inter] = await svc.computeTax(
      [{ taxableValuePaise: 100000, hsnCode: '1006' }],
      '27',
    );
    expect(inter.igstBps).toBe(500);
    expect(inter.igstAmount).toBe(5000); // 5% of 100000
    expect(inter.cgstAmount).toBe(0);
    expect(inter.sgstAmount).toBe(0);
  });
});
