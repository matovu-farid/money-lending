-- Add new loan statuses to enum
ALTER TYPE "loan_status" ADD VALUE IF NOT EXISTS 'settled_with_collateral';
ALTER TYPE "loan_status" ADD VALUE IF NOT EXISTS 'rolled_over';

-- Add collateral seizure tracking columns
ALTER TABLE "collateral" ADD COLUMN IF NOT EXISTS "seized_at" timestamp with time zone;
ALTER TABLE "collateral" ADD COLUMN IF NOT EXISTS "seized_by" text;

-- Add rollover tracking columns to loans
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "rolled_over_from" uuid;
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "rollover_amount" numeric(15, 2);

-- Add foreign key for rolled_over_from (self-referencing)
DO $$ BEGIN
  ALTER TABLE "loans" ADD CONSTRAINT "loans_rolled_over_from_fkey" FOREIGN KEY ("rolled_over_from") REFERENCES "loans"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add deposit_location to transactions for fund tracking
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "deposit_location" deposit_location;

-- Add loan_id column to transactions for per-loan ledger queries
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "loan_id" uuid;

-- Index for efficient per-loan queries
CREATE INDEX IF NOT EXISTS "idx_transactions_loan_id" ON "transactions" USING btree ("loan_id");

-- Index for efficient per-reference queries
CREATE INDEX IF NOT EXISTS "idx_transactions_reference_id" ON "transactions" USING btree ("reference_id");

-- Backfill loan_id from existing data:
-- 1. Loan-level entries
UPDATE transactions
SET loan_id = reference_id::uuid
WHERE reference_type IN ('loan', 'loan_reversal', 'loan_repost', 'rollover', 'collateral_settlement')
  AND reference_id IS NOT NULL
  AND loan_id IS NULL;

-- 2. Payment-level entries
UPDATE transactions t
SET loan_id = p.loan_id::uuid
FROM payments p
WHERE t.reference_id = p.id::text
  AND t.reference_type IN ('payment', 'payment_reversal')
  AND t.loan_id IS NULL;
