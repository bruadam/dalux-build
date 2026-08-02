---
title: Architecture
nav_order: 3
---

# Architecture

Dalux Build's REST API is request/response only — it has no way to push
change notifications. Everything in this repo beyond the two API clients
exists to work around that.

```
┌─────────────────┐     ┌─────────────────┐
│  Node.js client │     │  Python client  │
│ (dalux-build-api)     │  (dalux-build)  │
└───────┬─────────┘     └────────┬────────┘
        │                        │
        │ used directly by       │ used directly by
        │ your app/scripts       │ your app/scripts,
        │                        │ or embedded in:
        │                        ▼
        │               ┌──────────────────┐
        │               │  Webhook server   │  polls Dalux on cron
        │               │ (webhook-server/) │  schedules, diffs
        │               └────────┬──────────┘  against SQLite state,
        │                        │             POSTs batched events
        │          ┌─────────────┴─────────────┐
        │          ▼                           ▼
        │  ┌───────────────┐           ┌───────────────┐
        │  │  Webhook UI   │           │  n8n / your    │
        │  │ (webhook-ui/) │           │  own callback  │
        │  │ registers &   │           │  endpoint      │
        │  │ manages jobs  │           └───────────────┘
        │  └───────────────┘
        ▼
┌──────────────────┐
│   Playground      │  standalone dev console —
│  (playground/)    │  exercises the Node.js client
└──────────────────┘  server-side, no CORS, key never
                       reaches the browser
```

## The pieces

- **Node.js client** (`javascript/`, `dalux-build-api`) and **Python
  client** (`python/`, `dalux-build`) are hand-written, kept in behavioral
  parity, and versioned/released together. Everything else in this repo is
  built on top of one of them.
- **Webhook server** (`webhook-server/`) is a standalone service built on
  the Python client. It registers polling jobs (change monitors or
  freshness checks) against `GET /file_areas/{id}/files`, keeps state in
  SQLite, and POSTs batched results to a callback URL (n8n, your own
  endpoint, anything that accepts a webhook). The same scheduler is also
  importable directly from Python via `dalux.webhook_server` — see
  [Webhook Server](webhook-server.html#embedded-mode).
- **Webhook UI** (`webhook-ui/`) is a standalone Next.js app for
  registering and managing webhook-server jobs without hand-writing curl —
  Clerk-authenticated, deployable separately (e.g. to Vercel).
- **Playground** (`playground/`) is a Next.js console for exercising the
  Node.js client interactively. Every call runs server-side through the
  real `createClient(...)`, so an API key never reaches the browser.
- **n8n node** (`n8n-nodes-dalux-build/`) wraps the Node.js client as an
  n8n community node, so Dalux operations (projects, tasks, files, forms,
  …) can be used directly inside n8n workflows — including as the
  destination for webhook-server callbacks.

## Picking a path

- Just need to call the Dalux API from your own code? Use the
  [Node.js](javascript-client.html) or [Python](python-client.html) client
  directly — nothing else in this repo is required.
- Need to react to file changes without polling yourself? Run the
  [webhook server](webhook-server.html), optionally in front of the
  [webhook UI](webhook-ui.html) for job management.
- Building automations in n8n? Point webhook-server callbacks at an n8n
  webhook node, or use the [n8n node](n8n-node.html) directly for
  synchronous calls.
- Exploring the API interactively during development? Run the
  [playground](playground.html).
