---
title: Webhook Server
nav_order: 6
---

# Webhook Server

Dalux doesn't provide webhooks. `webhook-server/` creates them by polling
the documented `GET /6.1/projects/{projectId}/file_areas/{fileAreaId}/files`
endpoint on persistent cron schedules, comparing the result with SQLite
state, and POSTing batched results to a callback (n8n, your own endpoint).
It stores metadata only, never file contents; API keys and callback secrets
are encrypted at rest with a Fernet master key.

## Docker quick start

```bash
cd webhook-server
docker compose --profile setup run --rm setup   # generates .env, management token, master key
docker compose up --build -d
docker compose logs -f monitor
curl http://localhost:8000/healthz
```

This runs the monitor API on `http://localhost:8000` only — the
registration UI is a separate app, see [Webhook UI](webhook-ui.html).
Configure Clerk keys (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`)
in `.env` before using it.

## Run locally without Docker

```bash
cd webhook-server
uv sync --extra dev
uv run python -m dalux_webhook
```

uv is configured to install `dalux-build` from `../python`, so this doesn't
depend on an unreleased PyPI version.

## Register a change monitor

```bash
curl -X POST http://localhost:8000/jobs/change \
  -H 'Authorization: Bearer YOUR_MONITOR_TOKEN' \
  -H 'Idempotency-Key: project-1-models' \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": "project-id", "fileAreaId": "file-area-id",
    "daluxApiKey": "dalux-api-key", "cron": "*/15 * * * *",
    "timezone": "Europe/Copenhagen",
    "scope": {"mode": "fileIds", "fileIds": ["file-1"]},
    "initialRun": "baseline",
    "callback": {"url": "https://n8n.example/webhook/dalux", "authType": "hmac-sha256", "secret": "callback-secret"}
  }'
```

One `dalux.files.changed` payload per poll containing added/modified/deleted
entries; unchanged polls stay silent. Use `{"mode":"all"}` to monitor an
entire file area.

## Register a freshness monitor

```bash
curl -X POST http://localhost:8000/jobs/freshness \
  -H 'Authorization: Bearer YOUR_MONITOR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": "project-id", "fileAreaId": "file-area-id",
    "daluxApiKey": "dalux-api-key", "cron": "0 9 * * 1",
    "folderIds": ["coordination-folder-id"],
    "fileNameFilter": {"extensions": ["ifc"], "contains": ["coordination"]},
    "maxAge": "P1D",
    "callback": {"url": "https://n8n.example/webhook/freshness"}
  }'
```

Freshness jobs always emit `compliant` plus violations; `maxAge` is
whole-days only (Dalux reports `lastModified` at date precision).

Delete a job with `DELETE /jobs/{jobId}`. Pause or resume one without losing
its saved state with `PATCH /jobs/{jobId}` (`{"enabled": false}`) — resuming
re-arms the schedule from the current time so a long-paused job doesn't fire
a backlog of missed runs. Callback auth can be `none`, `bearer`, or
`hmac-sha256` (`X-Webhook-Signature: sha256=<hex>`); every attempt carries a
stable `X-Delivery-ID` for dedup, since retries are at-least-once.

### Test vs. production callback

Registration accepts an optional `testCallback` alongside `callback` — for
example n8n's editor-only `/webhook-test/<id>` URL as `testCallback`, and its
always-on `/webhook/<id>` URL as `callback`:

```json
{
  "callback": {"url": "https://n8n.example/webhook/dalux"},
  "testCallback": {"url": "https://n8n.example/webhook-test/dalux"}
}
```

`POST /jobs/{jobId}/test` sends to `testCallback` when one is registered,
otherwise falls back to `callback`. Instead of a placeholder file, the event
is built from the job's real, currently-selected Dalux files: change jobs
include both `changed` and `unchanged` arrays from the selected files compared
to the last known snapshot; freshness jobs put all selected files in
`violations` using their real file payloads. Nothing is written to stored
snapshots or the retry outbox.

## Embedded mode

The same scheduler and management API are importable directly from Python
via `dalux.webhook_server` — no separate deployment. See
[Python Client](python-client.html#embedded-webhook-server).

## Full reference

The complete management API and outbound payload contract:
[`webhook-server/openapi.yaml`](https://github.com/bruadam/dalux-build/blob/main/webhook-server/openapi.yaml)
(a running server also serves this interactively at `/docs` and
`/openapi.json`). Full setup, credential rotation, and security notes:
[webhook-server/README.md](https://github.com/bruadam/dalux-build/blob/main/webhook-server/README.md).
