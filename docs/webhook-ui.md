---
title: Webhook UI
nav_order: 7
---

# Webhook UI

`webhook-ui/` is a standalone Next.js (App Router) app for registering and
managing [webhook server](webhook-server.html) jobs without hand-writing
curl requests. It authenticates with Clerk and calls the monitor's
management API from the server side.

## Run locally

```bash
cd webhook-ui
npm install
npm run dev   # http://localhost:3000
```

Set in `.env.local`:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `MONITOR_API_TOKEN`
- `MONITOR_INTERNAL_URL` (defaults to `http://127.0.0.1:8000`; for a deployed monitor, its public URL)

## Deploy to Vercel

```bash
cd webhook-ui
vercel
```

Framework preset `Next.js`, root directory `.`. Set the same environment
variables in Vercel Project Settings, plus optionally `DALUX_BASE_URL`.

{: .warning }
The UI's server routes call the monitor API server-side. If the monitor runs
on a private network or `localhost`, Vercel cannot reach it — use a publicly
reachable, HTTPS-protected monitor endpoint.

## Full reference

[webhook-ui/README.md](https://github.com/bruadam/dalux-build/blob/main/webhook-ui/README.md)
for the complete environment variable list and Vercel CLI commands.
