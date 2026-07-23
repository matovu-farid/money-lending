CREATE TABLE "loan_waivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"waiver_date" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"recorded_by" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loan_waivers_amount_positive" CHECK ("loan_waivers"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "fund_transfers" ADD COLUMN "transferred_at" timestamp with time zone;--> statement-breakpoint
UPDATE "fund_transfers" SET "transferred_at" = "created_at" WHERE "transferred_at" IS NULL;--> statement-breakpoint
ALTER TABLE "fund_transfers" ALTER COLUMN "transferred_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "fund_transfers" ALTER COLUMN "transferred_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fund_transfers" ADD COLUMN "backdated_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fund_transfers" ADD COLUMN "backdated_by" text;--> statement-breakpoint
ALTER TABLE "fund_transfers" ADD COLUMN "backdated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fund_transfers" ADD COLUMN "backdate_note" text;--> statement-breakpoint
ALTER TABLE "loan_waivers" ADD CONSTRAINT "loan_waivers_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_waivers" ADD CONSTRAINT "loan_waivers_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_loan_waivers_loan_id" ON "loan_waivers" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "idx_loan_waivers_active_date" ON "loan_waivers" USING btree ("loan_id","waiver_date") WHERE deleted_at IS NULL;