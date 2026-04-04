ALTER TABLE "loans" ADD COLUMN "issuance_fee" numeric(15, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "description" text NOT NULL;