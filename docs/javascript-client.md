---
title: JavaScript Client
nav_order: 4
---

# JavaScript Client

`dalux-build-api` is a lightweight Node.js client for the
[Dalux Build REST API](https://app.swaggerhub.com/apis-docs/Dalux/DaluxBuild-api/4.14).
Requires Node.js 14+.

```bash
npm install dalux-build-api
```

```js
const { createClient } = require("dalux-build-api");

const dalux = createClient({
  baseUrl: "https://<your-company>.dalux.com/api",
  apiKey: "YOUR_API_KEY",
});

const projects = await dalux.projects.listProjects();
const tasks = await dalux.tasks.getProjectTasks("my-project-id", { typeId: "some-type-guid" });
const allTasks = await dalux.tasks.getAllProjectTasks("my-project-id", {}, false);
```

The client returned by `createClient` exposes one namespace per API resource
group (`projects`, `tasks`, `files`, `forms`, …) — 16 in total, see
[API Reference](api-reference.html) for the full list, or
[javascript/README.md#api-reference](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md#api-reference)
for every method, HTTP verb, and path.

## Next.js (browser-safe)

Dalux API keys must stay server-side, and CORS is controlled by Dalux, not
this SDK. For Client Components, use the package's same-origin Next.js
adapter — the browser calls your own App Router endpoint, which uses the
regular client on the server:

```js
// app/api/dalux/route.js
import { createClient } from "dalux-build-api";
import { createDaluxRouteHandler } from "dalux-build-api/next";

const dalux = createClient({
  baseUrl: process.env.DALUX_BASE_URL,
  apiKey: process.env.DALUX_API_KEY,
});

export const POST = createDaluxRouteHandler({
  client: dalux,
  allowedMethods: { projects: ["listProjects", "getProject"] },
  authorize: async (request) => Boolean(await getCurrentUser(request)),
});
```

```js
// app/projects/Projects.jsx
"use client";
import { createBrowserClient } from "dalux-build-api/browser";

const dalux = createBrowserClient({ url: "/api/dalux" });
export const loadProjects = () => dalux.projects.listProjects();
```

The browser entry has no Axios, filesystem access, base URL, or API key —
calls are same-origin `fetch`. Write methods only work if you explicitly add
them to `allowedMethods`, guarded by your own `authorize` check.

## File uploads (chunked)

```js
const { uploadGuid } = await dalux.fileUpload.createUpload(projectId, fileAreaId, {
  fileName: "drawing.pdf",
  mimeType: "application/pdf",
});
await dalux.fileUpload.uploadFilePart(projectId, fileAreaId, uploadGuid, fs.readFileSync("./drawing.pdf"));
const result = await dalux.fileUpload.finishUpload(projectId, fileAreaId, uploadGuid, { folderId: "target-folder-id" });
```

## Error handling

All methods return Promises; network/HTTP errors surface as Axios errors:

```js
try {
  await dalux.projects.getProject("unknown-id");
} catch (err) {
  console.error(err.response?.status, err.response?.data);
}
```

## Full reference

See [javascript/README.md](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md)
for: every API namespace with method/HTTP/path tables, bulk file downloads,
individual API-class instantiation, and testing instructions.
