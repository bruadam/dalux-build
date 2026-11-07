ALTER TABLE "oauth_codes" ADD COLUMN "capabilities" text[];--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD COLUMN "capabilities" text[];--> statement-breakpoint
-- The MCP server is the OAuth token endpoint (PRD 6.5 mode B): it registers clients,
-- exchanges codes, creates consent sessions, rotates and revokes tokens.
GRANT INSERT ON oauth_clients TO mcp;--> statement-breakpoint
GRANT SELECT ON oauth_codes TO mcp;--> statement-breakpoint
GRANT UPDATE (used_at) ON oauth_codes TO mcp;--> statement-breakpoint
GRANT INSERT ON oauth_sessions, oauth_tokens TO mcp;--> statement-breakpoint
GRANT UPDATE (revoked_at) ON oauth_sessions, oauth_tokens TO mcp;
