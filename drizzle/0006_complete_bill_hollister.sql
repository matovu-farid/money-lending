CREATE INDEX "idx_loans_customer_id" ON "loans" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_payments_loan_id" ON "payments" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "idx_payments_loan_deleted" ON "payments" USING btree ("loan_id","payment_date") WHERE deleted_at IS NULL;