# Dalux Build API – Python Client

A lightweight Python client for the [Dalux Build REST API](https://app.swaggerhub.com/apis-docs/Dalux/DaluxBuild-api/4.14).

## Requirements

- Python 3.8 or later
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
)
```

The returned `DaluxClient` object exposes one attribute per API resource group (see [API Reference](#api-reference) below).

### Examples

**List all projects**
```python
projects = dalux.projects.list_projects()
print(projects)
```

**Get a specific project**
```python
project = dalux.projects.get_project("my-project-id")
print(project)
```

**List tasks on a project**
```python
tasks = dalux.tasks.get_project_tasks(
    "my-project-id",
    params={"updatedAfter": "2024-01-01"},
)
print(tasks)
```

**Upload a file (chunked)**
```python
# 1. Create an upload slot
upload = dalux.file_upload.create_upload(
    "my-project-id", "my-file-area-id",
    {"fileName": "drawing.pdf", "mimeType": "application/pdf"},
)
upload_guid = upload["uploadGuid"]

# 2. Upload the file content
with open("drawing.pdf", "rb") as f:
    dalux.file_upload.upload_file_part(
        "my-project-id", "my-file-area-id", upload_guid, f.read()
    )

# 3. Finalize
result = dalux.file_upload.finish_upload(
    "my-project-id", "my-file-area-id", upload_guid,
    {"folderId": "target-folder-id"},
)
print("New file ID:", result["fileId"])
```

## Authentication

Every request automatically includes the `X-API-KEY` header with the API key supplied to `create_client`. No additional configuration is required.

API keys are managed in the Dalux Build UI under _Settings › Integrations › API Identities_. Contact <support@dalux.com> to activate API access for your company profile.

## Error Handling

All methods raise `requests.HTTPError` on 4xx / 5xx responses:

```python
import requests

try:
    project = dalux.projects.get_project("unknown-id")
except requests.HTTPError as exc:
    print(exc.response.status_code, exc.response.json())
```

## API Reference

| Attribute | Class | Description |
|---|---|---|
| `projects` | `ProjectsApi` | List, get, create and update projects; project metadata |
| `companies` | `CompaniesApi` | Project companies (CRUD) |
| `company_catalog` | `CompanyCatalogApi` | Company catalog (CRUD + metadata) |
| `tasks` | `TasksApi` | Tasks, approvals, safety issues, observations & good practices |
| `file_areas` | `FileAreasApi` | File areas on a project |
| `files` | `FilesApi` | Files within a file area |
| `folders` | `FoldersApi` | Folders within a file area |
| `file_upload` | `FileUploadApi` | Chunked upload (create → part → finalize) |
| `file_revisions` | `FileRevisionsApi` | Download file revision content |
| `forms` | `FormsApi` | Forms and form attachments |
| `users` | `UsersApi` | Company and project users |
| `project_templates` | `ProjectTemplatesApi` | Available project templates |
| `inspection_plans` | `InspectionPlansApi` | Inspection plans, items, zones, registrations |
| `test_plans` | `TestPlansApi` | Test plans, items, zones, registrations |
| `version_sets` | `VersionSetsApi` | Version sets and version set files |
| `work_packages` | `WorkPackagesApi` | Work packages on a project |

### ProjectsApi

| Method | HTTP | Path |
|---|---|---|
| `list_projects(params=None)` | GET | `/5.1/projects` |
| `get_project(project_id)` | GET | `/5.0/projects/{projectId}` |
| `create_project(body)` | POST | `/5.0/projects` |
| `update_project(project_id, body)` | PATCH | `/5.0/projects/{projectId}` |
| `list_metadata_mappings_for_projects()` | GET | `/1.0/projects/metadata/1.0/mappings` |
| `list_metadata_values_for_projects(key)` | GET | `/1.0/projects/metadata/1.0/mappings/{key}/values` |
| `list_project_metadata(project_id)` | GET | `/1.0/projects/{projectId}/metadata` |
| `list_project_metadata_mappings(project_id)` | GET | `/1.0/projects/{projectId}/metadata/1.0/mappings` |
| `list_project_metadata_values(project_id, key)` | GET | `/1.0/projects/{projectId}/metadata/1.0/mappings/{key}/values` |

### CompaniesApi

| Method | HTTP | Path |
|---|---|---|
| `list_project_companies(project_id, params=None)` | GET | `/3.1/projects/{projectId}/companies` |
| `get_project_company(project_id, company_id)` | GET | `/3.0/projects/{projectId}/companies/{companyId}` |
| `create_project_company(project_id, body)` | POST | `/3.1/projects/{projectId}/companies` |
| `update_project_company(project_id, company_id, body)` | PATCH | `/3.0/projects/{projectId}/companies/{companyId}` |

### CompanyCatalogApi

| Method | HTTP | Path |
|---|---|---|
| `get_companies(params=None)` | GET | `/2.2/companyCatalog` |
| `get_company(catalog_company_id)` | GET | `/1.2/companyCatalog/{catalogCompanyId}` |
| `create_company(body)` | POST | `/2.2/companyCatalog` |
| `update_company(catalog_company_id, body)` | PATCH | `/2.1/companyCatalog/{catalogCompanyId}` |
| `list_company_metadata(catalog_company_id)` | GET | `/1.0/companyCatalog/{catalogCompanyId}/metadata` |
| `list_company_metadata_mappings(catalog_company_id)` | GET | `/1.0/companyCatalog/{catalogCompanyId}/metadata/1.0/mappings` |
| `list_company_metadata_values(catalog_company_id, key)` | GET | `/1.0/.../metadata/1.0/mappings/{key}/values` |
| `list_metadata_mappings_for_companies()` | GET | `/1.0/companyCatalog/metadata/1.0/mappings` |
| `list_metadata_values_for_companies(key)` | GET | `/1.0/companyCatalog/metadata/1.0/mappings/{key}/values` |

### TasksApi

| Method | HTTP | Path |
|---|---|---|
| `get_project_tasks(project_id, params=None)` | GET | `/5.1/projects/{projectId}/tasks` |
| `get_task(project_id, task_id)` | GET | `/3.3/projects/{projectId}/tasks/{taskId}` |
| `get_project_task_changes(project_id, params=None)` | GET | `/2.2/projects/{projectId}/tasks/changes` |
| `get_all_project_task_changes(project_id, params=None)` | GET (paginated) | `/2.2/projects/{projectId}/tasks/changes` |
| `get_project_task_attachments(project_id, params=None)` | GET | `/1.1/projects/{projectId}/tasks/attachments` |

### FileAreasApi

| Method | HTTP | Path |
|---|---|---|
| `get_file_areas(project_id, params=None)` | GET | `/5.1/projects/{projectId}/file_areas` |
| `get_file_area(project_id, file_area_id)` | GET | `/1.0/projects/{projectId}/file_areas/{fileAreaId}` |

### FilesApi

Browse (`list_files`, `get_all_files`, …) uses **GET `/6.1/projects/{projectId}/file_areas/{fileAreaId}/files`**. `get_file` uses **5.0** for a single file id (Dalux Build API 4.14).

| Method | HTTP | Path |
|---|---|---|
| `list_files(project_id, file_area_id, params=None)` | GET | `/6.1/projects/{projectId}/file_areas/{fileAreaId}/files` |
| `get_all_files` / `get_all_files_in_folder` / bulk helpers | GET | Same **6.1** browse path (pagination or filtering in the client) |
| `get_file(project_id, file_area_id, file_id)` | GET | `/5.0/projects/{projectId}/file_areas/{fileAreaId}/files/{fileId}` |
| `get_file_properties_mapping(project_id, file_area_id, file_id)` | GET | `/1.0/.../files/{fileId}/properties/1.0/mappings` |
| `get_file_property_mapping_values(project_id, file_area_id, file_property_id)` | GET | `/1.0/.../files/properties/1.0/mappings/{filePropertyId}/values` |

### FoldersApi

| Method | HTTP | Path |
|---|---|---|
| `list_folders(project_id, file_area_id, params=None)` | GET | `/5.1/.../folders` |
| `get_folder(project_id, file_area_id, folder_id)` | GET | `/5.0/.../folders/{folderId}` |
| `get_folder_files_properties(project_id, file_area_id, folder_id)` | GET | `/1.0/.../folders/{folderId}/files/properties/1.0/mappings` |

### FileUploadApi

| Method | HTTP | Path |
|---|---|---|
| `create_upload(project_id, file_area_id, body)` | POST | `/1.0/.../upload` |
| `upload_file_part(project_id, file_area_id, upload_guid, chunk)` | POST | `/1.0/.../upload/{uploadGuid}` |
| `finish_upload(project_id, file_area_id, upload_guid, body)` | POST | `/2.0/.../upload/{uploadGuid}/finalize` |

### FileRevisionsApi

| Method | HTTP | Path |
|---|---|---|
| `get_file_revision_content(project_id, file_area_id, file_id, file_revision_id)` | GET | `/2.0/.../revisions/{fileRevisionId}/content` |

### FormsApi

| Method | HTTP | Path |
|---|---|---|
| `get_project_forms(project_id, params=None)` | GET | `/2.1/projects/{projectId}/forms` |
| `get_form(project_id, form_id)` | GET | `/1.2/projects/{projectId}/forms/{formId}` |
| `get_project_form_attachments(project_id, params=None)` | GET | `/2.1/projects/{projectId}/forms/attachments` |

### UsersApi

| Method | HTTP | Path |
|---|---|---|
| `get_user(user_id)` | GET | `/1.1/users/{userId}` |
| `list_project_users(project_id, params=None)` | GET | `/1.2/projects/{projectId}/users` |
| `get_project_user(project_id, user_id)` | GET | `/1.1/projects/{projectId}/users/{userId}` |

### ProjectTemplatesApi

| Method | HTTP | Path |
|---|---|---|
| `list_project_templates(params=None)` | GET | `/1.1/projectTemplates` |

### InspectionPlansApi

| Method | HTTP | Path |
|---|---|---|
| `list_inspection_plans(project_id, params=None)` | GET | `/1.2/projects/{projectId}/inspectionPlans` |
| `list_inspection_plan_items(project_id, params=None)` | GET | `/1.1/projects/{projectId}/inspectionPlanItems` |
| `list_inspection_plan_item_zones(project_id, params=None)` | GET | `/1.1/projects/{projectId}/inspectionPlanItemZones` |
| `list_inspection_plan_registrations(project_id, params=None)` | GET | `/2.1/projects/{projectId}/inspectionPlanRegistrations` |

### TestPlansApi

| Method | HTTP | Path |
|---|---|---|
| `list_test_plans(project_id, params=None)` | GET | `/1.2/projects/{projectId}/testPlans` |
| `list_test_plan_items(project_id, params=None)` | GET | `/1.1/projects/{projectId}/testPlanItems` |
| `list_test_plan_item_zones(project_id, params=None)` | GET | `/1.1/projects/{projectId}/testPlanItemZones` |
| `list_test_plan_registrations(project_id, params=None)` | GET | `/1.1/projects/{projectId}/testPlanRegistrations` |

### VersionSetsApi

| Method | HTTP | Path |
|---|---|---|
| `get_version_sets(project_id, params=None)` | GET | `/2.1/projects/{projectId}/version_sets` |
| `get_version_set(project_id, version_set_id)` | GET | `/2.0/projects/{projectId}/version_sets/{versionSetId}` |
| `list_file_area_version_sets(project_id, file_area_id, params=None)` | GET | `/2.1/.../file_areas/{fileAreaId}/version_sets` |
| `list_version_set_files(project_id, version_set_id, params=None)` | GET | `/3.0/.../version_sets/{versionSetId}/files` |

### WorkPackagesApi

| Method | HTTP | Path |
|---|---|---|
| `list_work_packages(project_id, params=None)` | GET | `/1.0/projects/{projectId}/workpackages` |

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
tasks    = TasksApi(api_client)
```

## Development

```bash
cd python
pip install -e ".[dev]"
pytest tests/ --cov=dalux_build
```

## Maintainer: PyPI releases

### Automatic (push to `main`)

1. Open a PR and merge to `main` (or push directly). **CI** must pass.
2. When **CI** completes successfully for that push, **Publish Python Package** runs:
   - It only considers commits that change files under `python/`.
   - **Patch `Z`** in `X.Y.Z` is incremented by default (from the last line `version = "…"` in `python/pyproject.toml`).
   - If the **commit message** contains a **full** version token `vX.Y.Z`, that exact version is used (unless it is not greater than the current version, in which case the workflow falls back to a patch bump).
   - If the message contains **`vX.Y`** (two numbers only, no third segment), the version becomes **`X.Y.0`** (same fallback rule if that would not increase semver).
3. The workflow runs tests again, builds, publishes to PyPI, then pushes a sync commit: `chore: release vX.Y.Z [skip pypi]`, pushes tag `vX.Y.Z`, and opens a **GitHub Release** for that tag (auto-generated release notes). That marker makes **CI** skip redundant runs and tells this workflow not to publish again for that commit.

Put an explicit line in the subject or body when you want a new **X.Y** line, for example: `feat: add filters v1.2` or `release v2.0`.

### Manual

- **Actions → Publish Python Package → Run workflow** for a fixed **patch / minor / major** bump (same test → build → publish → sync commit → tag → **GitHub Release** flow, except **release** events below).
- **GitHub Release (published)** still triggers publish **without** changing `pyproject.toml` (the tag must already match the packaged version).

If branch protection blocks pushes from `GITHUB_TOKEN`, set secret **`RELEASE_PAT`** (`contents:write`). Use the same token for checkout and **`GH_TOKEN`** in the release step when you need chained workflows (for example **Publish npm Package** after a release); releases created with the default `GITHUB_TOKEN` do not start new workflow runs.

Configure [PyPI Trusted Publishing](https://docs.pypi.org/trusted-publishers/) for this repo, workflow `python-publish.yml`, environment `pypi`. Remove **`PYPI_API_TOKEN`** when OIDC is active; if the secret remains set, uploads use the token.

## License

MIT
