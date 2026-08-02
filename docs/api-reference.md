---
title: API Reference
nav_order: 10
---

# API Reference

Both clients expose the same 16 resource groups from the
[Dalux Build REST API](https://app.swaggerhub.com/apis-docs/Dalux/DaluxBuild-api/4.15).
Method/HTTP/path tables are kept in one place per language (the client READMEs)
to avoid two copies drifting apart — this page is the map to them.

| Group             | Covers                                                         | JS                                                                                                              | Python                                                                                                       |
| ----------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Projects          | List, get, create, update projects; project metadata           | [`projects`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#projectsapi)                 | [`projects`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#projectsapi)                  |
| Companies         | Project companies (CRUD)                                       | [`companies`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#companiesapi)               | [`companies`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#companiesapi)                |
| Company Catalog   | Account-level company catalog (CRUD + metadata)                | [`companyCatalog`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#companycatalogapi)     | [`company_catalog`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#companycatalogapi)     |
| Tasks             | Tasks, approvals, safety issues, observations & good practices | [`tasks`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#tasksapi)                       | [`tasks`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#tasksapi)                        |
| File Areas        | File areas on a project                                        | [`fileAreas`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#fileareasapi)               | [`file_areas`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#fileareasapi)               |
| Files             | Files within a file area, browsing, downloads                  | [`files`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#filesapi)                       | [`files`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#filesapi)                        |
| Folders           | Folders within a file area                                     | [`folders`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#foldersapi)                   | [`folders`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#foldersapi)                    |
| File Upload       | Chunked upload: create slot → upload parts → finalize          | [`fileUpload`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#fileuploadapi)             | [`file_upload`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#fileuploadapi)             |
| File Revisions    | Download file revision content                                 | [`fileRevisions`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#filerevisionsapi)       | [`file_revisions`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#filerevisionsapi)       |
| Forms             | Forms and form attachments                                     | [`forms`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#formsapi)                       | [`forms`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#formsapi)                        |
| Users             | Company and project users                                      | [`users`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#usersapi)                       | [`users`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#usersapi)                        |
| Project Templates | Available project templates                                    | [`projectTemplates`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#projecttemplatesapi) | [`project_templates`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#projecttemplatesapi) |
| Inspection Plans  | Inspection plans, items, zones, registrations                  | [`inspectionPlans`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#inspectionplansapi)   | [`inspection_plans`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#inspectionplansapi)   |
| Test Plans        | Test plans, items, zones, registrations                        | [`testPlans`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#testplansapi)               | [`test_plans`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#testplansapi)               |
| Version Sets      | Version sets and version set files                             | [`versionSets`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#versionsetsapi)           | [`version_sets`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#versionsetsapi)           |
| Work Packages     | Work packages on a project                                     | [`workPackages`](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#workpackagesapi)         | [`work_packages`](https://github.com/bruadam/dalux-build/blob/main/python/README.md#workpackagesapi)         |

`InspectionPlansApi` and `TestPlansApi` mirror the Python client's list behavior
in both languages: `list*` methods return the typed items array by default, with
a `fullResponse`/`full_response` opt-in for pagination metadata and links.

## Canonical upstream docs

This repo wraps an API that Dalux controls and evolves independently. For
current endpoint behavior, request/response shapes, or auth flow, the canonical
source is always SwaggerHub, not this reference:

- API reference: <https://app.swaggerhub.com/apis-docs/Dalux/DaluxBuild-api/>
- Getting started / auth:
  <https://app.swaggerhub.com/apis-docs/Dalux/GettingStarted/>

A point-in-time copy of the spec used to build these clients is also kept at
[`docs/official-api-docs/Dalux Build API.yaml`](https://github.com/bruadam/dalux-build/blob/main/docs/official-api-docs/Dalux%20Build%20API.yaml).
