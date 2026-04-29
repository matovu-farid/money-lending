-- Add free-text category column for user-typed expense/income labels.
-- System-posted journal lines (loan disbursement, payments, etc.) leave it
-- NULL and continue to rely on category_id → transaction_categories.name.

ALTER TABLE "transactions" ADD COLUMN "category" text;

CREATE INDEX IF NOT EXISTS "idx_transactions_category_text"
  ON "transactions" ("type", "category");

-- Sentinel categories so manual income/expense rows have a stable
-- category_id (kept NOT NULL for accounting-type semantics in reports).
INSERT INTO "transaction_categories" ("name", "type", "is_default")
VALUES
  ('User Expense', 'expense', true),
  ('User Revenue', 'revenue', true)
ON CONFLICT ("name", "type") DO NOTHING;
