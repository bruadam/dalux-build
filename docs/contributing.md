---
title: Contributing
nav_order: 12
---

# Contributing

Full details live in
[CONTRIBUTING.md](https://github.com/bruadam/dalux-build/blob/main/CONTRIBUTING.md)
and [AGENTS.md](https://github.com/bruadam/dalux-build/blob/main/AGENTS.md)
(the latter aimed at AI coding agents, but useful orientation for anyone).
This page is the short version.

## Setup

```bash
npm install                                   # installs the javascript/ workspace too
cd python && pip install -e ".[dev,webhook]"
```

## Tests

```bash
npm test --workspace=javascript                 # Node.js client
cd python && pytest --cov=dalux_build           # Python client
cd webhook-server && pytest                     # webhook server (against this checkout's Python client)
```

All three run from one shared workflow,
[`.github/workflows/tests.yml`](https://github.com/bruadam/dalux-build/blob/main/.github/workflows/tests.yml),
on every push/PR and again as a release gate.

## Changesets

Every PR touching `javascript/src/`, `javascript/package.json`,
`python/dalux_build/`, or `python/pyproject.toml` needs a changeset — CI
fails the PR otherwise:

```bash
npx changeset            # pick a bump type, write a summary
npx changeset add --empty  # for docs/CI/test-only changes
```

## Releases

Fully automated by [Changesets](https://github.com/changesets/changesets) —
no manual version bumps. Merging a changeset opens/updates a version PR;
merging that PR publishes `dalux-build-api` to npm and tags a GitHub
Release, which then publishes `dalux-build` to PyPI. Full flow:
[CONTRIBUTING.md#how-releases-work](https://github.com/bruadam/dalux-build/blob/main/CONTRIBUTING.md#how-releases-work).

## API parity

The Node.js and Python clients are expected to stay in behavioral parity —
an endpoint or parameter added to one should generally be added to the
other in the same PR. The upstream Dalux API is controlled by Dalux and
evolves independently; don't invent endpoint paths or fields by
pattern-matching this repo — verify against SwaggerHub (see
[API Reference](api-reference.html#canonical-upstream-docs)).
