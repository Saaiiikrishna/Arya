/**
 * Shipping module constants (architecture 4.9 / 8.4).
 */

/**
 * DI token for the active {@link CourierProvider}. The provider is selected by a
 * factory (see courier.factory.ts) from SiteSettings (`store.courierProvider`)
 * with an env fallback (`COURIER_PROVIDER`), defaulting to 'manual'.
 */
export const COURIER_PROVIDER = Symbol('COURIER_PROVIDER');

/**
 * SiteSettings key selecting the active courier provider ('manual' | 'shiprocket').
 * Env var `COURIER_PROVIDER` is the fallback when the setting is absent.
 */
export const COURIER_PROVIDER_SETTING_KEY = 'store.courierProvider';

/** NumberSequence scope + prefix for human-readable shipment numbers (AS-000001). */
export const SHIPMENT_SEQUENCE_SCOPE = 'SHIPMENT';
export const SHIPMENT_SEQUENCE_PREFIX = 'AS';

/**
 * Resolve the config key holding the HMAC secret for a courier webhook.
 *
 * Per-provider isolation: the named webhook variant
 * (`POST /api/store/webhooks/courier/:courier`) carries the provider key, so a
 * Delhivery callback can be verified with `DELHIVERY_WEBHOOK_SECRET` while a
 * Shiprocket callback uses `SHIPROCKET_WEBHOOK_SECRET`. When a provider-specific
 * secret is absent the service falls back to the shared `COURIER_WEBHOOK_SECRET`.
 *
 * The provider key is sanitized to `[A-Z0-9_]` so it can never inject an
 * arbitrary env-var name (or a log-forging control sequence).
 */
export function courierWebhookSecretKey(providerKey?: string): string | null {
  if (!providerKey) return null;
  const safe = providerKey
    .replace(/[^a-z0-9_]/gi, '')
    .toUpperCase()
    .slice(0, 50);
  return safe.length > 0 ? `${safe}_WEBHOOK_SECRET` : null;
}

/** The shared fallback courier webhook HMAC secret env key. */
export const COURIER_WEBHOOK_SECRET_KEY = 'COURIER_WEBHOOK_SECRET';

/** Max length bounds for courier-supplied strings persisted to ShipmentEvent. */
export const COURIER_EVENT_DESCRIPTION_MAX = 1000;
export const COURIER_EVENT_LOCATION_MAX = 200;
export const COURIER_EVENT_ID_MAX = 255;
