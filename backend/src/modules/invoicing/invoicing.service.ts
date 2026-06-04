import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  InvoiceType,
  OrderPaymentStatus,
} from '@prisma/client';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ListInvoicesDto } from './dto';
import {
  SELLER_GSTIN_SETTING_KEY,
  SELLER_STATE_CODE_SETTING_KEY,
  SELLER_NAME_SETTING_KEY,
  SELLER_ADDRESS_SETTING_KEY,
  DOWNLOAD_URL_TTL_SECONDS,
  FALLBACK_SELLER_NAME,
  INVOICE_PREFIX_PATTERN,
} from './invoicing.constants';

/** IST is UTC+5:30; used to derive the Indian financial year correctly. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Loose UUID v1–v5 format guard for ids that bypass the controller's pipe. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Shape returned by the owner download endpoint. */
export interface InvoiceDownload {
  invoiceNumber: string;
  issuedAt: Date | null;
  grandTotal: number;
  downloadUrl: string;
}

/**
 * Resolved seller identity. Prefers the per-order frozen snapshot
 * (`Order.sellerGstinSnapshot` / `Order.sellerStateCode`) and falls back to the
 * single configured SiteSettings identity (single-GSTIN, §14.1) only for legacy
 * orders predating those columns.
 */
interface SellerIdentity {
  name: string;
  gstin: string | null;
  stateCode: string | null;
  address: string | null;
}

/**
 * Minimal buyer identity extracted from the order's billing (preferred) /
 * shipping address JSON. Tolerant of either an Address-row shape (fullName,
 * line1, ...) or a free-form snapshot.
 */
interface BuyerIdentity {
  name: string;
  gstin: string | null;
  stateCode: string | null;
  addressLines: string[];
}

/**
 * The Order fields the seller-identity resolver reads (frozen snapshot + the
 * billing/shipping JSON for the buyer block).
 */
interface OrderSellerSnapshot {
  sellerGstinSnapshot: string | null;
  sellerStateCode: string | null;
}

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly settings: SettingsService,
  ) {
    // Own S3 client, matching the per-service pattern in document.service.ts and
    // store-media.service.ts (each constructs its own S3Client). Server-generated
    // PDFs use the direct PutObject path (architecture 8.7), not the client
    // presign+confirm flow.
    this.s3 = new S3Client({
      region: this.configService.get<string>('AWS_REGION', 'ap-south-1'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.configService.get<string>(
          'AWS_SECRET_ACCESS_KEY',
          '',
        ),
      },
    });
    this.bucket = this.configService.get<string>(
      'AWS_S3_BUCKET',
      'arya-documents',
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PUBLIC CONTRACT (consumed by orders/returns/jobs siblings)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Generate (or return the existing) GST tax invoice for a PAID order.
   *
   * IDEMPOTENT: exactly one TAX_INVOICE per order. If a tax invoice already
   * exists for the order it is returned as-is (no new number consumed, no
   * re-render). This makes the `store-invoice-generation` queue and the admin
   * endpoint safe to call repeatedly / concurrently.
   *
   * GAPLESS NUMBERING (architecture 4.11 / 8.3): inside a single $transaction we
   *   1. `INSERT ... ON CONFLICT DO NOTHING` the InvoiceSequence row for the
   *      current Indian financial year (FY-rollover-safe row creation),
   *   2. `SELECT ... FOR UPDATE` that row (the REAL serialization — advisory
   *      locks are session-scoped and 10 replicas can land in different Postgres
   *      sessions; the row lock holds across them),
   *   3. increment `lastValue` and format the number `ARYA/2026-27/000123`.
   * `@@unique([financialYear, sequenceNo])` + `invoiceNumber @unique` are the
   * backstops if two writers ever slip the row lock.
   *
   * Invoice lines are copied VERBATIM from the frozen OrderItem snapshots — tax
   * is NEVER re-computed (architecture 8.3). Seller GSTIN/name/state come from
   * the per-order frozen snapshot (single GSTIN, §14.1), falling back to
   * SiteSettings only for legacy orders; buyer identity comes from the order's
   * billing/shipping address.
   *
   * @throws NotFoundException order does not exist
   * @throws ConflictException order is not paid (INVOICE_ORDER_NOT_PAID)
   */
  async generateInvoice(orderId: string): Promise<Invoice> {
    this.assertUuid(orderId);

    // Fast idempotency path: return any existing tax invoice WITHOUT consuming a
    // sequence number or re-rendering. The PDF is (re)healed below if missing.
    const existing = await this.prisma.invoice.findFirst({
      where: { orderId, type: InvoiceType.TAX_INVOICE },
    });
    if (existing) {
      return this.ensurePdf(existing);
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Only PAID (or beyond) orders get a tax invoice. Accept PAID /
    // PARTIALLY_REFUNDED / REFUNDED (all imply a captured payment) or a non-null
    // paidAt — but reject UNPAID. This is a financial-record guard.
    const isPaid =
      order.paymentStatus === OrderPaymentStatus.PAID ||
      order.paymentStatus === OrderPaymentStatus.PARTIALLY_REFUNDED ||
      order.paymentStatus === OrderPaymentStatus.REFUNDED ||
      order.paidAt != null;
    if (!isPaid) {
      throw new ConflictException(
        'INVOICE_ORDER_NOT_PAID: an invoice can only be issued for a paid order',
      );
    }

    if (order.items.length === 0) {
      throw new ConflictException(
        'INVOICE_ORDER_EMPTY: order has no line items to invoice',
      );
    }

    const seller = await this.resolveSeller(order);
    const buyer = this.resolveBuyer(
      order.billingAddress,
      order.shippingAddress,
    );

    const financialYear = InvoicingService.financialYearFor(
      order.paidAt ?? order.createdAt,
    );

    // ── Numbering + persistence in one transaction. ──────────────────────────
    const invoiceId = await this.prisma.$transaction(async (tx) => {
      // Re-check inside the tx: a concurrent first-call may have just created the
      // invoice between our fast-path read and here. Guard before consuming a
      // sequence number.
      const racedExisting = await tx.invoice.findFirst({
        where: { orderId, type: InvoiceType.TAX_INVOICE },
        select: { id: true },
      });
      if (racedExisting) {
        return racedExisting.id;
      }

      const { sequenceNo, invoiceNumber } = await this.allocateNumber(
        tx,
        financialYear,
      );

      // Totals are SUMS of the verbatim per-line OrderItem snapshot amounts —
      // never re-derived from rates. No re-rounding of the sum (architecture 8.3).
      let taxableValue = 0;
      let cgstTotal = 0;
      let sgstTotal = 0;
      let igstTotal = 0;
      let grandTotal = 0;

      const lineCreates: Prisma.InvoiceLineCreateManyInvoiceInput[] =
        order.items.map((it) => {
          taxableValue += it.taxableValue;
          cgstTotal += it.cgstAmount;
          sgstTotal += it.sgstAmount;
          igstTotal += it.igstAmount;
          grandTotal += it.lineTotal;
          return {
            description: it.nameSnapshot,
            hsnCode: it.hsnCodeSnapshot,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            taxableValue: it.taxableValue,
            cgstBps: it.cgstBpsSnapshot,
            sgstBps: it.sgstBpsSnapshot,
            igstBps: it.igstBpsSnapshot,
            cgstAmount: it.cgstAmount,
            sgstAmount: it.sgstAmount,
            igstAmount: it.igstAmount,
            lineTotal: it.lineTotal,
          };
        });

      const created = await tx.invoice.create({
        data: {
          invoiceNumber,
          type: InvoiceType.TAX_INVOICE,
          status: InvoiceStatus.ISSUED,
          orderId: order.id,
          financialYear,
          sequenceNo,
          sellerName: seller.name,
          sellerGstin: seller.gstin,
          sellerStateCode: seller.stateCode,
          buyerName: buyer.name,
          buyerGstin: buyer.gstin,
          placeOfSupplyState: order.placeOfSupplyState ?? buyer.stateCode,
          isInterState: order.isInterState,
          taxableValue,
          cgstTotal,
          sgstTotal,
          igstTotal,
          grandTotal,
          issuedAt: new Date(),
          lines: { createMany: { data: lineCreates } },
        },
        select: { id: true },
      });

      return created.id;
    });

    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    return this.ensurePdf(invoice);
  }

  /**
   * Generate (or return the existing) CREDIT_NOTE for a received return
   * (architecture 4.10 / 4.11 / 4.12). Consumed by the `returns` sibling on
   * return-received per the cross-module CONTRACT.
   *
   * IDEMPOTENT: exactly one CREDIT_NOTE per Return. The note is deduped on a
   * stable `CN:{returnId}` marker stamped into `Invoice.buyerName` (the Invoice
   * model has no returnId column), both on the fast path and inside the tx before
   * a sequence number is consumed. It draws the SAME gapless FY sequence as tax
   * invoices. Lines + amounts are derived VERBATIM from the ReturnItem snapshots
   * (each scaled proportionally from its OrderItem snapshot by returned qty) —
   * never re-computed (architecture 8.3).
   *
   * @throws NotFoundException return (or its order) does not exist
   * @throws ConflictException return has no items to credit (CREDIT_NOTE_EMPTY)
   */
  async generateCreditNote(returnId: string): Promise<Invoice> {
    this.assertUuid(returnId);

    const ret = await this.prisma.return.findUnique({
      where: { id: returnId },
      include: {
        items: {
          include: {
            orderItem: true,
          },
        },
        order: true,
      },
    });
    if (!ret) {
      throw new NotFoundException('Return not found');
    }
    if (!ret.order) {
      throw new NotFoundException('Order not found for return');
    }
    if (ret.items.length === 0) {
      throw new ConflictException(
        'CREDIT_NOTE_EMPTY: return has no items to credit',
      );
    }

    // Idempotency: the Invoice model has no returnId column, so we stamp a stable
    // `CN:{returnId}` marker into the credit note's `buyerName` at creation and
    // dedupe on it here (and again inside the tx, before consuming a number). The
    // human-readable buyer name is rendered into the PDF from the resolved buyer
    // identity, not this column.
    const existing = await this.findCreditNoteForReturn(returnId, ret.orderId);
    if (existing) {
      return this.ensurePdf(existing);
    }

    const order = ret.order;
    const seller = await this.resolveSeller(order);
    const buyer = this.resolveBuyer(
      order.billingAddress,
      order.shippingAddress,
    );

    const financialYear = InvoicingService.financialYearFor(
      ret.receivedAt ?? ret.refundedAt ?? new Date(),
    );

    const invoiceId = await this.prisma.$transaction(async (tx) => {
      // Re-check inside the tx (concurrent first-call guard) before consuming a
      // sequence number.
      const raced = await tx.invoice.findFirst({
        where: {
          orderId: ret.orderId,
          type: InvoiceType.CREDIT_NOTE,
          buyerName: this.creditNoteMarker(returnId),
        },
        select: { id: true },
      });
      if (raced) {
        return raced.id;
      }

      const { sequenceNo, invoiceNumber } = await this.allocateNumber(
        tx,
        financialYear,
      );

      // Credit-note lines derive VERBATIM from the ReturnItem refund snapshots,
      // which themselves come from the OrderItem snapshots — never re-computed.
      let taxableValue = 0;
      let cgstTotal = 0;
      let sgstTotal = 0;
      let igstTotal = 0;
      let grandTotal = 0;

      const lineCreates: Prisma.InvoiceLineCreateManyInvoiceInput[] =
        ret.items.map((ri) => {
          const oi = ri.orderItem;
          // Per-returned-unit proportional share of the original line's amounts.
          // OrderItem amounts are for `oi.quantity` units; scale by the returned
          // quantity using integer largest-remainder-free proportional split.
          const qty = ri.quantity;
          const share = (total: number) =>
            oi.quantity > 0 ? Math.round((total * qty) / oi.quantity) : 0;

          const lineTaxable = share(oi.taxableValue);
          const lineCgst = share(oi.cgstAmount);
          const lineSgst = share(oi.sgstAmount);
          const lineIgst = share(oi.igstAmount);
          const lineTotal = lineTaxable + lineCgst + lineSgst + lineIgst;

          taxableValue += lineTaxable;
          cgstTotal += lineCgst;
          sgstTotal += lineSgst;
          igstTotal += lineIgst;
          grandTotal += lineTotal;

          return {
            description: oi.nameSnapshot,
            hsnCode: oi.hsnCodeSnapshot,
            quantity: qty,
            unitPrice: oi.unitPrice,
            taxableValue: lineTaxable,
            cgstBps: oi.cgstBpsSnapshot,
            sgstBps: oi.sgstBpsSnapshot,
            igstBps: oi.igstBpsSnapshot,
            cgstAmount: lineCgst,
            sgstAmount: lineSgst,
            igstAmount: lineIgst,
            lineTotal,
          };
        });

      const created = await tx.invoice.create({
        data: {
          invoiceNumber,
          type: InvoiceType.CREDIT_NOTE,
          status: InvoiceStatus.ISSUED,
          orderId: order.id,
          financialYear,
          sequenceNo,
          sellerName: seller.name,
          sellerGstin: seller.gstin,
          sellerStateCode: seller.stateCode,
          // The credit-note's source return id is stamped into `buyerName` as a
          // dedupe marker (the Invoice model has no returnId column). The human
          // buyer name is rendered from the resolved buyer identity in the PDF.
          buyerName: this.creditNoteMarker(returnId),
          buyerGstin: buyer.gstin,
          placeOfSupplyState: order.placeOfSupplyState ?? buyer.stateCode,
          isInterState: order.isInterState,
          taxableValue,
          cgstTotal,
          sgstTotal,
          igstTotal,
          grandTotal,
          issuedAt: new Date(),
          lines: { createMany: { data: lineCreates } },
        },
        select: { id: true },
      });

      return created.id;
    });

    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    return this.ensurePdf(invoice, buyer.name);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADMIN: issue + regenerate-link + list
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Admin entry point. Generates the invoice (idempotent) and returns it with a
   * fresh presigned download URL. Generation never re-numbers or re-renders an
   * already-stored PDF.
   */
  async issueForAdmin(
    orderId: string,
  ): Promise<Invoice & { downloadUrl: string | null }> {
    const invoice = await this.generateInvoice(orderId);
    const downloadUrl = invoice.pdfS3Key
      ? await this.presignDownload(invoice.pdfS3Key)
      : null;
    return { ...invoice, downloadUrl };
  }

  /**
   * Paginated admin invoice list with optional status/type/FY/search filters.
   * Pagination defaults are owned by ListInvoicesDto (page=1, pageSize=20).
   */
  async listInvoices(query: ListInvoicesDto) {
    // The DTO is authoritative for defaults (page = 1, pageSize = 20) and the
    // global ValidationPipe runs with `transform: true`, so these are always set
    // at runtime — assert to satisfy the static type without re-defaulting here.
    const page = query.page!;
    const pageSize = query.pageSize!;

    const where: Prisma.InvoiceWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.financialYear) where.financialYear = query.financialYear;
    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { invoiceNumber: { contains: term, mode: 'insensitive' } },
        { buyerName: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          invoiceNumber: true,
          type: true,
          status: true,
          orderId: true,
          financialYear: true,
          sequenceNo: true,
          buyerName: true,
          buyerGstin: true,
          isInterState: true,
          taxableValue: true,
          cgstTotal: true,
          sgstTotal: true,
          igstTotal: true,
          grandTotal: true,
          issuedAt: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // OWNER: presigned download
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Owner-facing presigned download for an order's tax invoice. Authorization
   * (the caller actually owns the order) is enforced at the controller by
   * InvoiceAccessGuard — this method trusts the resolved order id.
   *
   * If the invoice exists but the PDF render previously failed (pdfS3Key null),
   * a render is attempted lazily so the owner is never stuck behind a transient
   * PutObject failure.
   *
   * @throws NotFoundException no invoice for the order
   */
  async getDownloadForOrder(orderId: string): Promise<InvoiceDownload> {
    this.assertUuid(orderId);

    let invoice = await this.prisma.invoice.findFirst({
      where: { orderId, type: InvoiceType.TAX_INVOICE },
    });
    if (!invoice) {
      throw new NotFoundException('No invoice has been issued for this order');
    }

    if (!invoice.pdfS3Key) {
      // Lazy heal a missing PDF. ensurePdf renders + stores + returns the patched
      // row; on a successful render pdfS3Key is guaranteed non-null (PutObject
      // failure throws), so no second null-guard is needed.
      invoice = await this.ensurePdf(invoice);
    }

    const downloadUrl = await this.presignDownload(invoice.pdfS3Key as string);
    return {
      invoiceNumber: invoice.invoiceNumber,
      issuedAt: invoice.issuedAt,
      grandTotal: invoice.grandTotal,
      downloadUrl,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTERNALS — numbering, PDF lifecycle, identity resolution
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Render + store the PDF for an invoice IF not already stored (idempotent for
   * the raced/duplicate path). A duplicate caller never clobbers a stored PDF: we
   * only render when `pdfS3Key` is null AND the row is not already an ISSUED
   * invoice with a key. PDF failure surfaces a 500 so the queue retries the
   * render against the SAME invoice (the gapless number is already durable).
   *
   * @param renderBuyerName overrides the buyer-name rendered in the PDF (used by
   *   credit notes, whose `buyerName` column holds a dedupe marker).
   */
  private async ensurePdf(
    invoice: Invoice,
    renderBuyerName?: string,
  ): Promise<Invoice> {
    // Idempotency: skip the render block entirely for an already-rendered ISSUED
    // invoice. Guards the race where a concurrent winner's PutObject is still
    // in-flight — we never launch a second PutObject to the same key.
    if (invoice.status === InvoiceStatus.ISSUED && invoice.pdfS3Key) {
      return invoice;
    }
    if (invoice.pdfS3Key) {
      return invoice;
    }

    const lines = await this.prisma.invoiceLine.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { createdAt: 'asc' },
    });
    const seller: SellerIdentity = {
      name: invoice.sellerName,
      gstin: invoice.sellerGstin,
      stateCode: invoice.sellerStateCode,
      address: null,
    };
    // Re-resolve the seller address (presentation only) + buyer for rendering.
    const sellerAddress = await this.settings.get(SELLER_ADDRESS_SETTING_KEY);
    seller.address = sellerAddress?.trim() || null;

    const buyer: BuyerIdentity = {
      name: renderBuyerName ?? invoice.buyerName,
      gstin: invoice.buyerGstin,
      stateCode: invoice.placeOfSupplyState,
      addressLines: [],
    };

    try {
      const pdfBuffer = await this.renderInvoicePdf(
        { ...invoice, lines },
        seller,
        buyer,
      );
      const s3Key = this.buildS3Key(invoice);
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
        }),
      );
      const updated = await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { pdfS3Key: s3Key },
      });
      return updated;
    } catch (e) {
      this.logger.error(
        `Failed to render/store invoice PDF for ${invoice.invoiceNumber}: ${
          (e as Error)?.message
        }`,
      );
      throw new InternalServerErrorException(
        'Invoice was numbered but the PDF could not be generated; retry to render',
      );
    }
  }

  /**
   * Build the S3 key for an invoice PDF. The invoice number is server-generated
   * (`ARYA/2026-27/000123`); we still assert the prefix matches the whitelist so
   * a path-traversal value can never produce a traversing key.
   */
  private buildS3Key(invoice: Invoice): string {
    const prefix = invoice.invoiceNumber.split('/')[0] ?? '';
    if (!INVOICE_PREFIX_PATTERN.test(prefix)) {
      throw new InternalServerErrorException(
        'Invoice number prefix is malformed; refusing to build a storage key',
      );
    }
    const safeNumber = invoice.invoiceNumber.replace(/\//g, '-');
    return `invoices/${invoice.financialYear}/${safeNumber}.pdf`;
  }

  /**
   * Allocate the next gapless sequence number for a financial year, INSIDE the
   * caller's transaction. The `SELECT ... FOR UPDATE` on the InvoiceSequence row
   * is the authoritative cross-replica serializer; a tx-scoped advisory lock adds
   * defense-in-depth. New-FY row created via INSERT ... ON CONFLICT DO NOTHING
   * then locked FOR UPDATE (FY-rollover-safe). The CAS on `last_value` is a final
   * backstop against a slipped row lock.
   */
  private async allocateNumber(
    tx: Prisma.TransactionClient,
    financialYear: string,
  ): Promise<{ sequenceNo: number; invoiceNumber: string }> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice_seq_${financialYear}`}))`;

    await tx.$executeRaw`
      INSERT INTO invoice_sequences (financial_year, last_value, prefix, updated_at)
      VALUES (${financialYear}, 0, 'ARYA', NOW())
      ON CONFLICT (financial_year) DO NOTHING
    `;

    const lockedRows = await tx.$queryRaw<
      { last_value: number; prefix: string }[]
    >`
      SELECT last_value, prefix
      FROM invoice_sequences
      WHERE financial_year = ${financialYear}
      FOR UPDATE
    `;
    if (lockedRows.length === 0) {
      throw new InternalServerErrorException(
        'Invoice sequence row missing after upsert',
      );
    }

    const prefix = lockedRows[0].prefix ?? 'ARYA';
    const nextValue = Number(lockedRows[0].last_value) + 1;

    const bumped = await tx.$executeRaw`
      UPDATE invoice_sequences
      SET last_value = ${nextValue}, updated_at = NOW()
      WHERE financial_year = ${financialYear} AND last_value = ${nextValue - 1}
    `;
    if (bumped !== 1) {
      throw new InternalServerErrorException(
        'Invoice sequence CAS failed (internal invariant violation: the FOR UPDATE row lock should make this unreachable)',
      );
    }

    const invoiceNumber = InvoicingService.formatInvoiceNumber(
      prefix,
      financialYear,
      nextValue,
    );
    return { sequenceNo: nextValue, invoiceNumber };
  }

  private async presignDownload(s3Key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: s3Key });
    return getSignedUrl(this.s3, command, {
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    });
  }

  /**
   * Resolve seller identity, PREFERRING the per-order frozen snapshot
   * (`Order.sellerGstinSnapshot` / `Order.sellerStateCode`) so the invoice never
   * diverges from the seller the Razorpay-verified amount originated from. Falls
   * back to the single configured SiteSettings identity (single-GSTIN, §14.1)
   * only when the snapshot is null (legacy orders). Name/address are presentation
   * and always come from SiteSettings.
   */
  private async resolveSeller(
    order: OrderSellerSnapshot,
  ): Promise<SellerIdentity> {
    const [name, settingGstin, settingState, address] = await Promise.all([
      this.settings.get(SELLER_NAME_SETTING_KEY),
      this.settings.get(SELLER_GSTIN_SETTING_KEY),
      this.settings.get(SELLER_STATE_CODE_SETTING_KEY),
      this.settings.get(SELLER_ADDRESS_SETTING_KEY),
    ]);

    // Prefer the frozen-at-order-time snapshot over the live setting.
    const gstin =
      order.sellerGstinSnapshot?.trim() || settingGstin?.trim() || null;

    let stateCode =
      order.sellerStateCode?.trim() || settingState?.trim() || null;
    if (!stateCode && gstin && gstin.length >= 2) {
      stateCode = gstin.slice(0, 2);
    }

    return {
      name: name?.trim() || FALLBACK_SELLER_NAME,
      gstin,
      stateCode,
      address: address?.trim() || null,
    };
  }

  /**
   * Extract buyer identity from the order's billing (preferred) / shipping
   * address JSON. The JSON is a snapshot frozen at checkout; we read tolerantly
   * (Address-row shape or free-form) and never trust it for tax — only for
   * presentation + place-of-supply display.
   */
  private resolveBuyer(
    billing: Prisma.JsonValue,
    shipping: Prisma.JsonValue,
  ): BuyerIdentity {
    const src = this.asRecord(billing) ?? this.asRecord(shipping) ?? {};

    const composedName = [this.str(src.firstName), this.str(src.lastName)]
      .filter(Boolean)
      .join(' ')
      .trim();
    const name =
      this.str(src.fullName) ??
      this.str(src.name) ??
      (composedName.length > 0 ? composedName : 'Customer');

    const gstin = this.str(src.gstin) ?? this.str(src.buyerGstin) ?? null;
    const stateCode = this.str(src.stateCode) ?? this.str(src.state) ?? null;

    const addressLines = [
      this.str(src.line1) ?? this.str(src.addressLine1),
      this.str(src.line2) ?? this.str(src.addressLine2),
      [
        this.str(src.city),
        this.str(src.stateCode) ?? this.str(src.state),
        this.str(src.postalCode) ?? this.str(src.pincode) ?? this.str(src.zip),
      ]
        .filter(Boolean)
        .join(', '),
      this.str(src.country),
    ].filter((l): l is string => !!l && l.trim().length > 0);

    return { name, gstin, stateCode, addressLines };
  }

  private asRecord(v: Prisma.JsonValue): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  }

  private str(v: unknown): string | undefined {
    if (typeof v === 'string') {
      const t = v.trim();
      return t.length > 0 ? t : undefined;
    }
    if (typeof v === 'number') return String(v);
    return undefined;
  }

  /** Deterministic dedupe marker stamped into a credit note's buyerName column. */
  private creditNoteMarker(returnId: string): string {
    return `CN:${returnId}`;
  }

  /** Look up an existing CREDIT_NOTE for a given return (idempotency). */
  private async findCreditNoteForReturn(
    returnId: string,
    orderId: string,
  ): Promise<Invoice | null> {
    return this.prisma.invoice.findFirst({
      where: {
        orderId,
        type: InvoiceType.CREDIT_NOTE,
        buyerName: this.creditNoteMarker(returnId),
      },
    });
  }

  private assertUuid(id: string): void {
    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
      throw new BadRequestException('A valid id is required');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PDF RENDERING (presentation only — never computes tax)
  // ──────────────────────────────────────────────────────────────────────────

  /** Column layout shared by header + line rows. */
  private static readonly PDF_PAGE_BREAK_MARGIN = 120;

  /**
   * Render a GST tax-invoice / credit-note PDF with pdfkit into a Buffer. Pure
   * presentation over already-persisted Invoice + InvoiceLine amounts (paise →
   * rupees only at this display boundary). Never computes tax. Split into focused
   * sub-renderers for maintainability.
   */
  private renderInvoicePdf(
    invoice: Invoice & { lines: InvoiceLine[] },
    seller: SellerIdentity,
    buyer: BuyerIdentity,
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (e) => reject(e));

        const left = doc.page.margins.left;
        const right = doc.page.width - doc.page.margins.right;
        const colX = {
          desc: left,
          hsn: left + 190,
          qty: left + 250,
          taxable: left + 290,
          tax: left + 380,
          total: right - 70,
        };

        this.renderHeader(doc, invoice, seller);
        this.renderBillTo(doc, invoice, buyer);
        this.renderLineTable(doc, invoice, colX, left, right);
        this.renderTotals(doc, invoice, colX);
        this.renderTaxSummary(doc, invoice);
        this.renderFooter(doc);

        doc.end();
      } catch (e) {
        reject(e as Error);
      }
    });
  }

  /** 'Rs.' rather than U+20B9 (absent from Helvetica's WinAnsi encoding). */
  private static rupees(paise: number): string {
    const sign = paise < 0 ? '-' : '';
    return `${sign}Rs. ${(Math.abs(paise) / 100).toFixed(2)}`;
  }

  private renderHeader(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    seller: SellerIdentity,
  ): void {
    doc.fontSize(20).text(seller.name, { continued: false });
    doc.moveDown(0.2);
    doc.fontSize(9);
    if (seller.address) doc.text(seller.address);
    if (seller.gstin) doc.text(`GSTIN: ${seller.gstin}`);
    if (seller.stateCode) doc.text(`State Code: ${seller.stateCode}`);

    doc.moveDown(0.5);
    const title =
      invoice.type === InvoiceType.CREDIT_NOTE ? 'CREDIT NOTE' : 'TAX INVOICE';
    doc.fontSize(14).text(title, { align: 'right' });
    doc.fontSize(9);
    doc.text(`Invoice No: ${invoice.invoiceNumber}`, { align: 'right' });
    doc.text(
      `Date: ${(invoice.issuedAt ?? invoice.createdAt)
        .toISOString()
        .slice(0, 10)}`,
      { align: 'right' },
    );
    doc.text(`Financial Year: ${invoice.financialYear}`, { align: 'right' });
  }

  private renderBillTo(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    buyer: BuyerIdentity,
  ): void {
    doc.moveDown(1);
    doc.fontSize(10).text('Bill To:', { underline: true });
    doc.fontSize(9).text(buyer.name);
    for (const line of buyer.addressLines) doc.text(line);
    if (buyer.gstin) doc.text(`GSTIN: ${buyer.gstin}`);
    if (invoice.placeOfSupplyState) {
      doc.text(`Place of Supply (State Code): ${invoice.placeOfSupplyState}`);
    }
    doc.text(
      `Supply Type: ${
        invoice.isInterState
          ? 'Inter-State (IGST)'
          : 'Intra-State (CGST + SGST)'
      }`,
    );
  }

  private renderLineTable(
    doc: PDFKit.PDFDocument,
    invoice: Invoice & { lines: InvoiceLine[] },
    colX: Record<string, number>,
    left: number,
    right: number,
  ): void {
    const drawHeader = () => {
      // Capture rowY BEFORE the first text call so every column aligns to the
      // same row even when the Description wraps to multiple lines.
      const rowY = doc.y;
      doc.fontSize(8).fillColor('#000');
      doc.text('HSN', colX.hsn, rowY, { width: 55 });
      doc.text('Qty', colX.qty, rowY, { width: 35 });
      doc.text('Taxable', colX.taxable, rowY, { width: 85 });
      doc.text(invoice.isInterState ? 'IGST' : 'CGST+SGST', colX.tax, rowY, {
        width: 95,
      });
      doc.text('Total', colX.total, rowY, { width: 70, align: 'right' });
      // Description LAST so its (possibly multi-line) cursor advance defines the
      // bottom of the header row.
      doc.text('Description', colX.desc, rowY, { width: 185 });
    };

    doc.moveDown(1);
    drawHeader();
    doc
      .moveTo(left, doc.y + 2)
      .lineTo(right, doc.y + 2)
      .stroke();
    doc.moveDown(0.5);

    for (const line of invoice.lines) {
      if (doc.y > doc.page.height - InvoicingService.PDF_PAGE_BREAK_MARGIN) {
        doc.addPage();
        drawHeader();
        doc
          .moveTo(left, doc.y + 2)
          .lineTo(right, doc.y + 2)
          .stroke();
        doc.moveDown(0.5);
      }
      // rowY captured BEFORE the first text call so all columns share the row.
      const rowY = doc.y;
      doc.fontSize(8);
      doc.text(line.hsnCode ?? '-', colX.hsn, rowY, { width: 55 });
      doc.text(String(line.quantity), colX.qty, rowY, { width: 35 });
      doc.text(InvoicingService.rupees(line.taxableValue), colX.taxable, rowY, {
        width: 85,
      });
      const taxAmt = invoice.isInterState
        ? line.igstAmount
        : line.cgstAmount + line.sgstAmount;
      doc.text(InvoicingService.rupees(taxAmt), colX.tax, rowY, { width: 95 });
      doc.text(InvoicingService.rupees(line.lineTotal), colX.total, rowY, {
        width: 70,
        align: 'right',
      });
      // Description LAST: its cursor advance (single OR wrapped) defines the row
      // height, so the next row starts below the tallest cell.
      doc.text(line.description, colX.desc, rowY, { width: 185 });
      doc.moveDown(0.6);
    }

    doc
      .moveTo(left, doc.y + 2)
      .lineTo(right, doc.y + 2)
      .stroke();
    doc.moveDown(0.5);
  }

  private renderTotals(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    colX: Record<string, number>,
  ): void {
    const totalLine = (label: string, value: string, bold = false) => {
      doc.fontSize(9);
      if (bold) doc.font('Helvetica-Bold');
      const ry = doc.y;
      doc.text(value, colX.total - 40, ry, { width: 110, align: 'right' });
      doc.text(label, colX.taxable, ry, { width: 130 });
      if (bold) doc.font('Helvetica');
    };

    totalLine('Taxable Value', InvoicingService.rupees(invoice.taxableValue));
    if (invoice.isInterState) {
      totalLine('IGST', InvoicingService.rupees(invoice.igstTotal));
    } else {
      totalLine('CGST', InvoicingService.rupees(invoice.cgstTotal));
      totalLine('SGST', InvoicingService.rupees(invoice.sgstTotal));
    }
    totalLine('Grand Total', InvoicingService.rupees(invoice.grandTotal), true);
  }

  private renderTaxSummary(
    doc: PDFKit.PDFDocument,
    invoice: Invoice & { lines: InvoiceLine[] },
  ): void {
    doc.moveDown(1);
    doc.fontSize(9).font('Helvetica-Bold').text('Tax Summary');
    doc.font('Helvetica').fontSize(8);
    const byRate = this.summariseByRate(invoice.lines, invoice.isInterState);
    for (const row of byRate) {
      doc.text(
        `Rate ${(row.bps / 100).toFixed(2)}%  |  Taxable ${InvoicingService.rupees(
          row.taxable,
        )}  |  Tax ${InvoicingService.rupees(row.tax)}`,
      );
    }
  }

  private renderFooter(doc: PDFKit.PDFDocument): void {
    doc.moveDown(2);
    doc
      .fontSize(7)
      .fillColor('#666')
      .text(
        'This is a computer-generated document and does not require a signature.',
        { align: 'center' },
      );
  }

  /**
   * Group invoice lines by effective GST rate (bps) for the tax summary block.
   * Sums the verbatim per-line amounts — no recomputation.
   */
  private summariseByRate(
    lines: InvoiceLine[],
    isInterState: boolean,
  ): { bps: number; taxable: number; tax: number }[] {
    const map = new Map<number, { taxable: number; tax: number }>();
    for (const line of lines) {
      const bps = isInterState ? line.igstBps : line.cgstBps + line.sgstBps;
      const tax = isInterState
        ? line.igstAmount
        : line.cgstAmount + line.sgstAmount;
      const cur = map.get(bps) ?? { taxable: 0, tax: 0 };
      cur.taxable += line.taxableValue;
      cur.tax += tax;
      map.set(bps, cur);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bps, v]) => ({ bps, taxable: v.taxable, tax: v.tax }));
  }

  /**
   * Indian financial year (1 April – 31 March) for a date, formatted 'YYYY-YY'.
   * Computed in IST (UTC+5:30) — a payment captured between 00:00 and 05:29 IST
   * on 1 April must land in the NEW financial year, not the ending one. Using UTC
   * directly would mis-stamp the FY for that boundary window on a legal document.
   * e.g. 2026-06-04 → '2026-27'; 2026-02-15 → '2025-26'.
   */
  static financialYearFor(date: Date): string {
    const ist = new Date(date.getTime() + IST_OFFSET_MS);
    const month = ist.getUTCMonth(); // 0 = Jan, in IST wall-clock
    const year = ist.getUTCFullYear();
    const startYear = month >= 3 ? year : year - 1; // April (idx 3) onward
    const endYY = String((startYear + 1) % 100).padStart(2, '0');
    return `${startYear}-${endYY}`;
  }

  static formatInvoiceNumber(
    prefix: string,
    financialYear: string,
    seq: number,
  ): string {
    return `${prefix}/${financialYear}/${String(seq).padStart(6, '0')}`;
  }
}
