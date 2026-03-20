ALTER TABLE "payments" ADD COLUMN "edit_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "delete_reason" text;