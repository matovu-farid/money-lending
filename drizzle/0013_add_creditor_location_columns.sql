ALTER TABLE "creditor_investments" ADD COLUMN "deposit_location" "deposit_location" DEFAULT 'cash' NOT NULL;
--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD COLUMN "source_location" "deposit_location" DEFAULT 'cash' NOT NULL;
