CREATE TABLE "payment_allocation_repair_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"policy_version" text NOT NULL,
	"agent_review_id" uuid NOT NULL,
	"applied_by_agent" text NOT NULL,
	"backup_sha256" text NOT NULL,
	"before_summary" text NOT NULL,
	"after_summary" text NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_payment_allocation_repair_plan_hash" UNIQUE("plan_hash"),
	CONSTRAINT "payment_allocation_repair_attribution" CHECK (
    length("payment_allocation_repair_runs"."applied_by_agent") > 6 AND
    left("payment_allocation_repair_runs"."applied_by_agent", 6) = 'agent:' AND
    length("payment_allocation_repair_runs"."backup_sha256") = 64
  )
);
--> statement-breakpoint
ALTER TABLE "payment_allocation_repair_runs" ADD CONSTRAINT "payment_allocation_repair_runs_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation_repair_runs" ADD CONSTRAINT "payment_allocation_repair_runs_agent_review_id_financial_correction_agent_reviews_id_fk" FOREIGN KEY ("agent_review_id") REFERENCES "public"."financial_correction_agent_reviews"("id") ON DELETE no action ON UPDATE no action;