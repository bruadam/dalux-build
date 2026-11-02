---
"dalux-build-api": minor
---

`FilesApi.getAllFiles`/`getFile` can now resolve `uploadedByUserId`/`lastModifiedByUserId` into full `ProjectUser` objects (and, through them, their company), the way the Python client's `get_files`/`get_file` already do via `recursively_populate`.

Pass `recursivelyPopulate: true` — `getAllFiles(projectId, fileAreaId, params, verbose, true)`, or `getFile(projectId, fileAreaId, fileId, { recursivelyPopulate: true })` — to add `uploadedByUser`/`lastModifiedByUser` next to the existing id fields. `ProjectUser` itself gains an optional `company` field, populated the same way, matching the Python model.

Defaults to `false`, unlike Python's `get_files` (which defaults to `true`): turning this on costs two extra requests (a project's users, then its companies) on every call, and flipping that on by default for an already-published client would be a behavior change for every existing caller, not an additive one.
