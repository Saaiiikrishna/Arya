/**
 * Integration-test harness: a REAL PrismaService bound to the `arya_test`
 * database (env redirected in setup-env.ts), plus stub factories for the
 * non-DB collaborators. Tests exercise genuine Postgres concurrency
 * (advisory locks + CAS) — that is the whole point of these specs.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../src/prisma/prisma.service';

let prismaSingleton: PrismaService | null = null;

/** Minimal ConfigService stub returning the (test) DATABASE_URL + any overrides. */
export function fakeConfig(values: Record<string, unknown> = {}): any {
  return {
    get: (k: string) =>
      k in values ? values[k] : (process.env as Record<string, string | undefined>)[k],
  };
}

/** Minimal SettingsService stub (async get) — used by tax/invoicing. */
export function fakeSettings(values: Record<string, unknown> = {}): any {
  return { get: async (k: string) => (k in values ? values[k] : null) };
}

export function newEvents(): EventEmitter2 {
  return new EventEmitter2();
}

export async function getPrisma(): Promise<PrismaService> {
  if (!prismaSingleton) {
    prismaSingleton = new PrismaService(fakeConfig());
    await prismaSingleton.$connect();
  }
  return prismaSingleton;
}

// Child tables first so RESTART IDENTITY CASCADE is clean. Sequences
// (invoice_sequences/number_sequences) are intentionally NOT truncated so the
// migration-seeded counters persist; numbering tests assert relative contiguity.
const TABLES = [
  'invoice_lines', 'invoices',
  'order_events', 'order_items', 'orders',
  'return_items', 'returns',
  'shipment_events', 'shipments',
  'coupon_redemptions', 'coupons',
  'cart_items', 'carts',
  'stock_reservations', 'stock_movements', 'stock_levels',
  'price_tiers', 'skus',
  'product_tab_sections', 'product_tabs', 'product_media',
  'diy_bom_items', 'diy_steps', 'diy_guides', 'bundle_items', 'component_bundles',
  'products', 'warehouses', 'suppliers',
  'purchase_order_lines', 'purchase_orders',
  'tax_rates', 'tax_classes',
  'addresses', 'customers',
  'article_media', 'articles', 'store_daily_stats',
];

export async function truncateAll(p: PrismaService): Promise<void> {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await p.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function closeAll(): Promise<void> {
  if (prismaSingleton) {
    await prismaSingleton.$disconnect();
    prismaSingleton = null;
  }
}
