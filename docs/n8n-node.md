---
title: n8n Node
nav_order: 9
---

# n8n Node

`n8n-nodes-dalux-build` is a custom n8n community node wrapping the real
[`dalux-build-api`](javascript-client.html) Node.js client for Dalux Build
automation inside n8n workflows — including as the receiving end of
[webhook server](webhook-server.html) callbacks.

## Covered operations

- Credential: **Dalux Build API** (`baseUrl` + `apiKey`, sent as `X-API-KEY`)
- Node: **Dalux Build** — Project (list/get/create/update), Task (get many
  with pagination, get), User, Company, File Area, Folder, File (get many,
  get many in folder, get/download, download folder, download many), Form.

This is a prioritized subset of the client's 16 resource namespaces; the
remaining ones (`companyCatalog`, `fileUpload`, `fileRevisions`,
`projectTemplates`, `inspectionPlans`, `testPlans`, `versionSets`,
`workPackages`) follow the same thin-wrapper pattern around
`dalux.<namespace>.<method>()`.

## Configure in n8n

1. Create credential **Dalux Build API**: Base URL (e.g.
   `https://<company>.dalux.com/api`) and API Key.
2. Add the **Dalux Build** node to a workflow and pick Resource / Operation.

## Install / rebuild

Depends on `dalux-build-api` from npm, so `node_modules/` must be populated
before n8n loads it:

```bash
docker run --rm -v "$(pwd)":/app -w /app node:24 npm install --omit=dev
docker compose restart n8n
```

## Full reference

[n8n-nodes-dalux-build/README.md](https://github.com/bruadam/dalux-build/blob/main/n8n-nodes-dalux-build/README.md).
