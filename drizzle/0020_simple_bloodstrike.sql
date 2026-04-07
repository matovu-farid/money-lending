ALTER TABLE "loans" ADD COLUMN "penalty_multiplier" numeric(5, 4) DEFAULT '0.1000' NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "penalty_waived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "penalty_waived_by" text;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "penalty_waived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_transactions_reference_id" ON "transactions" USING btree ("reference_id");