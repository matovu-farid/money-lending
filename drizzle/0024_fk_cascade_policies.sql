ALTER TABLE "loans" DROP CONSTRAINT "loans_rolled_over_from_loans_id_fk";
--> statement-breakpoint
ALTER TABLE "collateral" DROP CONSTRAINT "collateral_loan_id_loans_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_loan_id_loans_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_actor_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "creditor_investments" DROP CONSTRAINT "creditor_investments_creditor_id_creditors_id_fk";
--> statement-breakpoint
ALTER TABLE "creditor_repayments" DROP CONSTRAINT "creditor_repayments_investment_id_creditor_investments_id_fk";
--> statement-breakpoint
ALTER TABLE "rate_change_requests" DROP CONSTRAINT "rate_change_requests_loan_id_loans_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_rolled_over_from_loans_id_fk" FOREIGN KEY ("rolled_over_from") REFERENCES "public"."loans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collateral" ADD CONSTRAINT "collateral_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditor_investments" ADD CONSTRAINT "creditor_investments_creditor_id_creditors_id_fk" FOREIGN KEY ("creditor_id") REFERENCES "public"."creditors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD CONSTRAINT "creditor_repayments_investment_id_creditor_investments_id_fk" FOREIGN KEY ("investment_id") REFERENCES "public"."creditor_investments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_change_requests" ADD CONSTRAINT "rate_change_requests_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;