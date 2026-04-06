-- Add new loan statuses to enum
ALTER TYPE "loan_status" ADD VALUE IF NOT EXISTS 'settled_with_collateral';
ALTER TYPE "loan_status" ADD VALUE IF NOT EXISTS 'rolled_over';

-- Add collateral seizure tracking columns
ALTER TABLE "collateral" ADD COLUMN "seized_at" timestamp with time zone;
ALTER TABLE "collateral" ADD COLUMN "seized_by" text;

-- Add rollover tracking columns to loans
ALTER TABLE "loans" ADD COLUMN "rolled_over_from" uuid;
ALTER TABLE "loans" ADD COLUMN "rollover_amount" numeric(15, 2);

-- Add foreign key for rolled_over_from (self-referencing)
ALTER TABLE "loans" ADD CONSTRAINT "loans_rolled_over_from_fkey" FOREIGN KEY ("rolled_over_from") REFERENCES "loans"("id");
