ALTER TABLE "settings" ADD COLUMN "audit_retention_days" integer DEFAULT 180 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_audit_retention" CHECK ("settings"."audit_retention_days" >= 1);
--> statement-breakpoint
-- The worker applies the retention setting (it needs to read `at` to filter); no other role can delete audit rows.
GRANT SELECT (at), DELETE ON audit_log TO worker;
