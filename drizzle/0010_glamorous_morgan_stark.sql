CREATE TYPE "public"."deposit_location" AS ENUM('cash', 'bank', 'strong_room');--> statement-breakpoint
CREATE TABLE "fund_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_location" "deposit_location" NOT NULL,
	"to_location" "deposit_location" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"transferred_by" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "disbursement_source" "deposit_location" NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "deposit_location" "deposit_location" NOT NULL;