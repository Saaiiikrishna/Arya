import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { StoreAuthModule } from '../store-auth';
import { InvoicingService } from './invoicing.service';
import { InvoicingController } from './invoicing.controller';
import { InvoiceAccessGuard } from './guards';

/**
 * Invoicing module (architecture 4.11). Owns Invoice / InvoiceLine /
 * InvoiceSequence and the gapless-numbered GST tax-invoice generation +
 * PDF→S3 rendering. Lines are copied VERBATIM from the frozen OrderItem
 * snapshots — tax is never re-computed (architecture 8.3).
 *
 * Imports:
 *  - SettingsModule: SettingsService resolves the single configured seller
 *    identity (store.sellerGstin / store.sellerStateCode / store.sellerName,
 *    decision §14.1 — single GSTIN).
 *  - StoreAuthModule: exports CustomerJwtGuard, used by InvoiceAccessGuard to
 *    authorize the registered-customer download path (the guest path uses the
 *    X-Order-Token hash directly).
 *
 * PrismaModule is @Global() so PrismaService is injectable without importing it
 * (matches the payment/inventory/tax module pattern). The S3 client is
 * constructed inside InvoicingService, mirroring document.service.ts /
 * store-media.service.ts (server-generated PDFs use the direct PutObject path,
 * architecture 8.7).
 *
 * EXPORTS InvoicingService so the orders + returns + jobs siblings can compose
 * generateInvoice() per the cross-module contract.
 */
@Module({
  imports: [SettingsModule, StoreAuthModule],
  controllers: [InvoicingController],
  providers: [InvoicingService, InvoiceAccessGuard],
  exports: [InvoicingService],
})
export class InvoicingModule {}
