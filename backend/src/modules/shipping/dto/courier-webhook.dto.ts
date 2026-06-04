/**
 * Courier webhook payload (POST /api/store/webhooks/courier).
 *
 * Courier payloads are provider-specific and not under our control, so this is a
 * permissive structural type rather than a strictly-validated class DTO — the
 * shipping service maps the relevant fields per provider and ignores the rest.
 * The route reads the RAW body for HMAC verification (when a secret is
 * configured) BEFORE this parsed shape is consumed.
 *
 * The canonical (provider-agnostic) shape the service understands:
 *   { awb, events: [{ code, status, description?, occurredAt, courierEventId?, location? }] }
 * Adapters for named couriers translate their native payloads into this shape.
 */
export interface CourierWebhookEventDto {
  code?: string;
  status?: string;
  description?: string;
  occurredAt?: string | number | Date;
  courierEventId?: string | number;
  location?: string;
}

export interface CourierWebhookDto {
  /** The AWB the events belong to. Falls back to top-level identifiers per adapter. */
  awb?: string;
  /** Tracking checkpoints. */
  events?: CourierWebhookEventDto[];
  /** Some providers send a single status update rather than an events array. */
  status?: string;
  code?: string;
  occurredAt?: string | number | Date;
  courierEventId?: string | number;
  description?: string;
  location?: string;
  /** Provider-specific extras retained for the raw payload. */
  [key: string]: unknown;
}
