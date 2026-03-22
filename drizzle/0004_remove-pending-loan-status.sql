-- Migration: Remove 'pending' from loan_status enum
-- Loans are now created as 'active' immediately (disbursement happens off-app).
-- Any existing rows with status='pending' are migrated to 'active' first.

-- Step 1: Update existing pending loans to active
UPDATE "loans" SET "status" = 'active' WHERE "status" = 'pending';

-- Step 2: Replace the enum type (Postgres does not support removing enum values directly)
ALTER TYPE "public"."loan_status" RENAME TO "loan_status_old";--> statement-breakpoint
CREATE TYPE "public"."loan_status" AS ENUM('active', 'fully_paid');--> statement-breakpoint
ALTER TABLE "loans" ALTER COLUMN "status" TYPE "public"."loan_status" USING "status"::text::"public"."loan_status";--> statement-breakpoint
ALTER TABLE "loans" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
DROP TYPE "public"."loan_status_old";
