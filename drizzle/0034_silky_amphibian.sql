CREATE TABLE "financial_correction_agent_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"plan_hash" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"policy_version" text NOT NULL,
	"reviewer_agent_id" text NOT NULL,
	"review_run_id" text NOT NULL,
	"evidence_sha256" text NOT NULL,
	"evidence_json" text NOT NULL,
	"verdict" text NOT NULL,
	"findings_json" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_financial_correction_agent_review_plan" UNIQUE("kind","plan_hash"),
	CONSTRAINT "financial_correction_agent_review_verdict" CHECK ("financial_correction_agent_reviews"."verdict" IN ('pass', 'fail')),
	CONSTRAINT "financial_correction_agent_review_identity" CHECK (
    length("financial_correction_agent_reviews"."kind") > 0 AND length("financial_correction_agent_reviews"."subject_id") > 0 AND
    length("financial_correction_agent_reviews"."reviewer_agent_id") > 0 AND length("financial_correction_agent_reviews"."review_run_id") > 0 AND
    length("financial_correction_agent_reviews"."evidence_sha256") = 64
  )
);
--> statement-breakpoint
ALTER TABLE "historical_rate_repair_runs" ALTER COLUMN "reviewed_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolio_accrual_repair_runs" ALTER COLUMN "approved_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolio_accrual_repair_runs" ALTER COLUMN "applied_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "historical_rate_repair_runs" ADD COLUMN "agent_review_id" uuid;--> statement-breakpoint
ALTER TABLE "historical_rate_repair_runs" ADD COLUMN "applied_by_agent" text;--> statement-breakpoint
ALTER TABLE "portfolio_accrual_repair_runs" ADD COLUMN "agent_review_id" uuid;--> statement-breakpoint
ALTER TABLE "portfolio_accrual_repair_runs" ADD COLUMN "applied_by_agent" text;--> statement-breakpoint
ALTER TABLE "historical_rate_repair_runs" ADD CONSTRAINT "historical_rate_repair_runs_agent_review_id_financial_correction_agent_reviews_id_fk" FOREIGN KEY ("agent_review_id") REFERENCES "public"."financial_correction_agent_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_accrual_repair_runs" ADD CONSTRAINT "portfolio_accrual_repair_runs_agent_review_id_financial_correction_agent_reviews_id_fk" FOREIGN KEY ("agent_review_id") REFERENCES "public"."financial_correction_agent_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_rate_repair_runs" ADD CONSTRAINT "historical_rate_run_attribution" CHECK (
    ("historical_rate_repair_runs"."reviewed_by" IS NOT NULL AND "historical_rate_repair_runs"."agent_review_id" IS NULL AND
      "historical_rate_repair_runs"."applied_by_agent" IS NULL) OR
    ("historical_rate_repair_runs"."reviewed_by" IS NULL AND "historical_rate_repair_runs"."agent_review_id" IS NOT NULL AND
      length("historical_rate_repair_runs"."applied_by_agent") > 0)
  );--> statement-breakpoint
ALTER TABLE "portfolio_accrual_repair_runs" ADD CONSTRAINT "portfolio_accrual_run_attribution" CHECK (
    ("portfolio_accrual_repair_runs"."approved_by" IS NOT NULL AND "portfolio_accrual_repair_runs"."applied_by" IS NOT NULL AND
      "portfolio_accrual_repair_runs"."agent_review_id" IS NULL AND "portfolio_accrual_repair_runs"."applied_by_agent" IS NULL) OR
    ("portfolio_accrual_repair_runs"."approved_by" IS NULL AND "portfolio_accrual_repair_runs"."applied_by" IS NULL AND
      "portfolio_accrual_repair_runs"."agent_review_id" IS NOT NULL AND length("portfolio_accrual_repair_runs"."applied_by_agent") > 0)
  );