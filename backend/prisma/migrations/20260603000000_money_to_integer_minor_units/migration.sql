-- Convert money columns from Float (major units) to Int (minor units: INR paise / USD cents).
-- The `USING round(col * 100)::int` clause backfills any existing rows correctly and is a
-- no-op on empty tables, so no separate data backfill is required.

-- Batch.pledgeAmount → integer paise
ALTER TABLE "batches" ALTER COLUMN "pledge_amount" DROP DEFAULT;
ALTER TABLE "batches" ALTER COLUMN "pledge_amount" SET DATA TYPE INTEGER USING round("pledge_amount" * 100)::int;
ALTER TABLE "batches" ALTER COLUMN "pledge_amount" SET DEFAULT 1000000;

-- Payment.amount → integer paise
ALTER TABLE "payments" ALTER COLUMN "amount" SET DATA TYPE INTEGER USING round("amount" * 100)::int;

-- Donation.amount → integer paise
ALTER TABLE "donations" ALTER COLUMN "amount" SET DATA TYPE INTEGER USING round("amount" * 100)::int;

-- Project.estimatedFunds / fundedAmount → integer minor units (cents)
ALTER TABLE "projects" ALTER COLUMN "estimated_funds" SET DATA TYPE INTEGER USING round("estimated_funds" * 100)::int;
ALTER TABLE "projects" ALTER COLUMN "funded_amount" DROP DEFAULT;
ALTER TABLE "projects" ALTER COLUMN "funded_amount" SET DATA TYPE INTEGER USING round("funded_amount" * 100)::int;
ALTER TABLE "projects" ALTER COLUMN "funded_amount" SET DEFAULT 0;

-- LedgerTransaction.amount → integer minor units (cents)
ALTER TABLE "ledger_transactions" ALTER COLUMN "amount" SET DATA TYPE INTEGER USING round("amount" * 100)::int;
