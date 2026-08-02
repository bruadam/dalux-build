---
"dalux-build-api": patch
---

Finish wiring `webhook-ui` to Supabase as a real multi-tenant backend: Supabase Auth (email/password + optional OAuth) replaces the half-migrated Clerk setup, saved Dalux credentials and registered webhooks are now persisted and manageable from new "Credentials" and "Webhooks" sidebar pages, and webhook limits are enforced per subscription tier.

The monitor service gains an optional `testCallback` alongside the production `callback` (e.g. n8n's `/webhook-test/` vs `/webhook/` URLs), and `POST /jobs/{id}/test` now builds its event from real, currently-selected Dalux files instead of a placeholder. `PATCH /jobs/{id}` can pause/resume a job without deleting it, re-arming the schedule on resume so a paused job doesn't fire a backlog of missed runs.
