CREATE TABLE "rollover_correction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_root_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"policy_version" text NOT NULL,
	"reviewed_by" text NOT NULL,
	"before_summary" text NOT NULL,
	"after_summary" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_rollover_correction_plan_hash" UNIQUE("plan_hash")
);
--> statement-breakpoint
ALTER TABLE "rollover_correction_runs" ADD CONSTRAINT "rollover_correction_runs_chain_root_id_loans_id_fk" FOREIGN KEY ("chain_root_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollover_correction_runs" ADD CONSTRAINT "rollover_correction_runs_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;