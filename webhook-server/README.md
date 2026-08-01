# Dalux Scheduled Monitor

Dalux does not provide webhooks. This service creates them by polling the
documented `GET /6.1/projects/{projectId}/file_areas/{fileAreaId}/files`
endpoint on persistent cron schedules, comparing the result with SQLite state,
and POSTing batched results to destinations such as n8n.

It stores metadata only, never file contents. API keys and callback secrets are
encrypted with a Fernet master key. Each poll follows Dalux bookmark
pagination and replaces the job's previous raw-page snapshot.

## Configuration

The Docker setup command creates `.env`, generates the management token and
master key, and asks you to confirm that both were saved. A management token and
master key are required. `DALUX_BASE_URL` is only a default; every job stores
its resolved base URL and its own encrypted Dalux API key.

Run locally with:

```bash
uv sync --extra dev
uv run python -m dalux_webhook
```

The repository configures uv to install `dalux-build` from `../python`, so it
does not depend on an unreleased PyPI version. If you already activated the
repository-root virtual environment, use `uv sync --active --extra dev` and
run `python -m dalux_webhook` directly.

For Docker, run the setup profile before starting the monitor. Terminate TLS at
a reverse proxy in front of the management API on port 8000 and the registration
UI on port 3000. The UI intentionally has no separate login screen, so protect
port 3000 with your reverse proxy's authentication and do not expose it publicly.

The complete management API and outbound webhook payload contract is available
in [`openapi.yaml`](openapi.yaml). A running server also exposes FastAPI's
interactive UI at `http://localhost:8000/docs` and JSON schema at
`http://localhost:8000/openapi.json`.

## Docker quick start

From the repository's `webhook-server` directory:

```bash
docker compose --profile setup run --rm setup
# Save both displayed credentials and type SAVED when prompted.
# Optionally edit DALUX_BASE_URL in the generated .env, then:
docker compose up --build -d
docker compose logs -f monitor
```

Open `http://localhost:3000` to register a webhook with the guided interface.
It connects to Dalux through a server-side proxy, lets you browse projects,
file areas, folders, and files, and registers change or freshness jobs with the
monitor over the private Compose network. The UI reads the management token
from the same Docker secret as the monitor; it never sends that token to the
browser. `DALUX_BASE_URL` defaults to
`https://node1.field.dalux.com/service/api/` and can be changed in the UI for
an individual job.

For UI development outside Docker, run `npm install && npm run dev` in
`webhook-server/ui` and set `MONITOR_API_TOKEN` plus, if needed,
`MONITOR_INTERNAL_URL` (defaults to `http://127.0.0.1:8000`).

The setup command preserves existing credentials, updates their `.env` entries,
and synchronizes Compose-mounted copies under `secrets/`, all with `0600`
permissions. The mounted files keep credential values out of `docker inspect`.
The command does not rotate secrets on subsequent runs. Keep `.env` backed up
securely: changing or losing the master key makes existing encrypted job
credentials unreadable. Confirm startup with:

```bash
curl http://localhost:8000/healthz
```

The management bearer token is `MONITOR_API_TOKEN` in `.env`. The Dalux API key
is not a server-wide secret; send it in each job registration, where it is
encrypted before storage. The registration UI holds the key only in page memory
while browsing and passes it to the monitor when you submit the job.

For n8n, create and activate a Webhook node before registering its production
URL as `callback.url`. If n8n runs outside this container, do not use
`localhost` as the callback host: from inside the monitor container,
`localhost` refers to the monitor itself.

## Register a change monitor

```bash
curl -X POST http://localhost:8000/jobs/change \
  -H 'Authorization: Bearer YOUR_MONITOR_TOKEN' \
  -H 'Idempotency-Key: project-1-models' \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": "project-id",
    "fileAreaId": "file-area-id",
    "daluxApiKey": "dalux-api-key",
    "cron": "*/15 * * * *",
    "timezone": "Europe/Copenhagen",
    "scope": {"mode": "fileIds", "fileIds": ["file-1"]},
    "initialRun": "baseline",
    "callback": {
      "url": "https://n8n.example/webhook/dalux",
      "authType": "hmac-sha256",
      "secret": "callback-secret"
    }
  }'
```

Use `{"mode":"all"}` to monitor the entire file area. Later polls emit one
`dalux.files.changed` payload containing added, modified, and deleted entries.
An unchanged poll stays silent.

## Register a freshness monitor

```bash
curl -X POST http://localhost:8000/jobs/freshness \
  -H 'Authorization: Bearer YOUR_MONITOR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": "project-id",
    "fileAreaId": "file-area-id",
    "daluxApiKey": "dalux-api-key",
    "cron": "0 9 * * 1",
    "timezone": "Europe/Copenhagen",
    "folderIds": ["coordination-folder-id"],
    "fileNameFilter": {"extensions": ["ifc"], "contains": ["coordination"]},
    "maxAge": "P1D",
    "callback": {"url": "https://n8n.example/webhook/freshness"}
  }'
```

Freshness jobs always emit `compliant` plus violations. Use `folderIds` to
apply filename filters only to selected folders; omit it or send an empty array
to include the whole file area. `maxAge` accepts whole days only because Dalux
reports `lastModified` at date precision. The registration UI previews the
matching files before schedule and delivery fields become available.

Delete a job with authenticated `DELETE /jobs/{jobId}`. `GET /healthz` is an
unauthenticated liveness endpoint and includes the failed-delivery count.

Test an existing job's saved n8n callback without waiting for Dalux or changing
its baseline:

```bash
curl -X POST http://localhost:8000/jobs/JOB_ID/test \
  -H 'Authorization: Bearer YOUR_MONITOR_TOKEN'
```

The service sends a realistic event with `"test": true` and returns its
delivery ID plus n8n's HTTP status. For an n8n Test URL, configure that URL on
the job and click **Listen for test event** before calling this endpoint. For a
Production URL, set the n8n Webhook node to `POST` and activate the workflow.
After creating a job, the registration UI provides actions to send this test
event or delete the job and its saved state.

Callback authentication can be `none`, `bearer`, or `hmac-sha256`. HMAC uses
the exact JSON body and the `X-Webhook-Signature: sha256=<hex>` header. Every
attempt also carries a stable `X-Delivery-ID`; consumers should deduplicate on
that value because retries are at-least-once.
