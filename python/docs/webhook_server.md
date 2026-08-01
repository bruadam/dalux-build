# Webhook Server

`dalux_build.webhook_server` is the **receiver** side of a file-change pipeline: it exposes
an HTTP endpoint that *Dalux* calls when a watched file changes, re-confirms the change via
the Dalux Build API (a webhook delivery is treated only as a "check now" signal, never
trusted blindly), downloads the file if it actually changed, and writes a small JSON
provenance sidecar next to it.

This doc covers the **embedded** mode — running the receiver from inside a Python script via
`dalux.webhook_server`. For the standalone, containerized deployment (Docker/Compose, systemd,
cron polling, production hardening), see
[`../../webhook-server/README.md`](../../webhook-server/README.md) — both share the exact same
underlying code (`app.py`, `service.py`, `watchlist.py`, …), just wired up differently.

## Where does the webhook get sent?

**Dalux posts to a URL you host — this package does not register anything with Dalux.**

There are two separate, easy-to-conflate things here:

1. **Receiving** the HTTP callback — this package does. `dalux.webhook_server.start()` boots a
   FastAPI app (in-process, background thread) that listens for `POST /webhooks/dalux`.
2. **Telling Dalux to call that URL** — this package does **not** do this, and can't: the
   public Dalux Build OpenAPI spec has no webhook/subscription resource. Registering your
   server's public URL (e.g. `https://your-host.example.com/webhooks/dalux`) with Dalux is a
   manual, out-of-band step — confirm the process, the payload shape, and the signing scheme
   with Dalux support/product docs.

`WebhookServerApi.register()` / `.unregister()` are unrelated to this — they only add/remove
entries in the **local watch list** (which files to care about), not anything on Dalux's side.
The naming is easy to misread, so it's worth calling out explicitly.

Because of this, embedded mode (a script running on your laptop) is realistically only useful
for local testing against a tunnel (ngrok, etc.) or for the `GET /files/{file_id}` pull-based
endpoint, which needs no inbound registration at all. Real webhook delivery needs a
long-lived, publicly reachable server — that's what the standalone `webhook-server/` deployment
is for.

## Embedded usage

```python
from dalux_build import create_client

dalux = create_client()  # base_url / api_key from DALUX_BASE_URL / DALUX_API_KEY

dalux.webhook_server.start()  # boots FastAPI in a background daemon thread, blocks until ready
print(dalux.webhook_server.webhook_url)  # e.g. http://0.0.0.0:8000/webhooks/dalux

# Tell the receiver which files to care about (local watch list, not a Dalux-side call)
dalux.webhook_server.register(
    project_id="p1",
    file_area_id="fa1",
    file_ids=["f1", "f2"],
)

# ... server runs in the background; incoming webhooks are handled automatically ...

dalux.webhook_server.unregister(["f2"])
dalux.webhook_server.stop()
```

`start()` requires the `webhook` extra (`pip install dalux-build[webhook]`, pulls in
`fastapi`/`uvicorn`/`httpx`); importing `dalux_build` itself never requires it, since those
libraries are only imported lazily inside `start()`.

The Dalux `base_url`/`api_key` are **not** configured here — `WebhookServerApi` reuses the
`ApiClient` (and therefore the `FilesApi`) already authenticated on the `DaluxClient` it came
from, so there's exactly one HTTP session and credential set per client.

Everything else (`host`, `port`, `secret`, `download_dir`, …) can be passed as keyword
arguments to `start()`, or left to fall back to environment variables — see
[Configuration](#configuration) below. Keyword arguments always win over env vars.

## Request flow

When Dalux delivers a webhook:

1. `POST /webhooks/dalux` — signature checked against the `X-Dalux-Signature` header (HMAC
   using the configured secret; verification is skipped if no secret is set, e.g. local dev).
2. Body parsed as JSON; an idempotency key is extracted and checked against a local SQLite
   store — duplicate deliveries short-circuit with `{"status": "duplicate", ...}`.
3. File references are pulled out of the payload (several possible shapes are tolerated) and
   filtered down to whatever's on the **local watch list** — anything not registered is
   silently ignored.
4. For each watched file, the server calls back into the Dalux Build API via the shared
   `FilesApi` — `get_file(...)` to re-fetch fresh metadata (the "don't trust the webhook body"
   step) — and compares `contentHash` / `fileRevisionId` / `(lastModified, fileSize)` against
   the last known state.
5. If it actually changed: `download_file_from_link(...)` saves the new file to `download_dir`,
   and a `<file>.dalux.json` sidecar is written with provenance (`fileId`, `fileRevisionId`,
   `contentHash`, `fileSize`, `lastModified`, `downloadedAt`, …).
6. If a QA webhook/command is configured, it's triggered with the change event.
7. Response: `{"status": "ok", "eventId": ..., "processed": [{"fileId", "changed", "reason",
   "downloadedPath"}, ...]}`.

If anything raises mid-loop, the idempotency mark is rolled back so a retried delivery from
Dalux gets reprocessed instead of being treated as a duplicate.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | Liveness probe; returns `{"status": "ok", "watched_files": N}` |
| `POST` | `/webhooks/dalux` | Receives Dalux file-change webhooks (see flow above) |
| `GET` | `/files/{file_id}` | Pull-based conditional download; honours `If-None-Match` and returns `304` when unchanged. Resolves via the watch list, or `?project_id=&file_area_id=` query params for files not registered |

## Configuration

Environment variables read by `WebhookRuntimeConfig.from_env()` (each has a matching `start()`
keyword argument that takes precedence):

| Env var | Default | Notes |
|---|---|---|
| `DALUX_WEBHOOK_SECRET` (or `_FILE`) | *(empty)* | HMAC secret for verifying `X-Dalux-Signature`; verification is skipped if unset |
| `DALUX_WEBHOOK_SIGNATURE_HEADER` | `X-Dalux-Signature` | Header name carrying the signature |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `8000` | Bind port |
| `DOWNLOAD_DIR` | `./downloads` | Where changed files are saved |
| `STATE_DB_PATH` | `./state.sqlite3` | SQLite file tracking last-known state + processed event ids |
| `WATCHLIST_PATH` | *(unset)* | Optional file to persist the watch list across restarts |
| `QA_WEBHOOK_URL` / `QA_WEBHOOK_TOKEN` (or `_FILE`) | *(unset)* | If set, POSTs the change event here (bearer token) after a download |
| `QA_COMMAND` | *(unset)* | Alternative to the QA webhook: runs a local command with the event JSON on stdin |

`base_url`/`api_key` are **not** part of this config — they belong to the parent
`Configuration`/`ApiClient` (`DALUX_BASE_URL`/`DALUX_API_KEY`).

## Relationship to the rest of the package

- `dalux_build/webhook_server/` holds all the logic (`app.py` FastAPI routes, `service.py`
  wraps `FilesApi` for metadata/download calls, `watchlist.py`, `store.py` SQLite state,
  `metadata.py`/`ifc_metadata.py` change detection + sidecars, `qa.py` downstream trigger,
  `poller.py` polling fallback).
- `dalux_build/webhook_server/api.py`'s `WebhookServerApi` is the thin embedded-mode wrapper
  exposed as `DaluxClient.webhook_server`, covered above.
- The top-level `webhook-server/` package (a separate, deployable unit — see its own
  `pyproject.toml`) imports these same modules and adds a CLI/Docker/env-var-driven runtime
  around them for long-running deployments. It is not a second implementation.
- `poller.py` provides an alternative/complement to inbound webhooks: it periodically re-checks
  every watched file (or lists files updated since a timestamp) using the same
  `DaluxFileService`, useful when inbound webhooks aren't reachable or as a gap-healing pass.
