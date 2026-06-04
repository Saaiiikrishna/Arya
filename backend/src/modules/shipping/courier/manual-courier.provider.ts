import { BadRequestException, Injectable } from '@nestjs/common';
import { Courier } from '@prisma/client';
import type {
  CourierProvider,
  CourierTrackingEvent,
  CreateShipmentResult,
  OrderWithItems,
} from './courier-provider.interface';

/**
 * Manual courier provider (architecture 8.4 default). The admin supplies the AWB
 * and courier by hand at ship time; there is no upstream courier API. Tracking is
 * advanced exclusively via the inbound courier webhook / admin action, so
 * getTracking returns an empty list (nothing to poll).
 *
 * This is the SAFE fallback every gated remote provider degrades to when its
 * credentials are absent (see CourierProviderFactory).
 */
@Injectable()
export class ManualCourierProvider implements CourierProvider {
  readonly courier: Courier = Courier.OTHER;
  readonly key = 'manual';

  /**
   * "Create" a manual shipment: there is no courier call, so the admin MUST have
   * supplied the AWB on the request. The shipping service handles the admin-AWB
   * path directly and only calls this when explicitly asked to "create via
   * provider"; for manual that means the AWB is required up front.
   */
  createShipment(order: OrderWithItems): Promise<CreateShipmentResult> {
    // The manual provider cannot mint an AWB — the caller must pass one. The
    // shipping service guards this (admin AWB required for the manual provider),
    // but assert here too so a mis-wired caller fails loudly rather than creating
    // a shipment with an empty AWB.
    throw new BadRequestException(
      `MANUAL_AWB_REQUIRED: the manual courier provider cannot generate an AWB for order ${order.orderNumber} — supply \`awb\` when shipping`,
    );
  }

  /** Manual shipments have no upstream tracking feed (nothing to poll for `awb`). */
  getTracking(awb: string): Promise<CourierTrackingEvent[]> {
    void awb;
    return Promise.resolve([]);
  }
}
