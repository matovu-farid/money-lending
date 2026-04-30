CREATE TABLE "admin_ip_allowlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"ip" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_block_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"ip" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"path" text
);
--> statement-breakpoint
ALTER TABLE "admin_ip_allowlist" ADD CONSTRAINT "admin_ip_allowlist_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_block_log" ADD CONSTRAINT "ip_block_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_ip_allowlist_user_ip_idx" ON "admin_ip_allowlist" USING btree ("user_id","ip");--> statement-breakpoint
CREATE INDEX "admin_ip_allowlist_ip_idx" ON "admin_ip_allowlist" USING btree ("ip");--> statement-breakpoint
CREATE INDEX "admin_ip_allowlist_user_idx" ON "admin_ip_allowlist" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ip_block_log_attempted_at_idx" ON "ip_block_log" USING btree ("attempted_at");
