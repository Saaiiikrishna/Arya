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
 * flip courier providers via settings without a redeploy. Unknown keys degrade to
 * the manual provider with a warning — never a hard failure on a config typo.
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
    let key: string | null = null;
    try {
      key = await this.settings.get(COURIER_PROVIDER_SETTING_KEY);
    } catch (e) {
      this.logger.warn(
        `Could not read ${COURIER_PROVIDER_SETTING_KEY} setting: ${(e as Error)?.message}; falling back to env/default`,
      );
    }
    const resolvedKey = (
      key ??
      this.config.get<string>('COURIER_PROVIDER') ??
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
    return provider;
  }
}
