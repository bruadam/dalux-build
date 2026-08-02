---
title: Home
layout: home
nav_order: 1
---

# Dalux Build API

Node.js and Python clients for the [Dalux Build REST API](https://app.swaggerhub.com/apis-docs/Dalux/DaluxBuild-api/4.14),
plus a webhook server, registration UI, dev playground, and n8n node built on
top of them — because Dalux itself doesn't push webhooks; see
[Architecture](architecture.html) for how the pieces fit together.

{: .warning }
These clients are experimental. Pin to a specific version — see the
[repo README](https://github.com/bruadam/dalux-build#readme) for the full
disclaimer.

{: .warning }
This is an unofficial project and provides no Dalux access or credentials.
Using the MIT-licensed code commercially does not authorize commercial use of
Dalux's API or Services. Each user must have their own valid Dalux access and
comply with their own agreement. Read the [Legal and Usage Notice](legal-and-usage.html)
before use, especially for hosted or multi-customer deployments.

## Choose your setup

| Piece | Best for | Source |
|---|---|---|
| **[JavaScript client](javascript-client.html)** (`dalux-build-api`) | Scripting or app code in JS/TS | [`javascript/`](https://github.com/bruadam/dalux-build/tree/main/javascript) |
| **[Python client](python-client.html)** (`dalux-build`) | Scripting, notebooks, data analysis | [`python/`](https://github.com/bruadam/dalux-build/tree/main/python) |
| **[Webhook server](webhook-server.html)** | Turning Dalux's polling-only API into real webhooks | [`webhook-server/`](https://github.com/bruadam/dalux-build/tree/main/webhook-server) |
| **[Webhook UI](webhook-ui.html)** | Registering/managing webhook jobs without curl | [`webhook-ui/`](https://github.com/bruadam/dalux-build/tree/main/webhook-ui) |
| **[Playground](playground.html)** | Exercising the JS client interactively, server-side | [`playground/`](https://github.com/bruadam/dalux-build/tree/main/playground) |
| **[n8n node](n8n-node.html)** | Wiring Dalux into n8n workflows | [`n8n-nodes-dalux-build/`](https://github.com/bruadam/dalux-build/tree/main/n8n-nodes-dalux-build) |

Not sure where to start? Read [Getting Started](getting-started.html).

## Sections

- [Getting Started](getting-started.html) — install and make your first call
- [Architecture](architecture.html) — how the client libraries, webhook server, UI, playground and n8n node relate
- [JavaScript Client](javascript-client.html) · [Python Client](python-client.html)
- [Webhook Server](webhook-server.html) · [Webhook UI](webhook-ui.html) · [n8n Node](n8n-node.html)
- [API Reference](api-reference.html) — the 16 shared endpoint groups
- [Tutorials](tutorials.html) — 5-hour notebook series for the Python client
- [Legal and Usage Notice](legal-and-usage.html) — affiliation, licensing, credentials, and commercial or hosted use
- [Contributing](contributing.html) — tests, changesets, releases
