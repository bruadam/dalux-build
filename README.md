# Dalux Build API

API clients for the [Dalux Build REST API](https://app.swaggerhub.com/apis-docs/Dalux/DaluxBuild-api/4.14), available in two languages:

| Language | Location             | Documentation                        |
| -------- | -------------------- | ------------------------------------ |
| Node.js  | [`/`](.)             | See below                            |
| Python   | [`/python`](python/) | [python/README.md](python/README.md) |

---

# Node.js Client

A lightweight Node.js client for the Dalux Build REST API.

## Requirements

- Node.js 14 or later

## Installation

```bash
npm install dalux-build-api
```

## Getting Started

To access the API you need:

1. A company-specific **base URL** (obtain from Dalux support at <support@dalux.com>).
2. An **API key** — managed via _Settings › Integrations › API Identities_ inside the Dalux Build UI.

```js
const { createClient } = require("dalux-build-api");

const dalux = createClient({
  baseUrl: "https://<your-company>.dalux.com/api",
  apiKey: "YOUR_API_KEY",
});
```

The returned object exposes one namespace per API group (see [API Reference](#api-reference) below).

### Examples

**List all projects**

```js
const projects = await dalux.projects.listProjects();
console.log(projects);
```

**Get a specific project**

```js
const project = await dalux.projects.getProject("my-project-id");
console.log(project);
```

**List tasks on a project**

```js
const tasks = await dalux.tasks.getProjectTasks("my-project-id", {
  updatedAfter: "2024-01-01",
});
console.log(tasks);
```

**Tasks: OData `typeId` shorthand and fetch all pages**

`getProjectTasks` forwards OData query options (for example `$filter`). You can also pass `typeId`; it is expanded to `$filter=data/type/typeId eq '<typeId>'` unless you already set `$filter`.

```js
const byType = await dalux.tasks.getProjectTasks("my-project-id", {
  typeId: "some-type-guid",
});

// All pages merged (bookmark pagination; matches Python client behaviour)
const allTasks = await dalux.tasks.getAllProjectTasks(
  "my-project-id",
  { typeId: "some-type-guid" },
  false,
);
```

**Files: browse (6.1), fetch all pages, download**

`listFiles` and `getAllFiles` call **GET `/6.1/projects/{projectId}/file_areas/{fileAreaId}/files`** (Dalux `listFiles`). Supported query parameters include `folderId`, `updatedAfter`, and `includeProperties` (see the official spec). Single-file metadata still uses **GET `/5.0/.../files/{fileId}`** (`getFile`).

```js
const allFiles = await dalux.files.getAllFiles(
  "my-project-id",
  "my-file-area-id",
  { folderId: "folder-guid" },
);

const file = await dalux.files.getFile(
  "my-project-id",
  "my-file-area-id",
  "file-guid",
  {
    download: true,
    savePath: "./downloads",
  },
);

const saved = await dalux.files.downloadFileFromLink(
  downloadUrl,
  "model.ifc",
  "./downloads",
);

await dalux.files.bulkDownloadFolder(
  "my-project-id",
  "my-file-area-id",
  "folder-guid",
  "./out",
  {
    filenameExtensions: [".ifc"],
    verbose: true,
  },
);
```

**Upload a file (chunked)**

```js
const fs = require("fs");

// 1. Create an upload slot
const { uploadGuid } = await dalux.fileUpload.createUpload(
  "my-project-id",
  "my-file-area-id",
  { fileName: "drawing.pdf", mimeType: "application/pdf" },
);

// 2. Upload the file in one chunk
const content = fs.readFileSync("./drawing.pdf");
await dalux.fileUpload.uploadFilePart(
  "my-project-id",
  "my-file-area-id",
  uploadGuid,
  content,
);

// 3. Finalize the upload
const result = await dalux.fileUpload.finishUpload(
  "my-project-id",
  "my-file-area-id",
  uploadGuid,
  { folderId: "target-folder-id" },
);
console.log("New file ID:", result.fileId);
```

## Authentication

Every request automatically includes the `X-API-KEY` header with the API key supplied to `createClient`. No additional configuration is required.

## Error Handling

All methods return Promises. Network or HTTP errors (4xx / 5xx) are thrown as Axios errors, so wrap calls with `try/catch` or `.catch()`:

```js
try {
  const project = await dalux.projects.getProject("unknown-id");
} catch (err) {
  console.error(err.response?.status, err.response?.data);
}
```

## API Reference

All API namespaces are accessible on the object returned by `createClient`:

| Namespace          | Class                 | Description                                                    |
| ------------------ | --------------------- | -------------------------------------------------------------- |
| `projects`         | `ProjectsApi`         | List, get, create and update projects; manage project metadata |
| `companies`        | `CompaniesApi`        | Project companies (CRUD)                                       |
| `companyCatalog`   | `CompanyCatalogApi`   | Company catalog (CRUD + metadata)                              |
| `tasks`            | `TasksApi`            | Tasks, approvals, safety issues, observations & good practices |
| `fileAreas`        | `FileAreasApi`        | File areas on a project                                        |
| `files`            | `FilesApi`            | Files within a file area                                       |
| `folders`          | `FoldersApi`          | Folders within a file area                                     |
| `fileUpload`       | `FileUploadApi`       | Chunked file upload (create slot → upload parts → finalize)    |
| `fileRevisions`    | `FileRevisionsApi`    | Download file revision content                                 |
| `forms`            | `FormsApi`            | Forms and form attachments                                     |
| `users`            | `UsersApi`            | Company and project users                                      |
| `projectTemplates` | `ProjectTemplatesApi` | Available project templates                                    |
| `inspectionPlans`  | `InspectionPlansApi`  | Inspection plans, items, zones and registrations               |
| `testPlans`        | `TestPlansApi`        | Test plans, items, zones and registrations                     |
| `versionSets`      | `VersionSetsApi`      | Version sets and version set files                             |
| `workPackages`     | `WorkPackagesApi`     | Work packages on a project                                     |

### ProjectsApi

| Method                                      | HTTP  | Path                                                           |
| ------------------------------------------- | ----- | -------------------------------------------------------------- |
| `listProjects(params?)`                     | GET   | `/5.1/projects`                                                |
| `getProject(projectId)`                     | GET   | `/5.0/projects/{projectId}`                                    |
| `createProject(body)`                       | POST  | `/5.0/projects`                                                |
| `updateProject(projectId, body)`            | PATCH | `/5.0/projects/{projectId}`                                    |
| `listMetadataMappingsForProjects()`         | GET   | `/1.0/projects/metadata/1.0/mappings`                          |
| `listMetadataValuesForProjects(key)`        | GET   | `/1.0/projects/metadata/1.0/mappings/{key}/values`             |
| `listProjectMetadata(projectId)`            | GET   | `/1.0/projects/{projectId}/metadata`                           |
| `listProjectMetadataMappings(projectId)`    | GET   | `/1.0/projects/{projectId}/metadata/1.0/mappings`              |
| `listProjectMetadataValues(projectId, key)` | GET   | `/1.0/projects/{projectId}/metadata/1.0/mappings/{key}/values` |

### CompaniesApi

| Method                                             | HTTP  | Path                                              |
| -------------------------------------------------- | ----- | ------------------------------------------------- |
| `listProjectCompanies(projectId, params?)`         | GET   | `/3.1/projects/{projectId}/companies`             |
| `getProjectCompany(projectId, companyId)`          | GET   | `/3.0/projects/{projectId}/companies/{companyId}` |
| `createProjectCompany(projectId, body)`            | POST  | `/3.1/projects/{projectId}/companies`             |
| `updateProjectCompany(projectId, companyId, body)` | PATCH | `/3.0/projects/{projectId}/companies/{companyId}` |

### CompanyCatalogApi

| Method                                             | HTTP  | Path                                                                        |
| -------------------------------------------------- | ----- | --------------------------------------------------------------------------- |
| `getCompanies(params?)`                            | GET   | `/2.2/companyCatalog`                                                       |
| `getCompany(catalogCompanyId)`                     | GET   | `/1.2/companyCatalog/{catalogCompanyId}`                                    |
| `createCompany(body)`                              | POST  | `/2.2/companyCatalog`                                                       |
| `updateCompany(catalogCompanyId, body)`            | PATCH | `/2.1/companyCatalog/{catalogCompanyId}`                                    |
| `listCompanyMetadata(catalogCompanyId)`            | GET   | `/1.0/companyCatalog/{catalogCompanyId}/metadata`                           |
| `listCompanyMetadataMappings(catalogCompanyId)`    | GET   | `/1.0/companyCatalog/{catalogCompanyId}/metadata/1.0/mappings`              |
| `listCompanyMetadataValues(catalogCompanyId, key)` | GET   | `/1.0/companyCatalog/{catalogCompanyId}/metadata/1.0/mappings/{key}/values` |
| `listMetadataMappingsForCompanies()`               | GET   | `/1.0/companyCatalog/metadata/1.0/mappings`                                 |
| `listMetadataValuesForCompanies(key)`              | GET   | `/1.0/companyCatalog/metadata/1.0/mappings/{key}/values`                    |

### TasksApi

| Method                                             | HTTP            | Path                                                                                                                                                                   |
| -------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getProjectTasks(projectId, params?)`              | GET             | `/5.2/projects/{projectId}/tasks`                                                                                                                                      |
| `getAllProjectTasks(projectId, params?, verbose?)` | GET (paginated) | `/5.2/projects/{projectId}/tasks` — collects all `items` via `nextPage` / `bookmark`; respects `metadata.totalRemainingItems` or `metadata.totalItems` (Python parity) |
| `getTask(projectId, taskId)`                       | GET             | `/3.3/projects/{projectId}/tasks/{taskId}`                                                                                                                             |
| `getProjectTaskChanges(projectId, params?)`        | GET             | `/2.2/projects/{projectId}/tasks/changes`                                                                                                                              |
| `getProjectTaskAttachments(projectId, params?)`    | GET             | `/1.1/projects/{projectId}/tasks/attachments`                                                                                                                          |

Query params: pass OData options on `getProjectTasks` / `getAllProjectTasks` (for example `$filter`). Shorthand: `typeId` is translated to `$filter=data/type/typeId eq '…'` when `$filter` is not set. `TasksApi.normalizeTaskParams` applies the same rules if you build requests manually.

### FileAreasApi

| Method                               | HTTP | Path                                                |
| ------------------------------------ | ---- | --------------------------------------------------- |
| `getFileAreas(projectId, params?)`   | GET  | `/5.1/projects/{projectId}/file_areas`              |
| `getFileArea(projectId, fileAreaId)` | GET  | `/1.0/projects/{projectId}/file_areas/{fileAreaId}` |

### FilesApi

Browse and paginated helpers use **route version 6.1** for the file collection. `getFile` (one file by id) uses **5.0**, as in the [Dalux Build API](https://app.swaggerhub.com/apis-docs/Dalux/DaluxBuild-api/4.14).

| Method                                                                    | HTTP            | Path                                                                                                            |
| ------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------- |
| `listFiles(projectId, fileAreaId, params?)`                               | GET             | `/6.1/projects/{projectId}/file_areas/{fileAreaId}/files`                                                       |
| `getAllFiles(projectId, fileAreaId, params?, verbose?)`                   | GET (paginated) | Same — all file `items` via bookmark / `metadata.totalRemainingItems`                                           |
| `getAllFilesInFolder(projectId, fileAreaId, folderId, params?, verbose?)` | —               | Uses `getAllFiles` then filters by `data.folderId`                                                              |
| `getFile(projectId, fileAreaId, fileId, options?)`                        | GET             | `/5.0/.../files/{fileId}` — optional `{ download: true, savePath }` streams to disk (adds `downloadedFilePath`) |
| `downloadFileFromLink(downloadLink, fileName, savePath?)`                 | GET             | Direct download URL with `X-API-KEY`                                                                            |
| `bulkDownloadFolder(projectId, fileAreaId, folderId, savePath?, opts?)`   | —               | Optional `filenameKeywords`, `filenameKeywordsMatch` (`any` / `all`), `filenameExtensions`, `params`, `verbose` |
| `bulkDownloadByIds(projectId, fileAreaId, fileIds, savePath?, options?)`  | GET + download  | Per-id `getFile` then stream from `downloadLink`                                                                |
| `getFilePropertiesMapping(projectId, fileAreaId, fileId)`                 | GET             | `/1.0/.../files/{fileId}/properties/1.0/mappings`                                                               |
| `getFilePropertyMappingValues(projectId, fileAreaId, filePropertyId)`     | GET             | `/1.0/.../files/properties/1.0/mappings/{filePropertyId}/values`                                                |

### FoldersApi

| Method                                                      | HTTP | Path                                                                   |
| ----------------------------------------------------------- | ---- | ---------------------------------------------------------------------- |
| `listFolders(projectId, fileAreaId, params?)`               | GET  | `/5.1/projects/{projectId}/file_areas/{fileAreaId}/folders`            |
| `getFolder(projectId, fileAreaId, folderId)`                | GET  | `/5.0/projects/{projectId}/file_areas/{fileAreaId}/folders/{folderId}` |
| `getFolderFilesProperties(projectId, fileAreaId, folderId)` | GET  | `/1.0/.../folders/{folderId}/files/properties/1.0/mappings`            |

### FileUploadApi

| Method                                                     | HTTP | Path                                                       |
| ---------------------------------------------------------- | ---- | ---------------------------------------------------------- |
| `createUpload(projectId, fileAreaId, body)`                | POST | `/1.0/projects/{projectId}/file_areas/{fileAreaId}/upload` |
| `uploadFilePart(projectId, fileAreaId, uploadGuid, chunk)` | POST | `/1.0/.../upload/{uploadGuid}`                             |
| `finishUpload(projectId, fileAreaId, uploadGuid, body)`    | POST | `/2.0/.../upload/{uploadGuid}/finalize`                    |

### FileRevisionsApi

| Method                                                                  | HTTP | Path                                                         |
| ----------------------------------------------------------------------- | ---- | ------------------------------------------------------------ |
| `getFileRevisionContent(projectId, fileAreaId, fileId, fileRevisionId)` | GET  | `/2.0/.../files/{fileId}/revisions/{fileRevisionId}/content` |

### FormsApi

| Method                                          | HTTP | Path                                          |
| ----------------------------------------------- | ---- | --------------------------------------------- |
| `getProjectForms(projectId, params?)`           | GET  | `/2.1/projects/{projectId}/forms`             |
| `getForm(projectId, formId)`                    | GET  | `/1.2/projects/{projectId}/forms/{formId}`    |
| `getProjectFormAttachments(projectId, params?)` | GET  | `/2.1/projects/{projectId}/forms/attachments` |

### UsersApi

| Method                                 | HTTP | Path                                       |
| -------------------------------------- | ---- | ------------------------------------------ |
| `getUser(userId)`                      | GET  | `/1.1/users/{userId}`                      |
| `listProjectUsers(projectId, params?)` | GET  | `/1.2/projects/{projectId}/users`          |
| `getProjectUser(projectId, userId)`    | GET  | `/1.1/projects/{projectId}/users/{userId}` |

### ProjectTemplatesApi

| Method                          | HTTP | Path                    |
| ------------------------------- | ---- | ----------------------- |
| `listProjectTemplates(params?)` | GET  | `/1.1/projectTemplates` |

### InspectionPlansApi

| Method                                                | HTTP | Path                                                    |
| ----------------------------------------------------- | ---- | ------------------------------------------------------- |
| `listInspectionPlans(projectId, params?)`             | GET  | `/1.2/projects/{projectId}/inspectionPlans`             |
| `listInspectionPlanItems(projectId, params?)`         | GET  | `/1.1/projects/{projectId}/inspectionPlanItems`         |
| `listInspectionPlanItemZones(projectId, params?)`     | GET  | `/1.1/projects/{projectId}/inspectionPlanItemZones`     |
| `listInspectionPlanRegistrations(projectId, params?)` | GET  | `/2.1/projects/{projectId}/inspectionPlanRegistrations` |

### TestPlansApi

| Method                                          | HTTP | Path                                              |
| ----------------------------------------------- | ---- | ------------------------------------------------- |
| `listTestPlans(projectId, params?)`             | GET  | `/1.2/projects/{projectId}/testPlans`             |
| `listTestPlanItems(projectId, params?)`         | GET  | `/1.1/projects/{projectId}/testPlanItems`         |
| `listTestPlanItemZones(projectId, params?)`     | GET  | `/1.1/projects/{projectId}/testPlanItemZones`     |
| `listTestPlanRegistrations(projectId, params?)` | GET  | `/1.1/projects/{projectId}/testPlanRegistrations` |

### VersionSetsApi

| Method                                                    | HTTP | Path                                                             |
| --------------------------------------------------------- | ---- | ---------------------------------------------------------------- |
| `getVersionSets(projectId, params?)`                      | GET  | `/2.1/projects/{projectId}/version_sets`                         |
| `getVersionSet(projectId, versionSetId)`                  | GET  | `/2.0/projects/{projectId}/version_sets/{versionSetId}`          |
| `listFileAreaVersionSets(projectId, fileAreaId, params?)` | GET  | `/2.1/projects/{projectId}/file_areas/{fileAreaId}/version_sets` |
| `listVersionSetFiles(projectId, versionSetId, params?)`   | GET  | `/3.0/projects/{projectId}/version_sets/{versionSetId}/files`    |

### WorkPackagesApi

| Method                                 | HTTP | Path                                     |
| -------------------------------------- | ---- | ---------------------------------------- |
| `listWorkPackages(projectId, params?)` | GET  | `/1.0/projects/{projectId}/workpackages` |

## Advanced Usage

### Using individual API classes

You can also instantiate API classes directly with a shared `ApiClient`:

```js
const {
  Configuration,
  ApiClient,
  ProjectsApi,
  TasksApi,
} = require("dalux-build-api");

const config = new Configuration({
  baseUrl: "https://<your-company>.dalux.com/api",
  apiKey: "YOUR_API_KEY",
});
const apiClient = new ApiClient(config);

const projects = new ProjectsApi(apiClient);
const tasks = new TasksApi(apiClient);
```

## Development

```bash
# Install dependencies
npm install

# Run tests with coverage
npm test
```

## Maintainer: npm releases

### Automatic (push to `main`)

1. Merge to `main` (or push directly). **CI** must pass.
2. After **both** the Node and Python test jobs succeed, **CI** calls **Publish npm Package** via `workflow_call` (same run as CI, so it does not depend on `workflow_run`).
3. The publish job only runs when that push changes `package.json`, `package-lock.json`, `src/`, or `test/`.
4. **Version bump** uses the same rules as the Python publisher ([commit message tokens](python/README.md#maintainer-pypi-releases)), but the **current** semver is **`max(python/pyproject.toml, package.json)`** so npm catches up when the Python package is ahead.
5. It runs tests again, publishes to npm, then pushes `chore: release vX.Y.Z [skip npm]`, tag `vX.Y.Z`, and a **GitHub Release** (unless the tag already exists). **`[skip npm]`** skips a second publish pass and skips **CI** on that sync commit.

### Manual

- **Actions → Publish npm Package → Run workflow** for **patch / minor / major** (same test → publish → sync commit → tag → **GitHub Release**). The entry workflow is [npm-publish.yml](.github/workflows/npm-publish.yml); it delegates to [npm-publish-reusable.yml](.github/workflows/npm-publish-reusable.yml) (GitHub requires `workflow_call` in its own file).
- **GitHub Release (published)** publishes the version already in `package.json` at that tag (no version bump in the workflow).

Create a GitHub **environment** named `npm` with secret **`NPM_TOKEN`**. If pushes or releases from `GITHUB_TOKEN` are blocked, set **`RELEASE_PAT`** as described in [python/README.md](python/README.md#maintainer-pypi-releases).

### First publish and `E404` on `npm publish`

If CI fails with **`404 Not Found - PUT …/dalux-build-api`** and **`is not in this registry`**, the package does not exist on npm yet **or** your token is not allowed to **create** it.

- **Classic [Automation](https://docs.npmjs.com/about-access-tokens#automation-tokens)** tokens only publish packages your account **already** maintains. They cannot create a **new** package name. Fix: use a **granular access token** with write access to the `@bruadam` scope (or all packages), or run **`npm publish --access public`** once locally while logged in as the owner, then switch CI back to an automation token.
- Confirm the package is not taken by someone else: [https://www.npmjs.com/package/dalux-build-api](https://www.npmjs.com/package/dalux-build-api).

## License

MIT
