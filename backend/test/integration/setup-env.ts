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
  // Parse + rewrite the pathname deterministically rather than regex-replacing a
  // substring: a fragile `/\/arya(\?|$)/` pattern would silently NOT rewrite
  // `.../arya_dev` or `.../arya/extra` and leave tests pointed at the wrong DB.
  // Using URL.pathname is exact — only the database segment is replaced, and the
  // query string (e.g. ?schema=public), credentials, host and port are preserved.
  try {
    const url = new URL(process.env.DATABASE_URL);
    const db = url.pathname.replace(/^\//, '');
    if (db === 'arya') {
      url.pathname = '/arya_test';
      process.env.DATABASE_URL = url.toString();
    }
  } catch {
    // Non-URL-parseable connection strings (rare): fall back to the anchored
    // regex so the original documented shapes still redirect to the test DB.
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
      /\/arya(\?|$)/,
      '/arya_test$1',
    );
  }
}

process.env.NODE_ENV = 'test';
