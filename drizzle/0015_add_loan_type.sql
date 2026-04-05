DO $$ BEGIN
  CREATE TYPE "public"."loan_type" AS ENUM('perpetual', 'fixed_rate', 'reducing_balance');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "loans" ADD COLUMN "loan_type" "loan_type" NOT NULL DEFAULT 'perpetual';
ALTER TABLE "loans" ADD COLUMN "term_months" integer;
