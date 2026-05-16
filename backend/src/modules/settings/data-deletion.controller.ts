import { Controller, Post, Body, Res, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Handles Meta's Data Deletion Request callback.
 *
 * Flow: user clicks "Delete my data" in Facebook/Meta settings →
 *   Meta POSTs signed_request here → we verify it → return confirmation.
 *
 * Meta spec: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
@Controller('api/data-deletion')
export class DataDeletionController {
  private readonly logger = new Logger(DataDeletionController.name);
  private readonly appSecret: string;
  private readonly frontendUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.appSecret = this.configService.get<string>('WHATSAPP_APP_SECRET') ?? '';
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL') ?? 'https://aryavartham.com';
  }

  /**
   * POST /api/data-deletion
   *
   * Meta sends application/x-www-form-urlencoded with a single field: signed_request.
   * Format: <base64url_hmac_sha256_signature>.<base64url_json_payload>
   *
   * Must respond with JSON: { url, confirmation_code }
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  handleDeletionRequest(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    const signedRequest = body?.signed_request;

    if (!signedRequest) {
      return res.status(400).json({ error: 'missing signed_request' });
    }

    const [encodedSig, encodedPayload] = signedRequest.split('.');
    if (!encodedSig || !encodedPayload) {
      return res.status(400).json({ error: 'malformed signed_request' });
    }

    // Verify HMAC-SHA256 signature
    if (this.appSecret) {
      const expectedSig = crypto
        .createHmac('sha256', this.appSecret)
        .update(encodedPayload)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      try {
        const sigBuf = Buffer.from(encodedSig, 'base64url');
        const expBuf = Buffer.from(expectedSig, 'base64url');
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
          this.logger.warn('Data deletion request: invalid signature');
          return res.status(403).json({ error: 'invalid signature' });
        }
      } catch {
        return res.status(403).json({ error: 'signature verification failed' });
      }
    }

    let userId: string | undefined;
    try {
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      userId = payload?.user_id;
    } catch {
      return res.status(400).json({ error: 'could not decode payload' });
    }

    const confirmationCode = uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();

    this.logger.log(`Data deletion request received — userId: ${userId ?? 'unknown'}, code: ${confirmationCode}`);

    return res.status(200).json({
      url: `${this.frontendUrl}/data-deletion?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    });
  }
}
