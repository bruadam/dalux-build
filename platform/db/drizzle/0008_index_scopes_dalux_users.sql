CREATE TYPE "public"."index_run_status" AS ENUM('running', 'ok', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "dalux_users" (
	"connection_id" uuid NOT NULL,
	"dalux_user_id" text NOT NULL,
	"email" text,
	"name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dalux_users_connection_id_dalux_user_id_pk" PRIMARY KEY("connection_id","dalux_user_id")
);
--> statement-breakpoint
CREATE TABLE "index_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" "index_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"index_external_id" text,
	"items_in_scope" integer,
	"items_indexed" integer,
	"items_reused" integer,
	"items_removed" integer,
	"items_pending" integer,
	"total_chunks" integer,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding_model" text,
	"embedding_tokens" integer,
	"embedding_tokens_estimated" boolean DEFAULT false NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "index_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" "index_kind" NOT NULL,
	"name" text NOT NULL,
	"scope" jsonb NOT NULL,
	"interval_minutes" integer DEFAULT 360 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"refresh_requested_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_run_status" "index_run_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "index_scopes_interval" CHECK ("index_scopes"."interval_minutes" >= 15)
);
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "dalux_users_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "dalux_users_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "dalux_users_sync_error" text;--> statement-breakpoint
ALTER TABLE "dalux_users" ADD CONSTRAINT "dalux_users_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_runs" ADD CONSTRAINT "index_runs_scope_id_index_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."index_scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_scopes" ADD CONSTRAINT "index_scopes_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "index_runs_scope_idx" ON "index_runs" USING btree ("scope_id","started_at");--> statement-breakpoint
CREATE INDEX "index_scopes_connection_idx" ON "index_scopes" USING btree ("connection_id");--> statement-breakpoint
-- Index scopes are defined in the interface (admins) and run by the worker.
GRANT SELECT, INSERT, UPDATE, DELETE ON index_scopes TO web;--> statement-breakpoint
GRANT SELECT ON index_runs, dalux_users TO web;--> statement-breakpoint
GRANT SELECT, UPDATE ON index_scopes TO worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON index_runs TO worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON dalux_users TO worker;--> statement-breakpoint
GRANT UPDATE (dalux_users_synced_at, dalux_users_sync_error) ON connections TO worker;--> statement-breakpoint
-- pg-boss keeps the worker's jobs in its own schema, owned by the worker role (created with createSchema: false).
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION worker;
