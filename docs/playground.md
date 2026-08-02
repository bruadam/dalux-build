---
title: Playground
nav_order: 8
---

# Playground

`playground/` is an interactive web console for exercising the local
`dalux-build-api` JS client against a real Dalux Build API instance. Pick a
resource + method from the sidebar, fill in parameters, hit **Send** — the
call runs **server-side** through the real `createClient(...)`, so an API
key never reaches the browser and there are no CORS issues.

```
browser UI  ──POST /api/call──►  Next.js route  ──►  createClient() from ../javascript/src  ──►  Dalux API
```

- `lib/catalog.js` is the single source of truth: every exposed resource,
  method, and parameter spec. It drives the UI and acts as a server-side
  allow-list — only listed methods can be invoked.
- Methods needing a filesystem, stdin, or binary streaming (bulk/versioned
  downloads, chunked uploads) are intentionally omitted — they don't map
  onto an HTTP console.

## Run

```bash
cd playground
npm install
npm run dev   # http://localhost:3210
```

## Credentials

Either enter Base URL + API key in the UI (persisted in `localStorage`, sent
per request), or copy `.env.local.example` to `.env.local` and set
`DALUX_BASE_URL` / `DALUX_API_KEY` server-side — the console shows a
"server default available" badge and the key is never sent to the browser.
Request-provided credentials override the server env when both are present.

## Full reference

[playground/README.md](https://github.com/bruadam/dalux-build/blob/main/playground/README.md).
