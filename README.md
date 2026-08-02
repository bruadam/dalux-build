# Dalux Build API

<p>
  <a href="https://github.com/bruadam/dalux-build/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/bruadam/dalux-build/ci.yml?branch=main&style=flat-square&logo=github&label=CI" alt="CI Status"></a>
  <a href="https://www.npmjs.com/package/dalux-build-api"><img src="https://img.shields.io/npm/v/dalux-build-api?style=flat-square&logo=npm&label=dalux-build-api" alt="npm version"></a>
  <a href="https://pypi.org/project/dalux-build/"><img src="https://img.shields.io/pypi/v/dalux-build?style=flat-square&logo=pypi&logoColor=white&label=dalux-build" alt="PyPI version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
</p>

Node.js and Python clients for the
[Dalux Build REST API](https://app.swaggerhub.com/apis-docs/Dalux/DaluxBuild-api/4.14),
plus a webhook server, registration UI, dev playground, and n8n node built on
top of them — because Dalux itself doesn't push webhooks.

> ! Disclaimer: These API clients are experimental and not yet fully tested. Use
> at your own risk. Suspect ground-breaking, backwards-incompatible changes in
> the near future — pin to a specific version. Report issues on
> [GitHub](https://github.com/bruadam/dalux-build/issues).

> Not affiliated with Dalux. Maintained by
> [Bruno Adam](https://github.com/bruadam).

## Get Started

```bash
npm install dalux-build-api
```

```js
const { createClient } = require("dalux-build-api");

const dalux = createClient({
    baseUrl: "https://<company>.dalux.com/api",
    apiKey: "YOUR_API_KEY",
});
const projects = await dalux.projects.listProjects();
```

```bash
pip install dalux-build
```

```python
from dalux_build import create_client

dalux = create_client(base_url="https://<company>.dalux.com/api", api_key="YOUR_API_KEY")
projects = dalux.projects.list_projects()
```

Full guides (auth, pagination, file upload, dataframes, error handling, all 16
API groups): [javascript/README.md](javascript/README.md) ·
[python/README.md](python/README.md).

## Choose your setup

| Piece                                  | Best for                                            | Docs                                                      |
| -------------------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| **Node.js client** (`dalux-build-api`) | Scripting or app code in JS/TS                      | [javascript/](javascript/README.md)                       |
| **Python client** (`dalux-build`)      | Scripting, notebooks, data analysis                 | [python/](python/README.md)                               |
| **Webhook server**                     | Turning Dalux's polling-only API into real webhooks | [webhook-server/](webhook-server/README.md)               |
| **Webhook UI**                         | Registering/managing webhook jobs without curl      | [webhook-ui/](webhook-ui/README.md)                       |
| **Playground**                         | Exercising the JS client interactively, server-side | [playground/](playground/README.md)                       |
| **n8n node**                           | Wiring Dalux into n8n workflows                     | [n8n-nodes-dalux-build/](n8n-nodes-dalux-build/README.md) |

Not sure how they fit together? See
[Architecture](https://bruadam.github.io/dalux-build/architecture.html).

## Documentation

Full documentation site: **https://bruadam.github.io/dalux-build/**

|                   |                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Start here**    | [Getting Started](https://bruadam.github.io/dalux-build/getting-started.html) · [Architecture](https://bruadam.github.io/dalux-build/architecture.html)                                                             |
| **Clients**       | [JavaScript](https://bruadam.github.io/dalux-build/javascript-client.html) · [Python](https://bruadam.github.io/dalux-build/python-client.html)                                                                     |
| **Webhook infra** | [Webhook Server](https://bruadam.github.io/dalux-build/webhook-server.html) · [Webhook UI](https://bruadam.github.io/dalux-build/webhook-ui.html) · [n8n node](https://bruadam.github.io/dalux-build/n8n-node.html) |
| **Reference**     | [API Reference](https://bruadam.github.io/dalux-build/api-reference.html) · [Tutorials](https://bruadam.github.io/dalux-build/tutorials.html)                                                                       |
| **Contributing**  | [Contributing Guide](https://bruadam.github.io/dalux-build/contributing.html)                                                                                                                                       |

[AGENTS.md](AGENTS.md) has pointers to the canonical upstream Dalux Build API
docs and where each client's API surface lives in this repo.

## Testing & Releasing

All packages are tested from one shared workflow and released together by
[Changesets](https://github.com/changesets/changesets) — no manual version
bumps, nothing publishes unless the full suite passes. See
[CONTRIBUTING.md](CONTRIBUTING.md) for commands and the full release flow.

## Community

[Issues](https://github.com/bruadam/dalux-build/issues) for bugs and feature
requests ·
[Discussions](https://github.com/bruadam/dalux-build-tuto/discussions) for
questions.

## License

MIT
