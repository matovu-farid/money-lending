-- Add loan_id column to transactions for per-loan ledger queries
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "loan_id" uuid;

-- Index for efficient per-loan queries
CREATE INDEX IF NOT EXISTS "idx_transactions_loan_id" ON "transactions" USING btree ("loan_id");

-- Backfill loan_id from existing data:
-- 1. Loan-level entries (disbursement, fee, rollover, collateral_settlement, loan_reversal, loan_repost)
--    already have reference_id = loan_id
UPDATE transactions
SET loan_id = reference_id::uuid
WHERE reference_type IN ('loan', 'loan_reversal', 'loan_repost', 'rollover', 'collateral_settlement')
  AND reference_id IS NOT NULL
  AND loan_id IS NULL;

-- 2. Payment-level entries (payment, payment_reversal)
--    reference_id = payment_id, so join through payments to get loan_id
UPDATE transactions t
SET loan_id = p.loan_id::uuid
FROM payments p
WHERE t.reference_id = p.id::text
  AND t.reference_type IN ('payment', 'payment_reversal')
  AND t.loan_id IS NULL;
