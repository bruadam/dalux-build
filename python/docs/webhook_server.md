# Embedded Scheduled Monitor

`DaluxClient.webhook_server` runs the same polling scheduler and authenticated
management API as the standalone VPS package. It does not receive callbacks
from Dalux and does not download files.

```python
from cryptography.fernet import Fernet
from dalux_build import create_client
from dalux_build.models import FileNameFilter

dalux = create_client()
dalux.webhook_server.start(
    management_token="local-admin-token",
    master_key=Fernet.generate_key().decode(),
    host="127.0.0.1",
    state_db_path="monitor.sqlite3",
)

job_id = dalux.webhook_server.register_change_job(
    project_id="p1",
    file_area_id="fa1",
    cron="*/15 * * * *",
    timezone="Europe/Copenhagen",
    scope="fileIds",
    file_ids=["f1"],
    initial_run="baseline",
    callback_url="https://n8n.example/webhook/dalux",
)

freshness_id = dalux.webhook_server.register_freshness_job(
    project_id="p1",
    file_area_id="fa1",
    cron="0 9 * * 1",
    folder_ids=["coordination-folder-id"],
    file_name_filter=FileNameFilter(extensions=["ifc"]),
    max_age="P1D",
    callback_url="https://n8n.example/webhook/freshness",
)

dalux.webhook_server.unregister_job(job_id)
dalux.webhook_server.stop()
```

Omitted Dalux credentials inherit from the parent client. Runtime defaults may
also be supplied through `MONITOR_API_TOKEN[_FILE]`,
`MONITOR_MASTER_KEY[_FILE]`, `MONITOR_TIMEZONE`, `STATE_DB_PATH`, `HOST`, and
`PORT`.
