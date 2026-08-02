-- ============================================
-- Track the external monitor service's recurring job for each registered
-- webhook, so the UI can list/test/delete against the right monitor job
-- without re-deriving it, and show the next scheduled run.
-- ============================================

alter table public.webhooks
    add column monitor_job_id varchar(255),
    add column next_run_at timestamptz;

comment on column public.webhooks.monitor_job_id is 'ID of the recurring job on the external monitor service (MONITOR_INTERNAL_URL) backing this webhook.';
comment on column public.webhooks.next_run_at is 'Next scheduled run time reported by the monitor service at registration/last sync.';
