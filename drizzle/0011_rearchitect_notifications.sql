-- Truncate existing notifications (user approved clean migration)
TRUNCATE TABLE notifications CASCADE;
--> statement-breakpoint

-- Drop old FK constraint and columns
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_loan_id_loans_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN IF EXISTS "loan_id";
--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN IF EXISTS "due_date";
--> statement-breakpoint

-- Add new generic columns
ALTER TABLE "notifications" ADD COLUMN "reference_type" text;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "reference_id" text;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "metadata" jsonb;
--> statement-breakpoint

-- Add chat_mention to the enum
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'chat_mention';
