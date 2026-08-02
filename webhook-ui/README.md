# Dalux Webhook UI (Next.js + Vercel)

This app is an App Router Next.js frontend for registering Dalux webhook monitor
jobs.

> [!IMPORTANT]
> This is an unofficial interface and provides no Dalux access. Every user must
> supply credentials they are authorized to use within their own Dalux agreement.
> Do not deploy it to provide third parties access through shared credentials.
> Hosted or multi-customer operation may require written authorization from
> Dalux. See the [Legal and Usage Notice](../docs/legal-and-usage.md).

## 1) Local `.env.local`

Use and update the local env file in this folder (`.env.local`).

Set these values:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `MONITOR_API_TOKEN`
- `MONITOR_INTERNAL_URL` (for deployed monitor: `https://webhook.brunoadam.eu`)

## 2) Run locally without Docker

From this folder:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## 3) Deploy to Vercel

From this folder, deploy directly:

```bash
cd webhook-ui
vercel
```

When configuring the project in Vercel:

- Framework preset: `Next.js`
- Root Directory: `.` (already in `webhook-ui`)
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: leave default

Set environment variables in Vercel Project Settings -> Environment Variables:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `MONITOR_INTERNAL_URL` (must be reachable from Vercel runtime)
- `MONITOR_API_TOKEN`
- Optional: `DALUX_BASE_URL`

You can also set them with the Vercel CLI:

```bash
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production
vercel env add CLERK_SECRET_KEY production
vercel env add MONITOR_INTERNAL_URL production
vercel env add MONITOR_API_TOKEN production
vercel env add DALUX_BASE_URL production
```

When prompted for `MONITOR_INTERNAL_URL`, use:

```text
https://webhook.brunoadam.eu
```

## Important runtime note

The UI server routes call the monitor API from the server side. If your monitor
runs on a private network or localhost, Vercel will not reach it. Use a publicly
reachable monitor endpoint protected by HTTPS and auth.
