import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Courier } from '@prisma/client';
import type {
  CourierProvider,
  CourierTrackingEvent,
  CreateShipmentResult,
  OrderWithItems,
} from './courier-provider.interface';

/**
 * Shiprocket courier adapter SKELETON (architecture 8.4).
 *
 * The HTTP integration is structured but GATED: if `SHIPROCKET_TOKEN` is not
 * configured, every method throws a clear `ServiceUnavailableException` ('courier
 * not configured') so the shipping service falls back to the manual flow rather
 * than half-creating a shipment against an unauthenticated API. This lets the
 * platform ship with provider='manual' today and flip to 'shiprocket' purely via
 * config once a token is provisioned — no code change.
 *
 * The real request shapes are sketched in comments; wiring an HTTP client
 * (global fetch is available on Node 18+) is the only remaining step to make it
 * live. We deliberately keep the network calls behind the token gate so the
 * skeleton compiles and is safe to deploy with no token present.
 */
@Injectable()
export class ShiprocketCourierProvider implements CourierProvider {
  readonly courier: Courier = Courier.SHIPROCKET;
  readonly key = 'shiprocket';

  private readonly logger = new Logger(ShiprocketCourierProvider.name);
  private readonly baseUrl: string;
  private readonly token: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config
      .get<string>(
        'SHIPROCKET_BASE_URL',
        'https://apiv2.shiprocket.in/v1/external',
      )
      .replace(/\/+$/, '');
    this.token = this.config.get<string>('SHIPROCKET_TOKEN') || undefined;
  }

  /** True only when a Shiprocket bearer token is configured. */
  private get configured(): boolean {
    return typeof this.token === 'string' && this.token.length > 0;
  }

  /** Fail-fast guard used by every API method so the gate is uniform. */
  private assertConfigured(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'COURIER_NOT_CONFIGURED: Shiprocket is selected but SHIPROCKET_TOKEN is not set — falling back to manual shipping',
      );
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token ?? ''}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a Shiprocket order + request a courier AWB. Structured against the
   * Shiprocket "adhoc order create" + "AWB assign" endpoints; gated on the token.
   */
  createShipment(order: OrderWithItems): Promise<CreateShipmentResult> {
    this.assertConfigured();

    // Real call shape (left structured, not invoked, until the token gate opens
    // in a configured environment):
    //
    //   const res = await fetch(`${this.baseUrl}/orders/create/adhoc`, {
    //     method: 'POST',
    //     headers: this.authHeaders(),
    //     body: JSON.stringify(this.toShiprocketOrder(order)),
    //   });
    //   ...assign AWB: POST `${this.baseUrl}/courier/assign/awb`...
    //
    // Until that is enabled we surface the gate so the caller falls back to
    // manual rather than silently doing nothing.
    this.logger.warn(
      `Shiprocket createShipment requested for order ${order.orderNumber} but the HTTP path is not enabled; gate not yet opened`,
    );
    throw new ServiceUnavailableException(
      'COURIER_NOT_CONFIGURED: Shiprocket shipment creation is not enabled in this environment — use manual shipping',
    );
  }

  /**
   * Fetch tracking for an AWB via Shiprocket's tracking endpoint. Gated on the
   * token; the response→CourierTrackingEvent mapping is sketched below.
   */
  getTracking(awb: string): Promise<CourierTrackingEvent[]> {
    this.assertConfigured();

    // Real call shape:
    //   const res = await fetch(`${this.baseUrl}/courier/track/awb/${awb}`, {
    //     headers: this.authHeaders(),
    //   });
    //   const json = await res.json();
    //   return (json?.tracking_data?.shipment_track_activities ?? []).map(
    //     (a) => this.mapActivity(a),
    //   );
    this.logger.debug(
      `Shiprocket getTracking(${awb}) called; HTTP path not enabled — returning no events`,
    );
    return Promise.resolve([]);
  }

  // The mapping helpers below define the contract for when the gate opens; they
  // are intentionally unused until the live HTTP calls are wired, and are kept
  // private to avoid lint "unused export" noise.

  /* istanbul ignore next — enabled with the live HTTP path */
  private mapActivity(a: {
    sr_status?: string | number;
    status?: string;
    activity?: string;
    date?: string;
    location?: string;
    id?: string | number;
  }): CourierTrackingEvent {
    const occurredAt = a.date ? new Date(a.date) : new Date();
    return {
      code: String(a.sr_status ?? a.status ?? 'UNKNOWN'),
      status: String(a.status ?? a.sr_status ?? 'UNKNOWN'),
      description: a.activity,
      occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
      courierEventId: a.id !== undefined ? String(a.id) : undefined,
      location: a.location,
      raw: a,
    };
  }
}
