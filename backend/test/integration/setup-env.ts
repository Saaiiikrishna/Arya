/**
 * Integration-test env bootstrap (runs in jest `setupFiles`, before any module
 * import). Loads the real .env, then redirects DATABASE_URL to the isolated
 * `arya_test` database so integration tests NEVER touch the dev DB. Real
 * Postgres + Redis are used (no mocks for those, per project convention);
 * external APIs (Razorpay/S3/SES) are stubbed per-test.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('/arya_test')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/arya(\?|$)/, '/arya_test$1');
}

process.env.NODE_ENV = 'test';
