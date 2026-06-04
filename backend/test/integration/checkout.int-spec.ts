/**
 * INTEGRATION spec for the CHECKOUT → PAYMENT-CAPTURE flow (OrdersService)
 * against a REAL Postgres (`arya_test`). The Razorpay SDK and the S3/PDF SDKs are
 * jest.mock'd to deterministic fakes; EVERYTHING else (the order build + stock
 * reservation transaction, the webhook capture CAS, the reservation commit that
 * decrements onHand, and the best-effort invoice generation) runs against real
 * Postgres so the transactional + idempotency invariants are genuinely proven.
 *
 * Razorpay: `orders.service` does `import Razorpay from 'razorpay'` and constructs
 * `new Razorpay({...})`, calling `.orders.create()` at checkout and
 * `.payments.refund()` on refund. We mock the default export so those are stubbed
 * to deterministic fakes (no network).
 *
 * S3 + pdfkit: InvoicingService (invoked best-effort after capture) writes a PDF
 * to S3; DocumentService/Catalog/Invoicing all build an S3Client at construction.
 * Mocking @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner + pdfkit makes the
 * invoice render a fake buffer and the PutObject a no-op — only the DB numbering /
 * persistence path actually touches Postgres.
 *
 * Drive:
 *  1. checkout(registered customer, seeded ACTIVE cart) →
 *       Order PENDING_PAYMENT + a StockReservation (ACTIVE) + a (fake) razorpay id.
 *  2. handleWebhook(payment.captured, signed over the raw body) →
 *       paymentStatus PAID + status CONFIRMED + the reservation committed
 *       (CONSUMED, onHand decremented) + (best-effort) a TAX_INVOICE row.
 */
import { randomUUID } from 'crypto';
import * as crypto from 'crypto';

// ── Razorpay: deterministic fake order id + capture amount echo. ────────────────
const rzpOrdersCreate = jest.fn(async (args: { amount: number; currency: string }) => ({
  id: `order_FAKE${randomUUID().slice(0, 8)}`,
  amount: args.amount,
  currency: args.currency,
  status: 'created',
}));
const rzpPaymentsRefund = jest.fn(async () => ({ id: `rfnd_FAKE${randomUUID().slice(0, 8)}` }));
jest.mock('razorpay', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    orders: { create: rzpOrdersCreate },
    payments: { refund: rzpPaymentsRefund },
  })),
}));

// ── S3 + presigner: no-op send / fake signed URL. ───────────────────────────────
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  HeadObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/invoice.pdf'),
}));

// `uuid` ships ESM-only (`export {...}`) and Jest does not transform node_modules,
// so importing the real package throws a SyntaxError at module load. DocumentService
// imports `uuid` for media-key generation — a path checkout never hits — so a
// deterministic CJS stub keeps the import resolvable. A real `jest.spyOn` is NOT an
// option: the unstubbed ESM package cannot even be `require`d here, so the whole
// module must be replaced.
// AUDIT WARNING: the fixed value means EVERY uuid.v4() call resolves to the same
// string. That is safe ONLY while no service on the checkout/webhook path uses
// uuid.v4() for a persisted PK/unique column (orders/invoicing use crypto
// randomUUID()). If a new service import on this path ever moves a PK to uuid.v4(),
// the fixed value would collide on a unique constraint (P2002) — re-audit this stub
// whenever a service is added to the OrdersService construction above.
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));

// ── pdfkit: minimal stub whose .end() resolves renderInvoicePdf with a buffer. ──
jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => {
    const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
    const self: Record<string, unknown> = {
      page: { margins: { left: 40 }, width: 595, height: 842 },
      y: 0,
      on(evt: string, cb: (arg?: unknown) => void) {
        (handlers[evt] ||= []).push(cb);
        return self;
      },
      fontSize: () => self,
      font: () => self,
      fillColor: () => self,
      text: () => self,
      moveDown: () => self,
      moveTo: () => self,
      lineTo: () => self,
      stroke: () => self,
      addPage: () => self,
      end() {
        (handlers['data'] || []).forEach((cb) => cb(Buffer.from('%PDF-fake')));
        (handlers['end'] || []).forEach((cb) => cb());
      },
    };
    return self;
  });
});

import {
  CartStatus,
  CustomerType,
  InvoiceType,
  OrderPaymentStatus,
  OrderStatus,
  ProductStatus,
  ReservationStatus,
  TaxRateType,
} from '@prisma/client';
import {
  getPrisma,
  truncateAll,
  closeAll,
  fakeConfig,
  fakeSettings,
  newEvents,
} from './harness';
import { OrdersService, type CheckoutActor } from '../../src/modules/orders/orders.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CouponService } from '../../src/modules/coupons/coupons.service';
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import { TaxService, SELLER_STATE_CODE_SETTING_KEY, SELLER_GSTIN_SETTING_KEY } from '../../src/modules/tax/tax.service';
import { DocumentService } from '../../src/modules/document/document.service';
import { InvoicingService } from '../../src/modules/invoicing/invoicing.service';

let prisma: Awaited<ReturnType<typeof getPrisma>>;
let svc: OrdersService;

// Seller registered in Karnataka (GST state 29); intra-state buyer below.
const SELLER_STATE = '29';
const STORE_WEBHOOK_SECRET = 'test_store_webhook_secret';

const config = fakeConfig({
  AWS_REGION: 'ap-south-1',
  AWS_ACCESS_KEY_ID: 'test-key',
  AWS_SECRET_ACCESS_KEY: 'test-secret',
  AWS_S3_BUCKET: 'arya-documents-test',
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'rzp_test_secret',
  RAZORPAY_STORE_WEBHOOK_SECRET: STORE_WEBHOOK_SECRET,
  NODE_ENV: 'test',
});

const settings = fakeSettings({
  // SELLER_STATE_CODE_SETTING_KEY IS 'store.sellerStateCode'; use the imported
  // constant once (a second literal 'store.sellerStateCode' key would be a
  // duplicate-property compile error and was removed).
  [SELLER_STATE_CODE_SETTING_KEY]: SELLER_STATE,
  [SELLER_GSTIN_SETTING_KEY]: '29ABCDE1234F1Z5',
  'store.sellerName': 'Aryavartham Test Seller',
  'store.sellerAddress': '1 Test Road, Bengaluru',
});

beforeAll(async () => {
  prisma = await getPrisma();

  const tax = new TaxService(prisma as any, settings);
  const inventory = new InventoryService(prisma as any, newEvents());
  const coupons = new CouponService(prisma as any);
  const documents = new DocumentService(prisma as any, config);
  const invoicing = new InvoicingService(prisma as any, config, settings);
  // CartService's coupon collaborator is the (optional) CouponService; guestTokens
  // is only used by createGuestCart (we seed the cart directly), so a stub suffices.
  const guestTokensStub = {
    mintCartToken: jest.fn(),
    mintOrderToken: jest.fn(),
  } as any;
  const cart = new CartService(prisma as any, guestTokensStub, tax, coupons as any);

  svc = new OrdersService(
    prisma as any,
    config,
    cart,
    coupons,
    inventory,
    tax,
    guestTokensStub,
    settings,
    documents,
    invoicing,
    newEvents(),
  );
});

afterAll(async () => {
  await closeAll();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await truncateAll(prisma);
  await prisma.$queryRaw`SELECT 1`;
});

// ──────────────────────────────────────────────────────────────────────────
//  Seed: warehouse(+stateCode) + product + sku(+taxClass) + stocklevel +
//  registered customer + an ACTIVE cart with one item. Returns the ids needed
//  to drive + assert the flow.
// ──────────────────────────────────────────────────────────────────────────
async function seedCheckoutFixture(opts: { onHand?: number; qty?: number } = {}) {
  const onHand = opts.onHand ?? 10;
  const qty = opts.qty ?? 2;

  const warehouseId = randomUUID();
  await prisma.warehouse.create({
    data: {
      id: warehouseId,
      code: `WH-${warehouseId}`,
      name: 'Primary WH',
      stateCode: SELLER_STATE, // NON-NULL → eligible for allocateWarehouse
      isActive: true,
    },
  });

  // GST 18% tax class (CGST 9% + SGST 9% / IGST 18%).
  const taxClassId = randomUUID();
  await prisma.taxClass.create({
    data: {
      id: taxClassId,
      name: `GST 18% ${taxClassId.slice(0, 6)}`,
      type: TaxRateType.GST,
      hsnCode: '8471',
      cgstBps: 900,
      sgstBps: 900,
      igstBps: 1800,
      isActive: true,
    },
  });

  const productId = randomUUID();
  await prisma.product.create({
    data: {
      id: productId,
      slug: `prod-${productId}`,
      name: 'Checkout Product',
      status: ProductStatus.ACTIVE,
      publishedAt: new Date(),
    },
  });

  const skuId = randomUUID();
  await prisma.sku.create({
    data: {
      id: skuId,
      productId,
      skuCode: `SKU-${skuId}`,
      name: 'Checkout SKU',
      basePrice: 50000, // ₹500.00 each (integer paise)
      hsnCode: '8471',
      taxClassId,
      isActive: true,
    },
  });

  await prisma.stockLevel.create({
    data: {
      id: randomUUID(),
      skuId,
      warehouseId,
      onHand,
      reserved: 0,
      version: 0,
    },
  });

  const customerId = randomUUID();
  await prisma.customer.create({
    data: {
      id: customerId,
      type: CustomerType.REGISTERED,
      email: `buyer-${customerId}@example.com`,
      firstName: 'Buyer',
      lastName: 'Test',
      emailVerified: true,
      isActive: true,
    },
  });

  const cartId = randomUUID();
  await prisma.cart.create({
    data: {
      id: cartId,
      customerId,
      status: CartStatus.ACTIVE,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      items: {
        create: {
          id: randomUUID(),
          skuId,
          quantity: qty,
          unitPriceSnapshot: 50000,
        },
      },
    },
  });

  return { warehouseId, taxClassId, productId, skuId, customerId, cartId, qty, onHand };
}

const SHIPPING = {
  fullName: 'Buyer Test',
  line1: '1 Test Lane',
  city: 'Bengaluru',
  stateCode: SELLER_STATE, // intra-state → CGST + SGST
  postalCode: '560001',
  country: 'IN',
};

/** Build a signed Razorpay store webhook (HMAC-SHA256 over the raw body). */
function signedWebhook(body: unknown): { signature: string; raw: string } {
  const raw = JSON.stringify(body);
  const signature = crypto
    .createHmac('sha256', STORE_WEBHOOK_SECRET)
    .update(Buffer.from(raw))
    .digest('hex');
  return { signature, raw };
}

describe('Checkout → payment capture (integration, real Postgres)', () => {
  it('checkout creates a PENDING_PAYMENT order with a reservation + fake Razorpay id; capture promotes to PAID/CONFIRMED, commits stock, and (best-effort) generates an invoice', async () => {
    const fx = await seedCheckoutFixture({ onHand: 10, qty: 2 });

    const actor: CheckoutActor = {
      customerId: fx.customerId,
      email: `buyer-${fx.customerId}@example.com`,
      isGuest: false,
    };

    // ── 1) CHECKOUT ───────────────────────────────────────────────────────────
    const result = await svc.checkout(actor, { shippingAddress: SHIPPING } as any);

    // The fake Razorpay order id flowed back, and orders.create was called once.
    expect(result.razorpayOrderId).toMatch(/^order_FAKE/);
    expect(result.amount).toBeGreaterThan(0);
    expect(result.currency).toBe('INR');
    expect(rzpOrdersCreate).toHaveBeenCalledTimes(1);

    // The order persisted PENDING_PAYMENT / UNPAID with the razorpay id patched on.
    const order = await prisma.order.findUnique({
      where: { id: result.orderId },
      include: { items: true },
    });
    expect(order).not.toBeNull();
    expect(order!.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(order!.paymentStatus).toBe(OrderPaymentStatus.UNPAID);
    expect(order!.razorpayOrderId).toBe(result.razorpayOrderId);
    expect(order!.items).toHaveLength(1);

    // Totals: 2 × ₹500 = ₹1000 taxable + 18% GST (intra-state CGST+SGST) = ₹1180.
    expect(order!.itemsSubtotal).toBe(100000);
    expect(order!.cgstTotal).toBe(9000);
    expect(order!.sgstTotal).toBe(9000);
    expect(order!.igstTotal).toBe(0);
    expect(order!.grandTotal).toBe(118000);
    expect(result.amount).toBe(118000);

    // A StockReservation was made (ACTIVE), holding the cart qty; onHand untouched,
    // reserved bumped.
    const reservation = await prisma.stockReservation.findFirst({
      where: { orderId: order!.id },
    });
    expect(reservation).not.toBeNull();
    expect(reservation!.status).toBe(ReservationStatus.ACTIVE);
    expect(reservation!.quantity).toBe(fx.qty);

    const levelAfterCheckout = await prisma.stockLevel.findUnique({
      where: { skuId_warehouseId: { skuId: fx.skuId, warehouseId: fx.warehouseId } },
    });
    expect(levelAfterCheckout!.onHand).toBe(10);
    expect(levelAfterCheckout!.reserved).toBe(fx.qty);

    // The cart was marked CONVERTED.
    const convertedCart = await prisma.cart.findUnique({ where: { id: fx.cartId } });
    expect(convertedCart!.status).toBe(CartStatus.CONVERTED);

    // ── 2) WEBHOOK: payment.captured ──────────────────────────────────────────
    const event = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_FAKE${randomUUID().slice(0, 8)}`,
            order_id: order!.razorpayOrderId,
            amount: order!.grandTotal, // must match exactly or capture is refused
            currency: order!.currency,
          },
        },
      },
    };
    const { signature, raw } = signedWebhook(event);

    const ack = await svc.handleWebhook(signature, raw);
    expect(ack).toEqual({ received: true });

    // Order promoted to PAID + CONFIRMED, paidAt + razorpayPaymentId stamped.
    const paid = await prisma.order.findUnique({ where: { id: order!.id } });
    expect(paid!.paymentStatus).toBe(OrderPaymentStatus.PAID);
    expect(paid!.status).toBe(OrderStatus.CONFIRMED);
    expect(paid!.paidAt).not.toBeNull();
    expect(paid!.razorpayPaymentId).toBe(event.payload.payment.entity.id);

    // The reservation was COMMITTED: status CONSUMED, onHand decremented by qty,
    // reserved released back to 0.
    const committedReservation = await prisma.stockReservation.findUnique({
      where: { id: reservation!.id },
    });
    expect(committedReservation!.status).toBe(ReservationStatus.CONSUMED);

    const levelAfterCapture = await prisma.stockLevel.findUnique({
      where: { skuId_warehouseId: { skuId: fx.skuId, warehouseId: fx.warehouseId } },
    });
    expect(levelAfterCapture!.onHand).toBe(10 - fx.qty);
    expect(levelAfterCapture!.reserved).toBe(0);

    // Best-effort invoice generation ran after capture → exactly one TAX_INVOICE
    // row for the order (numbering uses the migration-seeded sequence).
    const invoices = await prisma.invoice.findMany({
      where: { orderId: order!.id, type: InvoiceType.TAX_INVOICE },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].grandTotal).toBe(order!.grandTotal);
  });

  it('a duplicate payment.captured delivery is idempotent: the order stays PAID/CONFIRMED and stock is NOT double-decremented', async () => {
    const fx = await seedCheckoutFixture({ onHand: 8, qty: 3 });
    const actor: CheckoutActor = {
      customerId: fx.customerId,
      email: `buyer-${fx.customerId}@example.com`,
      isGuest: false,
    };

    const result = await svc.checkout(actor, { shippingAddress: SHIPPING } as any);
    const order = await prisma.order.findUnique({ where: { id: result.orderId } });

    const event = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_FAKE${randomUUID().slice(0, 8)}`,
            order_id: order!.razorpayOrderId,
            amount: order!.grandTotal,
            currency: order!.currency,
          },
        },
      },
    };
    const { signature, raw } = signedWebhook(event);

    // Deliver the SAME captured event twice (Razorpay retries are common).
    await svc.handleWebhook(signature, raw);
    await svc.handleWebhook(signature, raw);

    const paid = await prisma.order.findUnique({ where: { id: order!.id } });
    expect(paid!.paymentStatus).toBe(OrderPaymentStatus.PAID);
    expect(paid!.status).toBe(OrderStatus.CONFIRMED);

    // onHand decremented by qty EXACTLY ONCE (the exactly-once CAS no-ops the dup).
    const level = await prisma.stockLevel.findUnique({
      where: { skuId_warehouseId: { skuId: fx.skuId, warehouseId: fx.warehouseId } },
    });
    expect(level!.onHand).toBe(8 - fx.qty);
    expect(level!.reserved).toBe(0);

    // Still exactly one consumed reservation; no second commit.
    const consumed = await prisma.stockReservation.count({
      where: { orderId: order!.id, status: ReservationStatus.CONSUMED },
    });
    expect(consumed).toBe(1);
  });

  it('rejects a webhook whose HMAC signature does not verify (fail-closed) and does NOT promote the order', async () => {
    const fx = await seedCheckoutFixture({ onHand: 5, qty: 1 });
    const actor: CheckoutActor = {
      customerId: fx.customerId,
      email: `buyer-${fx.customerId}@example.com`,
      isGuest: false,
    };
    const result = await svc.checkout(actor, { shippingAddress: SHIPPING } as any);
    const order = await prisma.order.findUnique({ where: { id: result.orderId } });

    const event = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_FAKE',
            order_id: order!.razorpayOrderId,
            amount: order!.grandTotal,
            currency: order!.currency,
          },
        },
      },
    };
    const { raw } = signedWebhook(event);

    await expect(svc.handleWebhook('deadbeef', raw)).rejects.toThrow();

    // Order untouched — still PENDING_PAYMENT / UNPAID.
    const stillPending = await prisma.order.findUnique({ where: { id: order!.id } });
    expect(stillPending!.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(stillPending!.paymentStatus).toBe(OrderPaymentStatus.UNPAID);
  });
});
