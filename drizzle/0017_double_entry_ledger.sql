-- Add journalGroupId to transactions
ALTER TABLE "transactions" ADD COLUMN "journal_group_id" uuid;
CREATE INDEX "idx_transactions_journal_group_id" ON "transactions" USING btree ("journal_group_id");

-- Migrate category_type enum: add new values
ALTER TYPE "category_type" ADD VALUE IF NOT EXISTS 'asset';
ALTER TYPE "category_type" ADD VALUE IF NOT EXISTS 'liability';
ALTER TYPE "category_type" ADD VALUE IF NOT EXISTS 'equity';
ALTER TYPE "category_type" ADD VALUE IF NOT EXISTS 'revenue';

-- Migrate existing categories to new types
UPDATE "transaction_categories" SET "type" = 'revenue' WHERE "type" = 'income';
UPDATE "transaction_categories" SET "type" = 'equity' WHERE "name" = 'Share Capital';
UPDATE "transaction_categories" SET "type" = 'liability' WHERE "name" = 'Creditor Investment';
UPDATE "transaction_categories" SET "type" = 'liability' WHERE "name" = 'Creditor Principal Repaid';

-- Rename old balance_sheet categories to asset type
UPDATE "transaction_categories" SET "type" = 'asset', "name" = 'Loans Receivable' WHERE "name" = 'Loan Disbursement';
UPDATE "transaction_categories" SET "type" = 'asset' WHERE "name" = 'Principal Repayment';
UPDATE "transaction_categories" SET "type" = 'asset', "name" = 'Seized Collateral' WHERE "name" = 'Principal Recovery';
UPDATE "transaction_categories" SET "type" = 'asset' WHERE "name" = 'Fund Transfer';

-- Create new Cash asset category
INSERT INTO "transaction_categories" ("id", "name", "type", "is_default")
VALUES (gen_random_uuid(), 'Cash', 'asset', true)
ON CONFLICT DO NOTHING;
