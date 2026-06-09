-- Projection table is also declared in src/lib/db/schema/loan-balances.ts and
-- created by drizzle-kit's schema apply. The IF NOT EXISTS here makes the
-- migration self-contained — running it on a bare DB (no prior push) still
-- produces a working projection layer.
CREATE TABLE IF NOT EXISTS loan_balances (
  loan_id              UUID PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE,
  outstanding_balance  NUMERIC(15,2) NOT NULL DEFAULT '0',
  unpaid_interest      NUMERIC(15,2) NOT NULL DEFAULT '0',
  last_payment_date    TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);--> statement-breakpoint

-- Recompute one loan's projection row from base data.
-- Asset account (Loans Receivable): debit adds, credit subtracts.
-- Revenue account (Interest Earned): credit adds, debit subtracts.
CREATE OR REPLACE FUNCTION refresh_loan_balance(p_loan_id UUID) RETURNS void AS $$
BEGIN
  IF p_loan_id IS NULL THEN RETURN; END IF;

  INSERT INTO loan_balances (loan_id, outstanding_balance, unpaid_interest, last_payment_date, updated_at)
  VALUES (
    p_loan_id,
    (SELECT COALESCE(SUM(CASE WHEN t.type = 'debit'  THEN  t.amount
                              WHEN t.type = 'credit' THEN -t.amount END), 0)
     FROM transactions t
     JOIN transaction_categories tc ON t.category_id = tc.id
     WHERE t.loan_id = p_loan_id AND tc.name = 'Loans Receivable'),
    (SELECT COALESCE(SUM(CASE WHEN t.type = 'credit' THEN  t.amount
                              WHEN t.type = 'debit'  THEN -t.amount END), 0)
     FROM transactions t
     JOIN transaction_categories tc ON t.category_id = tc.id
     WHERE t.loan_id = p_loan_id AND tc.name = 'Interest Earned'),
    (SELECT MAX(payment_date) FROM payments WHERE loan_id = p_loan_id),
    NOW()
  )
  ON CONFLICT (loan_id) DO UPDATE SET
    outstanding_balance = EXCLUDED.outstanding_balance,
    unpaid_interest    = EXCLUDED.unpaid_interest,
    last_payment_date  = EXCLUDED.last_payment_date,
    updated_at         = NOW();
END $$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE OR REPLACE FUNCTION on_transactions_change_for_loan_balance() RETURNS TRIGGER AS $$
BEGIN
  PERFORM refresh_loan_balance(COALESCE(NEW.loan_id, OLD.loan_id));
  IF TG_OP = 'UPDATE' AND NEW.loan_id IS DISTINCT FROM OLD.loan_id THEN
    PERFORM refresh_loan_balance(OLD.loan_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_transactions_loan_balance ON transactions;--> statement-breakpoint
CREATE TRIGGER trg_transactions_loan_balance
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION on_transactions_change_for_loan_balance();--> statement-breakpoint

CREATE OR REPLACE FUNCTION on_payments_change_for_loan_balance() RETURNS TRIGGER AS $$
BEGIN
  PERFORM refresh_loan_balance(COALESCE(NEW.loan_id, OLD.loan_id));
  IF TG_OP = 'UPDATE' AND NEW.loan_id IS DISTINCT FROM OLD.loan_id THEN
    PERFORM refresh_loan_balance(OLD.loan_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_payments_loan_balance ON payments;--> statement-breakpoint
CREATE TRIGGER trg_payments_loan_balance
AFTER INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION on_payments_change_for_loan_balance();
