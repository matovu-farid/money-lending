CREATE TYPE "public"."loan_type" AS ENUM('perpetual', 'fixed_rate', 'reducing_balance');--> statement-breakpoint
ALTER TYPE "public"."loan_status" ADD VALUE 'pending' BEFORE 'active';--> statement-breakpoint
ALTER TABLE "loans" DROP CONSTRAINT "loans_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_participants" DROP CONSTRAINT "conversation_participants_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_sender_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "financial_snapshots" ALTER COLUMN "data" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "nin" text NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "loan_type" "loan_type" DEFAULT 'perpetual' NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "term_months" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "marked_wrong" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "marked_wrong_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "marked_wrong_by" text;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_entity_type" ON "audit_log" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "idx_audit_occurred_at" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_id" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_creditor_repayments_investment_id" ON "creditor_repayments" USING btree ("investment_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_date" ON "transactions" USING btree ("transaction_date");--> statement-breakpoint
CREATE INDEX "idx_transactions_category_id" ON "transactions" USING btree ("category_id");