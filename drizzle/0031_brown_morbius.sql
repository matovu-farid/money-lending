CREATE TABLE "rollover_correction_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_root_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"policy_version" text NOT NULL,
	"approved_by" text NOT NULL,
	"review_note" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_rollover_correction_approval_plan_hash" UNIQUE("plan_hash")
);
--> statement-breakpoint
ALTER TABLE "rollover_correction_approvals" ADD CONSTRAINT "rollover_correction_approvals_chain_root_id_loans_id_fk" FOREIGN KEY ("chain_root_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollover_correction_approvals" ADD CONSTRAINT "rollover_correction_approvals_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;