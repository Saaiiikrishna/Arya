import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '@/modules/settings/settings.service';
import { COURIER_PROVIDER_SETTING_KEY } from '../shipping.constants';
import type { CourierProvider } from './courier-provider.interface';
import { ManualCourierProvider } from './manual-courier.provider';
import { ShiprocketCourierProvider } from './shiprocket-courier.provider';

/**
 * Resolves the active {@link CourierProvider} at runtime (architecture 8.4:
 * "Provider + token configured via SiteSettings"). Precedence:
 *   1. SiteSettings `store.courierProvider`
 *   2. env `COURIER_PROVIDER`
 *   3. default 'manual'
 *
 * Resolving per-call (rather than freezing one provider at boot) lets an admin
 * flip courier providers via settings without a redeploy. Unknown keys — and a
 * selected-but-not-live provider (e.g. Shiprocket before its HTTP path is enabled)
 * — degrade to the manual provider with a warning, never a hard failure on a
 * config typo or a corrupt (non-string) setting value.
 *
 * This resolver is bound to the COURIER_PROVIDER DI token (a class provider), so
 * the shipping service injects it and calls `resolve()` where it needs the active
 * provider.
 */
@Injectable()
export class CourierProviderFactory {
  private readonly logger = new Logger(CourierProviderFactory.name);
  private readonly byKey: Map<string, CourierProvider>;

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly manual: ManualCourierProvider,
    private readonly shiprocket: ShiprocketCourierProvider,
  ) {
    // Shiprocket stays registered here so the webhook signature path
    // (`byProviderKey`) can still resolve its per-provider secret, but it is NOT
    // selectable for live routing until `isProviderLive` says so (see `resolve`) —
    // its HTTP adapter currently hard-fails, so it must degrade to manual.
    this.byKey = new Map<string, CourierProvider>([
      [manual.key, manual],
      [shiprocket.key, shiprocket],
    ]);
  }

  /** The always-available fallback provider. */
  get fallback(): CourierProvider {
    return this.manual;
  }

  /** Resolve a provider by its explicit key (used by the webhook signature path). */
  byProviderKey(key: string): CourierProvider | undefined {
    return this.byKey.get(key.toLowerCase());
  }

  /** Resolve the currently-configured provider (settings → env → manual). */
  async resolve(): Promise<CourierProvider> {
    let rawKey: unknown = null;
    try {
      rawKey = await this.settings.get(COURIER_PROVIDER_SETTING_KEY);
    } catch (e) {
      this.logger.warn(
        `Could not read ${COURIER_PROVIDER_SETTING_KEY} setting: ${(e as Error)?.message}; falling back to env/default`,
      );
    }

    // Guard the stored setting's TYPE before calling .trim(): a corrupt /
    // non-string SiteSettings value (e.g. a number or object from a bad write or a
    // future Json column) must NOT throw a 500 here — fall back to env/manual.
    let key: string | null = null;
    if (typeof rawKey === 'string') {
      key = rawKey;
    } else if (rawKey != null) {
      this.logger.warn(
        `${COURIER_PROVIDER_SETTING_KEY} setting is not a string (got ${typeof rawKey}); falling back to env/default`,
      );
    }

    const envKey = this.config.get<string>('COURIER_PROVIDER');
    const resolvedKey = (
      key ??
      (typeof envKey === 'string' ? envKey : null) ??
      this.manual.key
    )
      .trim()
      .toLowerCase();

    const provider = this.byKey.get(resolvedKey);
    if (!provider) {
      this.logger.warn(
        `Unknown courier provider "${resolvedKey}"; falling back to "${this.manual.key}"`,
      );
      return this.manual;
    }

    // A selected provider is only used if it is actually LIVE. The Shiprocket
    // adapter's HTTP paths are not yet implemented (createShipment hard-fails with
    // COURIER_NOT_CONFIGURED), so selecting it would force every ship() down the
    // manual-fallback path anyway — and worse, mislabel shipments with its courier.
    // Gate it behind an explicit live check and resolve to the manual fallback
    // until it is enabled, so we never advertise a provider we cannot fulfil.
    if (!this.isProviderLive(provider)) {
      this.logger.warn(
        `Courier provider "${resolvedKey}" is selected but not live (HTTP path/credentials not enabled); resolving to "${this.manual.key}"`,
      );
      return this.manual;
    }

    return provider;
  }

  /**
   * Is this provider actually live (safe to route real shipments through)?
   *  - The manual provider is always live (admin supplies the AWB by hand).
   *  - Shiprocket is live ONLY when explicitly enabled (`SHIPROCKET_ENABLED=true`)
   *    AND a `SHIPROCKET_TOKEN` is configured. Its HTTP paths are still gated, so
   *    until both are set it degrades to manual rather than hard-failing every
   *    ship/sync. This lets ops flip it on via config once the integration is
   *    wired — no code change here.
   */
  private isProviderLive(provider: CourierProvider): boolean {
    if (provider.key === this.manual.key) return true;
    if (provider.key === this.shiprocket.key) {
      const enabled =
        (this.config.get<string>('SHIPROCKET_ENABLED') ?? '')
          .trim()
          .toLowerCase() === 'true';
      const hasToken =
        (this.config.get<string>('SHIPROCKET_TOKEN') ?? '').trim().length > 0;
      return enabled && hasToken;
    }
    // Unknown/other providers are not considered live by default.
    return false;
  }
}
