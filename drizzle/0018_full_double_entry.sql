-- Add balance_sheet category type
ALTER TYPE "category_type" ADD VALUE IF NOT EXISTS 'balance_sheet';

-- Add deposit_location to transactions for fund tracking
ALTER TABLE "transactions" ADD COLUMN "deposit_location" deposit_location;

-- Truncate all data tables (dev environment, no production data)
TRUNCATE TABLE
  transactions,
  payments,
  collateral,
  loans,
  creditor_repayments,
  creditor_investments,
  creditors,
  fund_transfers,
  audit_log,
  notifications,
  rate_change_requests,
  transaction_categories,
  financial_snapshots
CASCADE;
