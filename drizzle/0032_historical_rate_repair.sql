CREATE TABLE "historical_rate_repair_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"policy_version" text NOT NULL,
	"approved_by" text NOT NULL,
	"review_note" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_historical_rate_repair_approval_plan_hash" UNIQUE("plan_hash")
);
--> statement-breakpoint
CREATE TABLE "historical_rate_repair_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"policy_version" text NOT NULL,
	"reviewed_by" text NOT NULL,
	"backup_sha256" text NOT NULL,
	"before_summary" text NOT NULL,
	"after_summary" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_historical_rate_repair_run_plan_hash" UNIQUE("plan_hash")
);
--> statement-breakpoint
ALTER TABLE "historical_rate_repair_approvals" ADD CONSTRAINT "historical_rate_repair_approvals_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_rate_repair_approvals" ADD CONSTRAINT "historical_rate_repair_approvals_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_rate_repair_runs" ADD CONSTRAINT "historical_rate_repair_runs_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_rate_repair_runs" ADD CONSTRAINT "historical_rate_repair_runs_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;