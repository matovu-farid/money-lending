CREATE TABLE IF NOT EXISTS "loan_waivers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "loan_id" uuid NOT NULL,
  "amount" numeric(15, 2) NOT NULL,
  "waiver_date" timestamp with time zone NOT NULL,
  "reason" text NOT NULL,
  "recorded_by" text NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "loan_waivers_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "loan_waivers_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "loan_waivers_amount_positive" CHECK ("amount" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_loan_waivers_loan_id" ON "loan_waivers" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_loan_waivers_active_date" ON "loan_waivers" USING btree ("loan_id","waiver_date") WHERE deleted_at IS NULL;--> statement-breakpoint
INSERT INTO "transaction_categories" ("name", "type", "is_default")
VALUES ('Loan Losses', 'expense', true)
ON CONFLICT ("name", "type") DO NOTHING;--> statement-breakpoint
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
    (SELECT MAX(d) FROM (
       SELECT payment_date AS d FROM payments
       WHERE loan_id = p_loan_id AND deleted_at IS NULL AND marked_wrong = false
       UNION ALL
       SELECT waiver_date AS d FROM loan_waivers
       WHERE loan_id = p_loan_id AND deleted_at IS NULL
     ) settlements),
    NOW()
  )
  ON CONFLICT (loan_id) DO UPDATE SET
    outstanding_balance = EXCLUDED.outstanding_balance,
    unpaid_interest    = EXCLUDED.unpaid_interest,
    last_payment_date  = EXCLUDED.last_payment_date,
    updated_at         = NOW();
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION on_loan_waivers_change_for_loan_balance() RETURNS TRIGGER AS $$
BEGIN
  PERFORM refresh_loan_balance(COALESCE(NEW.loan_id, OLD.loan_id));
  IF TG_OP = 'UPDATE' AND NEW.loan_id IS DISTINCT FROM OLD.loan_id THEN
    PERFORM refresh_loan_balance(OLD.loan_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_loan_waivers_loan_balance ON loan_waivers;--> statement-breakpoint
CREATE TRIGGER trg_loan_waivers_loan_balance
AFTER INSERT OR UPDATE OR DELETE ON loan_waivers
FOR EACH ROW EXECUTE FUNCTION on_loan_waivers_change_for_loan_balance();
