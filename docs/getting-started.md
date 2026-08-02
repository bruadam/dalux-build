---
title: Getting Started
nav_order: 2
---

# Getting Started

Before continuing, read the [Legal and Usage Notice](legal-and-usage.html).
This project does not provide Dalux access. You need your own authorized account
and must keep every use within the scope of your agreement with Dalux.

Both clients need two things from your Dalux Build account:

1. `DALUX_API_KEY` — your company's API key (Dalux Build UI → **Company Profile
   → Settings → Company overview → API Identities**; ask Dalux support to
   activate API access for your company profile if you don't see this menu)

> Refer to
> [Dalux Build API documentation](https://support.dalux.com/hc/en-us/articles/20892369915292-API-identities-in-Dalux-Build-API)
> for more information on how to generate an API key.

2. `DALUX_BASE_URL` — the API base URL for your Dalux node for most Dalux Build
   customers, this is `https://node1.field.dalux.com/service/api/` but some
   customers are on a different node.

Every request from either client sends the key as the `X-API-KEY` header
automatically; no other auth configuration is needed.

## Node.js

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
```

Requires Node.js 14+. For calling the API from a browser (Client Components, no
CORS, key never reaches the browser), see the Next.js adapter in
[JavaScript Client](javascript-client.html#nextjs-browser-safe).

Full guide, every namespace, and the 16 API-group reference table:
[javascript/README.md](https://github.com/bruadam/dalux-build/blob/main/javascript/README.md).

## Python

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
```

Requires Python 3.10+. Set a default `project_id` / `file_area_id` on the client
if you mostly work against one project — see
[Python Client](python-client.html#client-level-defaults).

Full guide, every namespace, `full_response`/`to_dataframe`, and the 16
API-group reference table:
[python/README.md](https://github.com/bruadam/dalux-build/blob/main/python/README.md).

## Next steps

- Read [Architecture](architecture.html) to see how the webhook server, UI,
  playground, and n8n node build on these two clients.
- Browse the [API Reference](api-reference.html) for what each endpoint group
  covers.
- Run the [Tutorials](tutorials.html) notebooks for a guided walkthrough.
