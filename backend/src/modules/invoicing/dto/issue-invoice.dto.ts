/**
 * Body for `POST /api/admin/store/orders/:orderId/invoice`.
 *
 * Invoice generation is fully idempotent and ENTIRELY server-derived: the number,
 * tax amounts, seller/buyer identity, and PDF are all computed from the frozen
 * OrderItem snapshots + the order's seller snapshot (SiteSettings fallback). No
 * client-supplied field can influence any of them, so this DTO is intentionally
 * empty. The global ValidationPipe runs with `forbidNonWhitelisted: true`, so any
 * stray body field is rejected with 400 (least-surprise: no silent ignored input).
 *
 * A fresh presigned download URL is ALWAYS returned on every call, so there is no
 * need for a "regenerate link" flag — re-issuing is the same idempotent call.
 */
export class IssueInvoiceDto {}
