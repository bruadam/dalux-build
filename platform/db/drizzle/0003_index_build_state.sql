ALTER TABLE "indexes" ADD COLUMN "external_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "indexes" ADD COLUMN "build_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "indexes_connection_kind_external_id_key" ON "indexes" USING btree ("connection_id","kind","external_id");--> statement-breakpoint
-- build_state names files the caller may not see; the mcp role reads every other column.
REVOKE SELECT ON indexes FROM mcp;--> statement-breakpoint
GRANT SELECT (id, connection_id, kind, external_id, project_id, file_area_id, scope, embedding_model, embedding_dimensions, created_at, updated_at) ON indexes TO mcp;
