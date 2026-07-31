# Dalux Build API

API clients for the [Dalux Build REST API](https://app.swaggerhub.com/apis-docs/Dalux/DaluxBuild-api/4.14), available in two languages, plus a standalone webhook server built on the Python client:

| Package                     | Location                             | Documentation                                        |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------ |
| Node.js (`dalux-build-api`) | [`/javascript`](javascript/)         | [javascript/README.md](javascript/README.md)         |
| Python (`dalux-build`)      | [`/python`](python/)                 | [python/README.md](python/README.md)                  |
| Webhook server               | [`/webhook-server`](webhook-server/) | [webhook-server/README.md](webhook-server/README.md) |

The Node.js and Python clients are kept in behavioral parity and are versioned, tested, and released together. [AGENTS.md](AGENTS.md) has pointers to the canonical upstream Dalux Build API docs and where each client's API surface lives in this repo.

## Testing

Node.js, Python, and the webhook server (tested against this checkout's
unreleased Python code) are all tested from one shared workflow:
[`.github/workflows/tests.yml`](.github/workflows/tests.yml), run by both
`ci.yml` (every push and pull request) and `release.yml` (as a hard gate
immediately before anything is allowed to publish). For the commands to run
each locally, see [javascript/README.md#testing](javascript/README.md#testing),
[python/README.md#testing](python/README.md#testing), and
[CONTRIBUTING.md](CONTRIBUTING.md#running-tests).

## Releasing

Both packages are versioned and published together by
[Changesets](https://github.com/changesets/changesets) via
[`.github/workflows/release.yml`](.github/workflows/release.yml) — there is
no manual version bump, and nothing publishes unless the full test suite
above passes. See [CONTRIBUTING.md](CONTRIBUTING.md#how-releases-work) for
the complete flow, including how to add a changeset.

## License

MIT
