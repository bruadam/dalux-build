CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'ok', 'failed', 'limit', 'skipped', 'stopped');--> statement-breakpoint
CREATE TABLE "agent_run_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"content" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"model_tokens" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"output_markdown" text,
	"error" text,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosted_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"template" text,
	"instructions" text NOT NULL,
	"schedule" text,
	"capabilities" text[] NOT NULL,
	"tools" text[] NOT NULL,
	"max_tokens" integer DEFAULT 200000 NOT NULL,
	"max_tool_calls" integer DEFAULT 40 NOT NULL,
	"max_duration_seconds" integer DEFAULT 600 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"paused_reason" text,
	"stopped_by" uuid,
	"run_requested_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_run_status" "agent_run_status",
	"last_run_tokens" integer,
	"last_run_tool_calls" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hosted_agents_limits" CHECK ("hosted_agents"."max_tokens" between 1000 and 2000000 and "hosted_agents"."max_tool_calls" between 1 and 200 and "hosted_agents"."max_duration_seconds" between 30 and 3600)
);
--> statement-breakpoint
ALTER TABLE "agent_run_files" ADD CONSTRAINT "agent_run_files_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_hosted_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."hosted_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_agents" ADD CONSTRAINT "hosted_agents_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_agents" ADD CONSTRAINT "hosted_agents_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_agents" ADD CONSTRAINT "hosted_agents_stopped_by_accounts_id_fk" FOREIGN KEY ("stopped_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hosted_agents_owner_name_idx" ON "hosted_agents" USING btree ("owner_id","name");--> statement-breakpoint
-- Hosted agents (PRD 6.11). Owners manage their own agents. Admins can list every agent and stop it (the
-- definition and the last run's status and counts are on hosted_agents) but cannot read run output: it can
-- quote private memory (PRD 6.10). The worker writes runs and status. `mcp` has no access. The tables are
-- not FORCEd: only the migrator owns them, and it never runs at runtime (admin_stop_agent needs that).
CREATE FUNCTION app_is_admin() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT EXISTS (SELECT 1 FROM accounts a WHERE a.id = app_account_id() AND a.role = 'admin' AND a.status = 'active') $$;
--> statement-breakpoint
ALTER TABLE hosted_agents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agent_run_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hosted_agents TO web;
--> statement-breakpoint
GRANT SELECT ON agent_runs, agent_run_files TO web;
--> statement-breakpoint
GRANT SELECT ON hosted_agents TO worker;
--> statement-breakpoint
GRANT UPDATE (enabled, consecutive_failures, paused_reason, run_requested_at, last_run_at, last_run_status, last_run_tokens, last_run_tool_calls)
  ON hosted_agents TO worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON agent_runs TO worker;
--> statement-breakpoint
GRANT SELECT, INSERT ON agent_run_files TO worker;
--> statement-breakpoint
CREATE POLICY hosted_agents_worker ON hosted_agents FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY agent_runs_worker ON agent_runs FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY agent_run_files_worker ON agent_run_files FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY hosted_agents_read ON hosted_agents FOR SELECT TO web
  USING (owner_id = app_account_id() OR app_is_admin());
--> statement-breakpoint
CREATE POLICY hosted_agents_insert ON hosted_agents FOR INSERT TO web
  WITH CHECK (
    owner_id = app_account_id() AND stopped_by IS NULL
    AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = app_account_id() AND a.status = 'active' AND a.type = 'personal')
  );
--> statement-breakpoint
-- A stopped agent (stopped_by set) cannot be edited or resumed by its owner; only admin_stop_agent clears it.
CREATE POLICY hosted_agents_update ON hosted_agents FOR UPDATE TO web
  USING (owner_id = app_account_id() AND stopped_by IS NULL)
  WITH CHECK (owner_id = app_account_id() AND stopped_by IS NULL);
--> statement-breakpoint
CREATE POLICY hosted_agents_delete ON hosted_agents FOR DELETE TO web
  USING (owner_id = app_account_id());
--> statement-breakpoint
CREATE POLICY agent_runs_read ON agent_runs FOR SELECT TO web
  USING (EXISTS (SELECT 1 FROM hosted_agents a WHERE a.id = agent_runs.agent_id AND a.owner_id = app_account_id()));
--> statement-breakpoint
CREATE POLICY agent_run_files_read ON agent_run_files FOR SELECT TO web
  USING (EXISTS (
    SELECT 1 FROM agent_runs r JOIN hosted_agents a ON a.id = r.agent_id
    WHERE r.id = agent_run_files.run_id AND a.owner_id = app_account_id()
  ));
--> statement-breakpoint
-- The only way an admin changes an agent: stop it, or release a stop so the owner can resume it.
CREATE FUNCTION admin_stop_agent(p_agent uuid, p_stop boolean) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'only admins can stop agents' USING ERRCODE = '42501'; END IF;
  UPDATE hosted_agents SET
    enabled = CASE WHEN p_stop THEN false ELSE enabled END,
    stopped_by = CASE WHEN p_stop THEN app_account_id() ELSE NULL END,
    paused_reason = CASE WHEN p_stop THEN 'Stopped by an admin' ELSE 'Released by an admin; the owner can resume it' END,
    updated_at = now()
  WHERE id = p_agent;
  RETURN FOUND;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION admin_stop_agent(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_stop_agent(uuid, boolean) TO web;
