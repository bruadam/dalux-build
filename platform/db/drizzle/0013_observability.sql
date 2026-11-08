CREATE TABLE "auth_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"account_id" uuid,
	"token_prefix" text,
	"connection_slug" text,
	"request_id" text,
	"client_ip" text,
	"forwarded_for" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "client_ip" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "forwarded_for" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "auth_method" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "credential_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "mcp_session_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "file_area_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "file_ids" text[];--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "file_count" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "result_items" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "result_bytes" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "result_truncated" boolean;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "denial_reason" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "dalux_calls" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "dalux_errors" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "dalux_rate_limited" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "mistral_tokens" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "agent_name" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "query_text" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "log_query_text" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ip_logging" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ip_retention_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_events_at_idx" ON "auth_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "auth_events_reason_idx" ON "auth_events" USING btree ("reason","at");--> statement-breakpoint
CREATE INDEX "audit_log_request_idx" ON "audit_log" USING btree ("request_id");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_ip_logging" CHECK ("settings"."ip_logging" in ('full', 'truncated', 'off'));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_ip_retention" CHECK ("settings"."ip_retention_days" >= 1);
--> statement-breakpoint
-- Row-level security for the activity log: people read their own rows, admins all. Reads run in withAccount().
GRANT SELECT, INSERT ON auth_events TO web;
--> statement-breakpoint
GRANT INSERT ON auth_events TO mcp;
--> statement-breakpoint
-- The worker clears IP columns after the IP retention period and deletes auth events with the audit retention.
GRANT SELECT (at, client_ip, forwarded_for), UPDATE (client_ip, forwarded_for), DELETE ON auth_events TO worker;
--> statement-breakpoint
GRANT SELECT (at, client_ip, forwarded_for), UPDATE (client_ip, forwarded_for) ON audit_log TO worker;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE auth_events_id_seq TO web, mcp, worker;
--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_insert ON audit_log FOR INSERT TO web, mcp WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY audit_log_worker ON audit_log FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY audit_log_read ON audit_log FOR SELECT TO web USING (
    account_id = app_account_id()
    OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = app_account_id() AND a.role = 'admin' AND a.status = 'active')
  );
--> statement-breakpoint
CREATE POLICY auth_events_insert ON auth_events FOR INSERT TO web, mcp WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_events_worker ON auth_events FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_events_read ON auth_events FOR SELECT TO web USING (
    account_id = app_account_id()
    OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = app_account_id() AND a.role = 'admin' AND a.status = 'active')
  );
