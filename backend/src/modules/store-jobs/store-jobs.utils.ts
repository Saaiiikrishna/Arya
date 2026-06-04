/**
 * store-jobs pure date helpers (architecture Section 7 / 8.8).
 *
 * The analytics rollup buckets every row by its Asia/Kolkata (IST, UTC+5:30, no
 * DST) CALENDAR date so the Node-derived "previous IST day" string matches the
 * SQL `AT TIME ZONE 'Asia/Kolkata'` date cast exactly. Both the scheduler (to
 * derive yesterday for the enqueue jobId) and the processor (to derive the
 * default statDate) need this, so it lives here once — a single source of truth,
 * not two copies that can silently diverge on a future edit.
 */

/** IANA zone used for every IST day-bucket computation in store-jobs. */
const IST_TIME_ZONE = 'Asia/Kolkata';

/**
 * Format a Date as the YYYY-MM-DD it falls on in Asia/Kolkata (IST). en-CA yields
 * the ISO-ordered `YYYY-MM-DD`; `timeZone` pins the wall-clock to IST so the
 * bucket matches the SQL date cast.
 */
export function istDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** YYYY-MM-DD of "yesterday" in Asia/Kolkata (IST) — the rollup's default day. */
export function previousIstDay(): string {
  return istDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

/**
 * True iff `s` is a syntactically well-formed `YYYY-MM-DD` string. Used to guard
 * a job-supplied statDate before it enters the raw-SQL rollup: Prisma's tagged
 * template parameterizes the value (no SQL injection), but a malformed date
 * would burn all BullMQ retry attempts on a guaranteed-bad Postgres `::date`
 * cast — so we reject it up front as a non-retriable input error.
 */
export function isIsoDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
