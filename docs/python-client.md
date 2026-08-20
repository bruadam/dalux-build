---
title: Python Client
nav_order: 5
---

# Python Client

`dalux-build` is a lightweight Python client for the
[Dalux Build REST API](https://app.swaggerhub.com/apis-docs/Dalux/DaluxBuild-api/4.14).
Requires Python 3.10+ and [requests](https://pypi.org/project/requests/) ≥ 2.28.

```bash
pip install dalux-build
```

```python
from dalux_build import create_client

dalux = create_client(
    base_url="https://<your-company>.dalux.com/api",
    api_key="YOUR_API_KEY",
)

projects = dalux.projects.list_projects()
tasks = dalux.tasks.get_project_tasks(project_id="my-project-id")
```

The returned `DaluxClient` exposes one attribute per API resource group
(`projects`, `tasks`, `files`, `forms`, …) — 16 in total, see
[API Reference](api-reference.html) for the full list, or
[python/README.md#api-reference](https://github.com/bruadam/dalux-build/blob/main/python/README.md#api-reference)
for every method and path.

> **Note:** The Python client recently refactored pagination methods to make pagination the default behavior with cleaner names (e.g., `get_files()` instead of `get_all_files()`). See the [Migration Guide](python-api-migration-v2.html) for details. Old method names are still supported with deprecation warnings for backward compatibility.

## Client-level defaults

Most methods take `project_id` (and `file_area_id`) as keyword-only args.
Set defaults once if you mostly work against one project:

```python
dalux = create_client(
    base_url="https://<your-company>.dalux.com/api",
    api_key="YOUR_API_KEY",
    project_id="my-project-id",       # or env var DALUX_PROJECT_ID
    file_area_id="my-file-area-id",   # or env var DALUX_FILE_AREA_ID
)

dalux.tasks.get_project_tasks()                          # uses the default
dalux.tasks.get_project_tasks(project_id="other-project") # explicit wins
```

## `full_response` and `to_dataframe`

List methods default to returning a plain `list[...]`. Pass
`full_response=True` for the full response model (`.metadata`, `.links`), or
`to_dataframe=True` to flatten items directly into a pandas `DataFrame`
(nested fields become `::`-separated columns, e.g. `owner::userId`):

```python
df = dalux.tasks.get_project_tasks(project_id="p1", to_dataframe=True)
df.columns  # Index(['taskId', 'title', 'type::typeId', ...])
```

`pandas` is required only if you use `to_dataframe=True`
(`pip install pandas`).

## Embedded webhook server

`dalux.webhook_server` runs the same polling scheduler and management API as
the standalone [webhook server](webhook-server.html), embedded directly in a
Python process — no separate deployment:

```python
from cryptography.fernet import Fernet

dalux.webhook_server.start(
    management_token="local-admin-token",
    master_key=Fernet.generate_key().decode(),
    state_db_path="monitor.sqlite3",
)
job_id = dalux.webhook_server.register_change_job(
    project_id="p1", file_area_id="fa1", cron="*/15 * * * *",
    scope="fileIds", file_ids=["f1"], initial_run="baseline",
    callback_url="https://n8n.example/webhook/dalux",
)
```

Full details:
[python/docs/webhook_server.md](https://github.com/bruadam/dalux-build/blob/main/python/docs/webhook_server.md).

## Error handling

All methods raise `requests.HTTPError` on 4xx/5xx:

```python
import requests
try:
    dalux.projects.get_project(project_id="unknown-id")
except requests.HTTPError as exc:
    print(exc.response.status_code, exc.response.json())
```

## Full reference

See [python/README.md](https://github.com/bruadam/dalux-build/blob/main/python/README.md)
for: every API namespace with method/HTTP/path tables, individual API-class
instantiation, and testing instructions.
