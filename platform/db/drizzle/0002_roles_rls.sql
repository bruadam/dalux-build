-- Database roles (PRD 7.4). The migrating user owns all objects; `migrate`
-- sets LOGIN passwords for these roles from the environment.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'web') THEN CREATE ROLE web NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mcp') THEN CREATE ROLE mcp NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'worker') THEN CREATE ROLE worker NOLOGIN; END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO web, mcp, worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  accounts, groups, group_memberships, grants, connections, dalux_user_links,
  api_tokens, oauth_clients, oauth_codes, oauth_sessions, oauth_tokens, settings
  TO web;
--> statement-breakpoint
GRANT SELECT ON effective_access TO web;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO web;
--> statement-breakpoint
GRANT SELECT ON
  accounts, connections, dalux_user_links, api_tokens, oauth_clients,
  oauth_sessions, oauth_tokens, settings, effective_access, indexes, documents, chunks
  TO mcp;
--> statement-breakpoint
GRANT UPDATE (last_used_at) ON api_tokens, oauth_sessions TO mcp;
--> statement-breakpoint
GRANT INSERT ON audit_log TO mcp, worker;
--> statement-breakpoint
GRANT SELECT ON accounts, connections, settings TO worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON dalux_user_links, indexes, documents, chunks TO worker;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE audit_log_id_seq TO web, mcp, worker;
--> statement-breakpoint
CREATE FUNCTION app_account_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.account_id', true), '')::uuid $$;
--> statement-breakpoint
-- Rebuilds effective_access from direct and group grants of active accounts.
-- Call after any change to grants, groups, memberships, or account status.
CREATE FUNCTION refresh_effective_access() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('refresh_effective_access'));
  DELETE FROM effective_access;
  INSERT INTO effective_access (account_id, grant_id, connection_id, project_id, file_area_id, folder_id, capability)
  SELECT DISTINCT p.account_id, g.id, g.connection_id, g.project_id, g.file_area_id, g.folder_id, c.capability
  FROM grants g
  CROSS JOIN LATERAL unnest(g.capabilities) AS c(capability)
  CROSS JOIN LATERAL (
    SELECT g.account_id WHERE g.account_id IS NOT NULL
    UNION
    SELECT m.account_id FROM group_memberships m WHERE m.group_id = g.group_id
  ) AS p(account_id)
  JOIN accounts a ON a.id = p.account_id AND a.status = 'active';
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION refresh_effective_access() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION refresh_effective_access() TO web, worker;
--> statement-breakpoint
ALTER TABLE indexes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE indexes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chunks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY indexes_worker ON indexes FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY documents_worker ON documents FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY chunks_worker ON chunks FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY indexes_mcp_read ON indexes FOR SELECT TO mcp USING (
    CASE indexes.kind
      WHEN 'docs' THEN EXISTS (
        SELECT 1 FROM accounts a WHERE a.id = app_account_id() AND a.status = 'active'
      )
      ELSE EXISTS (
        SELECT 1 FROM effective_access ea
        WHERE ea.account_id = app_account_id()
        AND ea.connection_id = indexes.connection_id
        AND ea.capability = CASE indexes.kind WHEN 'file' THEN 'files:read' ELSE 'tasks:read' END
        AND (ea.project_id IS NULL OR ea.project_id = indexes.project_id)
        AND (ea.file_area_id IS NULL OR ea.file_area_id = indexes.file_area_id)
      )
    END
  );
--> statement-breakpoint
CREATE POLICY documents_mcp_read ON documents FOR SELECT TO mcp USING (
    CASE documents.kind
      WHEN 'docs' THEN EXISTS (
        SELECT 1 FROM accounts a WHERE a.id = app_account_id() AND a.status = 'active'
      )
      ELSE EXISTS (
        SELECT 1 FROM effective_access ea
        WHERE ea.account_id = app_account_id()
        AND ea.connection_id = documents.connection_id
        AND ea.capability = CASE documents.kind WHEN 'file' THEN 'files:read' ELSE 'tasks:read' END
        AND (ea.project_id IS NULL OR ea.project_id = documents.project_id)
        AND (ea.file_area_id IS NULL OR ea.file_area_id = documents.file_area_id)
        AND (ea.folder_id IS NULL OR documents.folder_ancestor_ids @> ARRAY[ea.folder_id])
      )
    END
  );
--> statement-breakpoint
CREATE POLICY chunks_mcp_read ON chunks FOR SELECT TO mcp USING (
    CASE chunks.kind
      WHEN 'docs' THEN EXISTS (
        SELECT 1 FROM accounts a WHERE a.id = app_account_id() AND a.status = 'active'
      )
      ELSE EXISTS (
        SELECT 1 FROM effective_access ea
        WHERE ea.account_id = app_account_id()
        AND ea.connection_id = chunks.connection_id
        AND ea.capability = CASE chunks.kind WHEN 'file' THEN 'files:read' ELSE 'tasks:read' END
        AND (ea.project_id IS NULL OR ea.project_id = chunks.project_id)
        AND (ea.file_area_id IS NULL OR ea.file_area_id = chunks.file_area_id)
        AND (ea.folder_id IS NULL OR chunks.folder_ancestor_ids @> ARRAY[ea.folder_id])
      )
    END
  );
