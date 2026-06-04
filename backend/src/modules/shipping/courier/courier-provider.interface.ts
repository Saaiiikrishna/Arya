import type { Courier, Order } from '@prisma/client';

/**
 * One tracking checkpoint as returned by a courier (architecture 4.9 / 8.4).
 * `courierEventId` is the courier-side stable id used for idempotent ingest; when
 * a courier does not supply one the shipping service synthesizes a stable id
 * (sha256 of shipmentId+code+occurredAt) so the `@@unique([shipmentId,
 * courierEventId])` constraint never sees NULL (M2a caveat).
 */
export interface CourierTrackingEvent {
  /** Raw courier status code (provider-specific, e.g. 'OFD', 'DLVD'). */
  code: string;
  /** Mapped/canonical status string the service maps to a ShipmentStatus. */
  status: string;
  /** Human-readable checkpoint description. */
  description?: string;
  /** When the checkpoint occurred (courier timestamp). */
  occurredAt: Date;
  /** Courier-side unique id for this event; absent → service synthesizes one. */
  courierEventId?: string;
  /** Optional location string. */
  location?: string;
  /** The raw provider payload for this event, persisted for audit/debug. */
  raw?: unknown;
}

/** Result of creating a shipment with a courier. */
export interface CreateShipmentResult {
  /** Air-waybill / tracking number assigned by the courier. */
  awb: string;
  /** Public tracking URL, if the courier provides one. */
  trackingUrl?: string;
  /** Label PDF URL (provider-hosted) or null; S3 label storage is a future hook. */
  labelUrl?: string;
}

/**
 * Courier abstraction (architecture 8.4). Implementations:
 *  - {@link ManualCourierProvider}    admin supplies AWB/courier manually.
 *  - ShiprocketProvider               config-driven Shiprocket adapter (gated).
 *
 * The active provider is resolved via the COURIER_PROVIDER DI token by a factory
 * from SiteSettings/env (default 'manual').
 */
export interface CourierProvider {
  /** The courier this provider represents (for defaulting Shipment.courier). */
  readonly courier: Courier;
  /** Stable provider key matched against SiteSettings/env ('manual'|'shiprocket'). */
  readonly key: string;

  /**
   * Create a shipment with the courier. The order is passed so the provider can
   * read addresses / weights / line items. Returns the assigned AWB (+ optional
   * tracking/label URLs).
   *
   * @throws ServiceUnavailableException 'courier not configured' when the provider
   *         requires credentials that are absent — callers fall back to manual.
   */
  createShipment(order: OrderWithItems): Promise<CreateShipmentResult>;

  /**
   * Fetch tracking checkpoints for an AWB. Manual provider returns []; remote
   * providers return the courier's checkpoint list (newest or oldest first — the
   * shipping service dedupes + orders them).
   *
   * @throws ServiceUnavailableException 'courier not configured' when gated.
   */
  getTracking(awb: string): Promise<CourierTrackingEvent[]>;
}

/** The order shape courier providers consume (order + its items + shipping address). */
export type OrderWithItems = Order & {
  items?: { skuCodeSnapshot: string; nameSnapshot: string; quantity: number }[];
};
