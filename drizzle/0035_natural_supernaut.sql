ALTER TABLE "financial_correction_agent_reviews" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "financial_correction_agent_reviews" ADD COLUMN "consumed_by_run_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_correction_agent_reviews" DROP CONSTRAINT "uq_financial_correction_agent_review_plan";--> statement-breakpoint
ALTER TABLE "financial_correction_agent_reviews" ADD CONSTRAINT "uq_financial_correction_agent_review_attempt" UNIQUE("kind","plan_hash","review_run_id");--> statement-breakpoint
ALTER TABLE "financial_correction_agent_reviews" ADD CONSTRAINT "financial_correction_agent_review_consumption" CHECK (
    ("financial_correction_agent_reviews"."consumed_at" IS NULL AND "financial_correction_agent_reviews"."consumed_by_run_id" IS NULL) OR
    ("financial_correction_agent_reviews"."consumed_at" IS NOT NULL AND "financial_correction_agent_reviews"."consumed_by_run_id" IS NOT NULL AND
      "financial_correction_agent_reviews"."verdict" = 'pass')
  );--> statement-breakpoint
ALTER TABLE "historical_rate_repair_runs" DROP CONSTRAINT "historical_rate_run_attribution";--> statement-breakpoint
ALTER TABLE "historical_rate_repair_runs" ADD CONSTRAINT "historical_rate_run_attribution" CHECK (
    ("historical_rate_repair_runs"."reviewed_by" IS NOT NULL AND "historical_rate_repair_runs"."agent_review_id" IS NULL AND
      "historical_rate_repair_runs"."applied_by_agent" IS NULL) OR
    ("historical_rate_repair_runs"."reviewed_by" IS NULL AND "historical_rate_repair_runs"."agent_review_id" IS NOT NULL AND
      "historical_rate_repair_runs"."applied_by_agent" IS NOT NULL AND length("historical_rate_repair_runs"."applied_by_agent") > 0)
  );--> statement-breakpoint
ALTER TABLE "portfolio_accrual_repair_runs" DROP CONSTRAINT "portfolio_accrual_run_attribution";--> statement-breakpoint
ALTER TABLE "portfolio_accrual_repair_runs" ADD CONSTRAINT "portfolio_accrual_run_attribution" CHECK (
    ("portfolio_accrual_repair_runs"."approved_by" IS NOT NULL AND "portfolio_accrual_repair_runs"."applied_by" IS NOT NULL AND
      "portfolio_accrual_repair_runs"."agent_review_id" IS NULL AND "portfolio_accrual_repair_runs"."applied_by_agent" IS NULL) OR
    ("portfolio_accrual_repair_runs"."approved_by" IS NULL AND "portfolio_accrual_repair_runs"."applied_by" IS NULL AND
      "portfolio_accrual_repair_runs"."agent_review_id" IS NOT NULL AND "portfolio_accrual_repair_runs"."applied_by_agent" IS NOT NULL AND
      length("portfolio_accrual_repair_runs"."applied_by_agent") > 0)
  );--> statement-breakpoint
ALTER TABLE "rollover_correction_runs" ALTER COLUMN "reviewed_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rollover_correction_runs" ADD COLUMN "agent_review_id" uuid;--> statement-breakpoint
ALTER TABLE "rollover_correction_runs" ADD COLUMN "applied_by_agent" text;--> statement-breakpoint
ALTER TABLE "rollover_correction_runs" ADD CONSTRAINT "rollover_correction_runs_agent_review_id_financial_correction_agent_reviews_id_fk" FOREIGN KEY ("agent_review_id") REFERENCES "public"."financial_correction_agent_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollover_correction_runs" ADD CONSTRAINT "rollover_correction_run_attribution" CHECK (
    ("rollover_correction_runs"."reviewed_by" IS NOT NULL AND "rollover_correction_runs"."agent_review_id" IS NULL AND
      "rollover_correction_runs"."applied_by_agent" IS NULL) OR
    ("rollover_correction_runs"."reviewed_by" IS NULL AND "rollover_correction_runs"."agent_review_id" IS NOT NULL AND
      "rollover_correction_runs"."applied_by_agent" IS NOT NULL AND length("rollover_correction_runs"."applied_by_agent") > 0)
  );
