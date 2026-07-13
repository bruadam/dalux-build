# Dalux Build API — Playground

An interactive web console for exercising the local `dalux-build-api` JS client
against a real Dalux Build API instance. Pick a resource + method from the
sidebar, fill in the parameters, and hit **Send** — the call runs **server-side**
through the actual client (`createClient(...)`), so your API key never reaches the
browser and there are no CORS issues.

## How it works

```
browser UI  ──POST /api/call──►  Next.js route  ──►  createClient() from ../src  ──►  Dalux API
 (app/page.js)                   (app/api/call/route.js)
```

- **`lib/catalog.js`** — the single source of truth: every exposed resource,
  method, HTTP verb, and parameter spec. It drives the sidebar and the parameter
  forms, and the server uses it as an **allow-list** (only listed methods can be
  invoked). Add a method here to expose it.
- **`app/api/call/route.js`** — validates the request against the catalog,
  coerces form values (JSON fields are parsed), builds the positional argument
  list, and dispatches `client[resource][method](...args)`.
- **`app/api/config/route.js`** — tells the UI whether the server has default
  credentials, without ever sending the key to the browser.

Methods that need a filesystem, stdin, or binary streaming (bulk/versioned
downloads, chunked uploads, interactive file selection, raw revision content)
are intentionally omitted — they don't map onto an HTTP console.

## Running

```bash
cd playground
npm install
npm run dev        # http://localhost:3210
```

## Credentials

Two options:

1. **In the UI** — enter Base URL + API key in the top bar. They persist in
   `localStorage` and are sent with each request.
2. **Server-side** — copy `.env.local.example` to `.env.local` and fill in
   `DALUX_BASE_URL` / `DALUX_API_KEY`. The console pre-fills the base URL and
   shows a "server default available" badge; leave the API-key field blank to use
   the server's key (it's never exposed to the browser).

Request-provided credentials override the server env when both are present.

> `.env.local` is gitignored. Never commit real keys.
