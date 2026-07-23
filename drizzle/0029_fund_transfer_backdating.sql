ALTER TABLE "fund_transfers" ADD COLUMN IF NOT EXISTS "transferred_at" timestamp with time zone;--> statement-breakpoint
UPDATE "fund_transfers" SET "transferred_at" = "created_at" WHERE "transferred_at" IS NULL;--> statement-breakpoint
ALTER TABLE "fund_transfers" ALTER COLUMN "transferred_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "fund_transfers" ALTER COLUMN "transferred_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fund_transfers" ADD COLUMN IF NOT EXISTS "backdated_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fund_transfers" ADD COLUMN IF NOT EXISTS "backdated_by" text;--> statement-breakpoint
ALTER TABLE "fund_transfers" ADD COLUMN IF NOT EXISTS "backdated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fund_transfers" ADD COLUMN IF NOT EXISTS "backdate_note" text;
