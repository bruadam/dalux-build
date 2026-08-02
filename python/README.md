# Dalux Build API – Python Client

A lightweight Python client for the
[Dalux Build REST API](https://app.swaggerhub.com/apis-docs/Dalux/DaluxBuild-api/4.14).

See the [Node.js client](../javascript/README.md) (`dalux-build-api`) and the
[webhook server](../webhook-server/README.md) built on this package — the two
clients are versioned, tested, and released together; see
[../CONTRIBUTING.md](../CONTRIBUTING.md). For running the scheduled outbound
webhook monitor embedded in a script via `dalux.webhook_server`, see
[docs/webhook_server.md](docs/webhook_server.md).

## Requirements

- Python 3.10 or later
- [requests](https://pypi.org/project/requests/) ≥ 2.28

## Installation

```bash
pip install dalux-build
```

## Getting Started

```python
from dalux_build import create_client

dalux = create_client(
    base_url="https://<your-company>.dalux.com/api",
    api_key="YOUR_API_KEY",
    project_id="my-project-id",  # optional: see "Client-level defaults" below
)
```

The returned `DaluxClient` object exposes one attribute per API resource group
(see [API Reference](#api-reference) below).

### Examples

**List all projects**

```python
projects = dalux.projects.list_projects()
print(projects)  # list[Project] — pass full_response=True for the full ProjectsListResponse
```

**Get a specific project**

```python
project = dalux.projects.get_project(project_id="my-project-id")
print(project)
```

**List tasks on a project**

```python
tasks = dalux.tasks.get_project_tasks(
    params={"updatedAfter": "2024-01-01"},
    project_id="my-project-id",
)
print(tasks)
```

### Local dashboards

Install the optional Streamlit and Plotly dependencies:

```bash
pip install "dalux-build[dashboard]"
```

Every API namespace exposes the same resource-scoped `dashboard()` method. The
first built-in template is the task lifecycle timeline:

```python
dashboard = dalux.tasks.dashboard(
    template="task-timeline",
    template_options={
        "timezone": "Europe/Copenhagen",
        "task_params": {"typeId": "my-task-type-id"},
    },
)

print(dashboard.url)
dashboard.stop()
```

The call starts a local Streamlit process, opens it in the default browser, and
returns a `DashboardHandle`. Pass `open_browser=False` to start without opening
a tab, or `port=8501` to select a port. The process uses the client's configured
project by default; pass `template_options={"project_id": "another-project"}` to
override it.

Templates are scoped to their owning API. For example,
`dalux.files.dashboard(...)` and `dalux.folders.dashboard(...)` are available
for future file and folder templates, but reject `task-timeline`. Inspect
`dalux.files.available_dashboards` to discover templates registered for that
namespace.

**Upload a file (chunked)**

```python
# 1. Create an upload slot
upload = dalux.file_upload.create_upload(
    {"fileName": "drawing.pdf", "mimeType": "application/pdf"},
    project_id="my-project-id",
    file_area_id="my-file-area-id",
)
upload_guid = upload["uploadGuid"]

# 2. Upload the file content
with open("drawing.pdf", "rb") as f:
    dalux.file_upload.upload_file_part(
        upload_guid, f.read(), project_id="my-project-id", file_area_id="my-file-area-id"
    )

# 3. Finalize
result = dalux.file_upload.finish_upload(
    upload_guid,
    {"folderId": "target-folder-id"},
    project_id="my-project-id",
    file_area_id="my-file-area-id",
)
print("New file ID:", result["fileId"])
```

### Client-level defaults (`project_id` / `file_area_id`)

Most methods take `project_id` (and, where relevant, `file_area_id`) as a
**keyword-only** argument. If you mostly work against a single project, set a
default once on the client and omit it everywhere else:

```python
dalux = create_client(
    base_url="https://<your-company>.dalux.com/api",
    api_key="YOUR_API_KEY",
    project_id="my-project-id",  # or set DALUX_PROJECT_ID
    file_area_id="my-file-area-id",  # or set DALUX_FILE_AREA_ID
)

dalux.tasks.get_project_tasks()  # uses the default project_id
dalux.files.list_files()  # uses the default project_id + file_area_id
dalux.tasks.get_project_tasks(project_id="other-project-id")  # explicit value wins
```

An explicit `project_id`/`file_area_id` passed to a call always overrides the
client default; a `ValidationError` is raised if neither is available.

### `full_response`

List/collection methods (`list_projects`, `get_project_tasks`, `list_files`, …)
default to returning just the plain `list[...]` of items. Pass
`full_response=True` to get the full response model instead, which also exposes
`.metadata` (pagination info) and `.links`:

```python
files = dalux.files.list_files(project_id="p1", file_area_id="fa1")  # list[File]

response = dalux.files.list_files(project_id="p1", file_area_id="fa1", full_response=True)
response.items  # same list[File]
response.metadata  # Metadata(total_items=..., total_remaining_items=...)
response.links  # pagination links
```

### `to_dataframe`

The same list/collection methods also accept `to_dataframe=True`, returning the
items flattened into a [pandas](https://pandas.pydata.org/) `DataFrame` directly
— nested objects are flattened into `::`-separated column names (e.g.
`owner::userId`). Requires pandas to be installed (`pip install pandas`); takes
precedence over `full_response` if both are passed.

```python
df = dalux.tasks.get_project_tasks(project_id="p1", to_dataframe=True)
df.columns  # e.g. Index(['taskId', 'title', 'type::typeId', 'type::name', ...])

# Equivalent to, but shorter than:
response = dalux.tasks.get_project_tasks(project_id="p1", full_response=True)
df = response.to_dataframe() if response else pd.DataFrame()
```

The paginated `get_all_*` helpers (`get_all_files`, `get_all_folders`,
`get_all_project_tasks`, `get_all_inspection_plans`, …) accept
`to_dataframe=True` too — they have no `full_response` mode (they return a bare
list already), but flatten the same way:

```python
df = dalux.files.get_all_files(project_id="p1", file_area_id="fa1", to_dataframe=True)
```

## Authentication

Every request automatically includes the `X-API-KEY` header with the API key
supplied to `create_client`. No additional configuration is required.

API keys are managed in the Dalux Build UI under _Settings › Integrations › API
Identities_. Contact <support@dalux.com> to activate API access for your company
profile.

## Error Handling

All methods raise `requests.HTTPError` on 4xx / 5xx responses:

```python
import requests

try:
    project = dalux.projects.get_project(project_id="unknown-id")
except requests.HTTPError as exc:
    print(exc.response.status_code, exc.response.json())
```

## API Reference

| Attribute           | Class                 | Description                                                    |
| ------------------- | --------------------- | -------------------------------------------------------------- |
| `projects`          | `ProjectsApi`         | List, get, create and update projects; project metadata        |
| `companies`         | `CompaniesApi`        | Project companies (CRUD)                                       |
| `company_catalog`   | `CompanyCatalogApi`   | Company catalog (CRUD + metadata)                              |
| `tasks`             | `TasksApi`            | Tasks, approvals, safety issues, observations & good practices |
| `file_areas`        | `FileAreasApi`        | File areas on a project                                        |
| `files`             | `FilesApi`            | Files within a file area                                       |
| `folders`           | `FoldersApi`          | Folders within a file area                                     |
| `file_upload`       | `FileUploadApi`       | Chunked upload (create → part → finalize)                      |
| `file_revisions`    | `FileRevisionsApi`    | Download file revision content                                 |
| `forms`             | `FormsApi`            | Forms and form attachments                                     |
| `users`             | `UsersApi`            | Company and project users                                      |
| `project_templates` | `ProjectTemplatesApi` | Available project templates                                    |
| `inspection_plans`  | `InspectionPlansApi`  | Inspection plans, items, zones, registrations                  |
| `test_plans`        | `TestPlansApi`        | Test plans, items, zones, registrations                        |
| `version_sets`      | `VersionSetsApi`      | Version sets and version set files                             |
| `work_packages`     | `WorkPackagesApi`     | Work packages on a project                                     |

`project_id` and `file_area_id` are keyword-only in every method below (e.g.
`get_task(task_id, *, project_id=None)`) and fall back to the client's
configured default when omitted — see
[Client-level defaults](#client-level-defaults-project_id--file_area_id). List
methods additionally accept `full_response=False` (see
[`full_response`](#full_response)) and `to_dataframe=False` (see
[`to_dataframe`](#to_dataframe)) — omitted from the signatures below for
brevity.

### ProjectsApi

| Method                                                  | HTTP  | Path                                                           |
| ------------------------------------------------------- | ----- | -------------------------------------------------------------- |
| `list_projects(params=None, full_response=False)`       | GET   | `/5.1/projects`                                                |
| `get_project(*, project_id=None)`                       | GET   | `/5.0/projects/{projectId}`                                    |
| `create_project(body)`                                  | POST  | `/5.0/projects`                                                |
| `update_project(body, *, project_id=None)`              | PATCH | `/5.0/projects/{projectId}`                                    |
| `list_metadata_mappings_for_projects()`                 | GET   | `/1.0/projects/metadata/1.0/mappings`                          |
| `list_metadata_values_for_projects(key)`                | GET   | `/1.0/projects/metadata/1.0/mappings/{key}/values`             |
| `list_project_metadata(*, project_id=None)`             | GET   | `/1.0/projects/{projectId}/metadata`                           |
| `list_project_metadata_mappings(*, project_id=None)`    | GET   | `/1.0/projects/{projectId}/metadata/1.0/mappings`              |
| `list_project_metadata_values(key, *, project_id=None)` | GET   | `/1.0/projects/{projectId}/metadata/1.0/mappings/{key}/values` |

### CompaniesApi

| Method                                                                         | HTTP  | Path                                              |
| ------------------------------------------------------------------------------ | ----- | ------------------------------------------------- |
| `list_project_companies(params=None, full_response=False, *, project_id=None)` | GET   | `/3.1/projects/{projectId}/companies`             |
| `get_project_company(company_id, *, project_id=None)`                          | GET   | `/3.0/projects/{projectId}/companies/{companyId}` |
| `create_project_company(body, *, project_id=None)`                             | POST  | `/3.1/projects/{projectId}/companies`             |
| `update_project_company(company_id, body, *, project_id=None)`                 | PATCH | `/3.0/projects/{projectId}/companies/{companyId}` |

### CompanyCatalogApi

Account-level (not project-scoped) — no `project_id`.

| Method                                                  | HTTP  | Path                                                           |
| ------------------------------------------------------- | ----- | -------------------------------------------------------------- |
| `get_companies(params=None, full_response=False)`       | GET   | `/2.2/companyCatalog`                                          |
| `get_company(catalog_company_id)`                       | GET   | `/1.2/companyCatalog/{catalogCompanyId}`                       |
| `create_company(body)`                                  | POST  | `/2.2/companyCatalog`                                          |
| `update_company(catalog_company_id, body)`              | PATCH | `/2.1/companyCatalog/{catalogCompanyId}`                       |
| `list_company_metadata(catalog_company_id)`             | GET   | `/1.0/companyCatalog/{catalogCompanyId}/metadata`              |
| `list_company_metadata_mappings(catalog_company_id)`    | GET   | `/1.0/companyCatalog/{catalogCompanyId}/metadata/1.0/mappings` |
| `list_company_metadata_values(catalog_company_id, key)` | GET   | `/1.0/.../metadata/1.0/mappings/{key}/values`                  |
| `list_metadata_mappings_for_companies()`                | GET   | `/1.0/companyCatalog/metadata/1.0/mappings`                    |
| `list_metadata_values_for_companies(key)`               | GET   | `/1.0/companyCatalog/metadata/1.0/mappings/{key}/values`       |

### TasksApi

| Method                                                                               | HTTP            | Path                                          |
| ------------------------------------------------------------------------------------ | --------------- | --------------------------------------------- |
| `get_project_tasks(params=None, full_response=False, *, project_id=None)`            | GET             | `/5.1/projects/{projectId}/tasks`             |
| `get_task(task_id, *, project_id=None)`                                              | GET             | `/3.3/projects/{projectId}/tasks/{taskId}`    |
| `get_project_task_changes(params=None, full_response=False, *, project_id=None)`     | GET             | `/2.2/projects/{projectId}/tasks/changes`     |
| `get_all_project_task_changes(params=None, verbose=False, *, project_id=None)`       | GET (paginated) | `/2.2/projects/{projectId}/tasks/changes`     |
| `get_project_task_attachments(params=None, full_response=False, *, project_id=None)` | GET             | `/1.1/projects/{projectId}/tasks/attachments` |

### FileAreasApi

| Method                                                                 | HTTP | Path                                                |
| ---------------------------------------------------------------------- | ---- | --------------------------------------------------- |
| `get_file_areas(params=None, full_response=False, *, project_id=None)` | GET  | `/5.1/projects/{projectId}/file_areas`              |
| `get_file_area(*, project_id=None, file_area_id=None)`                 | GET  | `/1.0/projects/{projectId}/file_areas/{fileAreaId}` |

### FilesApi

Browse (`list_files`, `get_all_files`, …) uses **GET
`/6.1/projects/{projectId}/file_areas/{fileAreaId}/files`**. `get_file` uses
**5.0** for a single file id (Dalux Build API 4.14).

| Method                                                                                      | HTTP | Path                                                               |
| ------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------ |
| `list_files(params=None, full_response=False, *, project_id=None, file_area_id=None)`       | GET  | `/6.1/projects/{projectId}/file_areas/{fileAreaId}/files`          |
| `get_all_files` / `get_all_files_in_folder` / bulk helpers                                  | GET  | Same **6.1** browse path (pagination or filtering in the client)   |
| `get_file(file_id=None, ..., *, path=None, project_id=None, file_area_id=None)`             | GET  | `/5.0/projects/{projectId}/file_areas/{fileAreaId}/files/{fileId}` |
| `get_file_properties_mapping(file_id, *, project_id=None, file_area_id=None)`               | GET  | `/1.0/.../files/{fileId}/properties/1.0/mappings`                  |
| `get_file_property_mapping_values(file_property_id, *, project_id=None, file_area_id=None)` | GET  | `/1.0/.../files/properties/1.0/mappings/{filePropertyId}/values`   |

`bulk_download_files`' own `file_area_id` parameter is the exception: passing
`None` there selects path-based resolution and is intentionally **not**
backfilled from the client default.

### FoldersApi

| Method                                                                                  | HTTP | Path                                                        |
| --------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------- |
| `list_folders(params=None, full_response=False, *, project_id=None, file_area_id=None)` | GET  | `/5.1/.../folders`                                          |
| `get_folder(folder_id, *, project_id=None, file_area_id=None)`                          | GET  | `/5.0/.../folders/{folderId}`                               |
| `get_folder_files_properties(folder_id, *, project_id=None, file_area_id=None)`         | GET  | `/1.0/.../folders/{folderId}/files/properties/1.0/mappings` |

### FileUploadApi

| Method                                                                        | HTTP | Path                                    |
| ----------------------------------------------------------------------------- | ---- | --------------------------------------- |
| `create_upload(body, *, project_id=None, file_area_id=None)`                  | POST | `/1.0/.../upload`                       |
| `upload_file_part(upload_guid, chunk, *, project_id=None, file_area_id=None)` | POST | `/1.0/.../upload/{uploadGuid}`          |
| `finish_upload(upload_guid, body, *, project_id=None, file_area_id=None)`     | POST | `/2.0/.../upload/{uploadGuid}/finalize` |

### FileRevisionsApi

| Method                                                                                        | HTTP | Path                                          |
| --------------------------------------------------------------------------------------------- | ---- | --------------------------------------------- |
| `get_file_revision_content(file_id, file_revision_id, *, project_id=None, file_area_id=None)` | GET  | `/2.0/.../revisions/{fileRevisionId}/content` |

### FormsApi

| Method                                                                    | HTTP | Path                                          |
| ------------------------------------------------------------------------- | ---- | --------------------------------------------- |
| `get_project_forms(params=None, full_response=False, *, project_id=None)` | GET  | `/2.1/projects/{projectId}/forms`             |
| `get_form(form_id, *, project_id=None)`                                   | GET  | `/1.2/projects/{projectId}/forms/{formId}`    |
| `get_project_form_attachments(params=None, *, project_id=None)`           | GET  | `/2.1/projects/{projectId}/forms/attachments` |

### UsersApi

| Method                                                                     | HTTP | Path                                       |
| -------------------------------------------------------------------------- | ---- | ------------------------------------------ |
| `get_user(user_id)`                                                        | GET  | `/1.1/users/{userId}`                      |
| `list_project_users(params=None, full_response=False, *, project_id=None)` | GET  | `/1.2/projects/{projectId}/users`          |
| `get_project_user(user_id, *, project_id=None)`                            | GET  | `/1.1/projects/{projectId}/users/{userId}` |

### ProjectTemplatesApi

| Method                                | HTTP | Path                    |
| ------------------------------------- | ---- | ----------------------- |
| `list_project_templates(params=None)` | GET  | `/1.1/projectTemplates` |

### InspectionPlansApi

| Method                                                                                     | HTTP | Path                                                    |
| ------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------- |
| `list_inspection_plans(params=None, full_response=False, *, project_id=None)`              | GET  | `/1.2/projects/{projectId}/inspectionPlans`             |
| `list_inspection_plan_items(params=None, full_response=False, *, project_id=None)`         | GET  | `/1.1/projects/{projectId}/inspectionPlanItems`         |
| `list_inspection_plan_item_zones(params=None, full_response=False, *, project_id=None)`    | GET  | `/1.1/projects/{projectId}/inspectionPlanItemZones`     |
| `list_inspection_plan_registrations(params=None, full_response=False, *, project_id=None)` | GET  | `/2.1/projects/{projectId}/inspectionPlanRegistrations` |

### TestPlansApi

| Method                                                                               | HTTP | Path                                              |
| ------------------------------------------------------------------------------------ | ---- | ------------------------------------------------- |
| `list_test_plans(params=None, full_response=False, *, project_id=None)`              | GET  | `/1.2/projects/{projectId}/testPlans`             |
| `list_test_plan_items(params=None, full_response=False, *, project_id=None)`         | GET  | `/1.1/projects/{projectId}/testPlanItems`         |
| `list_test_plan_item_zones(params=None, full_response=False, *, project_id=None)`    | GET  | `/1.1/projects/{projectId}/testPlanItemZones`     |
| `list_test_plan_registrations(params=None, full_response=False, *, project_id=None)` | GET  | `/1.1/projects/{projectId}/testPlanRegistrations` |

### VersionSetsApi

| Method                                                                                                 | HTTP | Path                                                    |
| ------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------- |
| `get_version_sets(params=None, full_response=False, *, project_id=None)`                               | GET  | `/2.1/projects/{projectId}/version_sets`                |
| `get_version_set(version_set_id, *, project_id=None)`                                                  | GET  | `/2.0/projects/{projectId}/version_sets/{versionSetId}` |
| `list_file_area_version_sets(params=None, full_response=False, *, project_id=None, file_area_id=None)` | GET  | `/2.1/.../file_areas/{fileAreaId}/version_sets`         |
| `list_version_set_files(version_set_id, params=None, full_response=False, *, project_id=None)`         | GET  | `/3.0/.../version_sets/{versionSetId}/files`            |

### WorkPackagesApi

| Method                                                                     | HTTP | Path                                     |
| -------------------------------------------------------------------------- | ---- | ---------------------------------------- |
| `list_work_packages(params=None, full_response=False, *, project_id=None)` | GET  | `/1.0/projects/{projectId}/workpackages` |

## Advanced Usage

### Using individual API classes directly

```python
from dalux_build.configuration import Configuration
from dalux_build.api_client import ApiClient
from dalux_build.api import ProjectsApi, TasksApi

config = Configuration(
    base_url="https://<company>.dalux.com/api",
    api_key="YOUR_API_KEY",
)
api_client = ApiClient(config)

projects = ProjectsApi(api_client)
tasks = TasksApi(api_client)
```

## Testing

```bash
cd python
pip install -e ".[dev,webhook]"
pytest --cov=dalux_build --cov-report=term-missing
```

CI runs this on Python 3.11 and 3.13, plus the
[webhook server](../webhook-server/)'s own tests against this checkout's
editable install (not the published PyPI package) — see
[`../.github/workflows/tests.yml`](../.github/workflows/tests.yml).

## Releasing

This package is versioned and published together with the Node.js client by
[Changesets](https://github.com/changesets/changesets) — there is no manual edit
of `version` in `pyproject.toml`, and nothing publishes to PyPI unless the full
test suite (Node.js, Python, webhook server) passes first. See
[../CONTRIBUTING.md](../CONTRIBUTING.md#how-releases-work) for the full flow and
[../README.md](../README.md#releasing) for the npm side of it.

## License

MIT
