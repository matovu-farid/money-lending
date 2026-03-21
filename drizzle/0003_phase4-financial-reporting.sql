CREATE TYPE "public"."category_type" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TABLE "creditors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact" text NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creditor_investments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creditor_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"interest_rate_monthly" numeric(5, 4) NOT NULL,
	"investment_date" timestamp with time zone NOT NULL,
	"principal_balance" numeric(15, 2) NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creditor_repayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investment_id" uuid NOT NULL,
	"repayment_date" timestamp with time zone NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"interest_portion" numeric(15, 2) NOT NULL,
	"principal_portion" numeric(15, 2) NOT NULL,
	"principal_balance_before" numeric(15, 2) NOT NULL,
	"principal_balance_after" numeric(15, 2) NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "category_type" NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "transaction_type" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"category_id" uuid NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"description" text,
	"transaction_date" timestamp with time zone NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"data" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creditor_investments" ADD CONSTRAINT "creditor_investments_creditor_id_creditors_id_fk" FOREIGN KEY ("creditor_id") REFERENCES "public"."creditors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditor_repayments" ADD CONSTRAINT "creditor_repayments_investment_id_creditor_investments_id_fk" FOREIGN KEY ("investment_id") REFERENCES "public"."creditor_investments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_transaction_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."transaction_categories"("id") ON DELETE restrict ON UPDATE no action;