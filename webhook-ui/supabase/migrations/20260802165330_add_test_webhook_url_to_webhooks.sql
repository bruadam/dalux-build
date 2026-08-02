-- ============================================
-- Track the optional test callback URL registered on the monitor service
-- (e.g. an n8n /webhook-test/ URL, kept separate from the production
-- /webhook/ URL already stored in webhook_url), purely for display/
-- reference in the Webhooks list — the monitor service itself is the
-- source of truth for which URL a test delivery actually goes to.
-- ============================================

alter table public.webhooks
    add column test_webhook_url varchar(1024);

comment on column public.webhooks.test_webhook_url is 'Optional separate callback used for "send test webhook" (e.g. an n8n /webhook-test/ URL); falls back to webhook_url on the monitor service when null.';
