CREATE TYPE "public"."memory_kind" AS ENUM('fact', 'decision', 'preference', 'open_question', 'summary');--> statement-breakpoint
CREATE TABLE "memory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"kind" "memory_kind" NOT NULL,
	"text" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"embedding" vector(1024),
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "text")) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_by" uuid,
	CONSTRAINT "memory_entries_text_length" CHECK (char_length("memory_entries"."text") between 1 and 2000),
	CONSTRAINT "memory_entries_tags_count" CHECK (cardinality("memory_entries"."tags") <= 8)
);
--> statement-breakpoint
CREATE TABLE "memory_settings" (
	"account_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_settings_account_id_connection_id_project_id_pk" PRIMARY KEY("account_id","connection_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_superseded_by_memory_entries_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."memory_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_settings" ADD CONSTRAINT "memory_settings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_settings" ADD CONSTRAINT "memory_settings_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_entries_owner_project_idx" ON "memory_entries" USING btree ("account_id","connection_id","project_id");--> statement-breakpoint
-- Memory is private to its owner (PRD 6.10). The only readers are `mcp` (tools) and `web` (the owner's own page),
-- both through the policies below, keyed on app.account_id. `worker` has no grant: the worker never reads memory text.
-- Admins get nothing extra: no policy looks at accounts.role.
ALTER TABLE memory_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memory_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memory_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memory_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- True when the current account is an active personal account that holds `p_capability` (memory:read or memory:write)
-- on the project and can still read the project (projects:read, files:read or tasks:read, at any scope within it).
CREATE FUNCTION memory_may(p_connection uuid, p_project text, p_capability text) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
        SELECT 1 FROM accounts a WHERE a.id = app_account_id() AND a.status = 'active' AND a.type = 'personal'
      )
      AND EXISTS (
        SELECT 1 FROM effective_access ea
        WHERE ea.account_id = app_account_id() AND ea.connection_id = p_connection
        AND ea.capability = p_capability
        AND (ea.project_id IS NULL OR ea.project_id = p_project)
      )
      AND EXISTS (
        SELECT 1 FROM effective_access ea
        WHERE ea.account_id = app_account_id() AND ea.connection_id = p_connection
        AND ea.capability IN ('projects:read', 'files:read', 'tasks:read')
        AND (ea.project_id IS NULL OR ea.project_id = p_project)
      )
  $$;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON memory_entries TO mcp, web;
--> statement-breakpoint
-- Entries are never edited in place: an edit inserts a new version and only points the old row at it.
GRANT UPDATE (superseded_by) ON memory_entries TO mcp, web;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON memory_settings TO mcp, web;
--> statement-breakpoint
CREATE POLICY memory_entries_read ON memory_entries FOR SELECT TO mcp, web
  USING (account_id = app_account_id() AND memory_may(connection_id, project_id, 'memory:read'));
--> statement-breakpoint
CREATE POLICY memory_entries_insert ON memory_entries FOR INSERT TO mcp, web
  WITH CHECK (account_id = app_account_id() AND memory_may(connection_id, project_id, 'memory:write'));
--> statement-breakpoint
CREATE POLICY memory_entries_update ON memory_entries FOR UPDATE TO mcp, web
  USING (account_id = app_account_id() AND memory_may(connection_id, project_id, 'memory:write'))
  WITH CHECK (account_id = app_account_id() AND memory_may(connection_id, project_id, 'memory:write'));
--> statement-breakpoint
CREATE POLICY memory_entries_delete ON memory_entries FOR DELETE TO mcp, web
  USING (account_id = app_account_id() AND memory_may(connection_id, project_id, 'memory:write'));
--> statement-breakpoint
CREATE POLICY memory_settings_read ON memory_settings FOR SELECT TO mcp, web
  USING (account_id = app_account_id() AND memory_may(connection_id, project_id, 'memory:read'));
--> statement-breakpoint
CREATE POLICY memory_settings_insert ON memory_settings FOR INSERT TO mcp, web
  WITH CHECK (account_id = app_account_id() AND memory_may(connection_id, project_id, 'memory:write'));
--> statement-breakpoint
CREATE POLICY memory_settings_update ON memory_settings FOR UPDATE TO mcp, web
  USING (account_id = app_account_id() AND memory_may(connection_id, project_id, 'memory:write'))
  WITH CHECK (account_id = app_account_id() AND memory_may(connection_id, project_id, 'memory:write'));
