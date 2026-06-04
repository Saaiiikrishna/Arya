/**
 * Internal SiteSettings key names for the single configured seller identity
 * (decision §14.1: SINGLE GSTIN, single-state, v1). These are implementation
 * details of how invoicing resolves the FALLBACK seller identity from
 * SiteSettings when an order predates the `Order.sellerGstinSnapshot` column.
 *
 * The GSTIN + state-code keys are SHARED with the tax module
 * (`store.sellerGstin` / `store.sellerStateCode`) so a legacy-order fallback
 * resolves the exact same single GSTIN the tax engine computed against — never a
 * divergent value. The name/address keys are invoice-presentation only.
 *
 * NOT re-exported from the module barrel: the orders / returns / jobs siblings
 * have no reason to know these key names (encapsulation — they consume
 * `InvoicingService` methods, not its settings keys).
 */
export const SELLER_GSTIN_SETTING_KEY = 'store.sellerGstin';
export const SELLER_STATE_CODE_SETTING_KEY = 'store.sellerStateCode';
export const SELLER_NAME_SETTING_KEY = 'store.sellerName';
export const SELLER_ADDRESS_SETTING_KEY = 'store.sellerAddress';

/** Presigned invoice-download URL validity (1 hour), matching DocumentService. */
export const DOWNLOAD_URL_TTL_SECONDS = 3600;

/** Hard fallback seller display name if `store.sellerName` is unconfigured. */
export const FALLBACK_SELLER_NAME = 'Aryavartham';

/**
 * Whitelist for a server-generated invoice-sequence prefix before it is
 * interpolated into an S3 key. The prefix is read from `invoice_sequences.prefix`
 * (DB column); asserting the format defends the S3 key against a path-traversal
 * value (e.g. '../admin') if the column is ever written through another path.
 */
export const INVOICE_PREFIX_PATTERN = /^[A-Z0-9]{1,10}$/;
