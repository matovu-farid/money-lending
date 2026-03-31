ALTER TABLE "loans" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "loans" ALTER COLUMN "status" SET DEFAULT 'active'::text;--> statement-breakpoint
DROP TYPE "public"."loan_status";--> statement-breakpoint
CREATE TYPE "public"."loan_status" AS ENUM('active', 'fully_paid');--> statement-breakpoint
ALTER TABLE "loans" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."loan_status";--> statement-breakpoint
ALTER TABLE "loans" ALTER COLUMN "status" SET DATA TYPE "public"."loan_status" USING "status"::"public"."loan_status";--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "deleted_at" timestamp with time zone;