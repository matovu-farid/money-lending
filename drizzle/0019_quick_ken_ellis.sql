ALTER TABLE "payments" DROP COLUMN "interest_portion";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "principal_portion";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "principal_balance_before";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "principal_balance_after";--> statement-breakpoint
ALTER TABLE "creditor_investments" DROP COLUMN "principal_balance";--> statement-breakpoint
ALTER TABLE "creditor_repayments" DROP COLUMN "interest_portion";--> statement-breakpoint
ALTER TABLE "creditor_repayments" DROP COLUMN "principal_portion";--> statement-breakpoint
ALTER TABLE "creditor_repayments" DROP COLUMN "principal_balance_before";--> statement-breakpoint
ALTER TABLE "creditor_repayments" DROP COLUMN "principal_balance_after";