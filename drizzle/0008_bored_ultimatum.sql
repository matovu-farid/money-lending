CREATE TYPE "public"."rate_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "rate_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"requested_rate" numeric(5, 4) NOT NULL,
	"current_rate" numeric(5, 4) NOT NULL,
	"requested_by" text NOT NULL,
	"required_approver_role" text NOT NULL,
	"status" "rate_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "rate_change_requests" ADD CONSTRAINT "rate_change_requests_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_rate_change_requests_loan_id" ON "rate_change_requests" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "idx_rate_change_requests_status" ON "rate_change_requests" USING btree ("status");