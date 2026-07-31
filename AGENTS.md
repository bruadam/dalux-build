# AGENTS.md

Guidance for AI coding agents (and humans skimming for orientation) working
in this repo.

## What this repo is

Two hand-written clients for the Dalux Build REST API — Node.js (`src/`,
published as `dalux-build-api`) and Python (`python/dalux_build/`, published
as `dalux-build`) — plus a standalone webhook server (`webhook-server/`)
built on the Python client. See `README.md` for usage and `CONTRIBUTING.md`
for how tests, changesets, and releases work.

## Source of truth for the Dalux Build API

This repo wraps an external API that Dalux controls and evolves
independently. When you need to check current endpoint behavior,
request/response shapes, auth flow, or whether something changed upstream,
the canonical docs are:

- API reference: <https://app.swaggerhub.com/apis-docs/Dalux/DaluxBuild-api/>
- Getting started / auth: <https://app.swaggerhub.com/apis-docs/Dalux/GettingStarted/>

Both are client-rendered SwaggerHub pages that redirect through SmartBear SSO
for some requests — they cannot be fetched headlessly (e.g. `curl` or a
plain HTTP fetch tool will hit a login redirect, not the spec). Open them in
an actual browser session.

**Do not invent or guess Dalux endpoint paths, query parameters, or response
fields** by pattern-matching this repo's existing code or from training
data — the upstream API can add, rename, or change things independently of
this repo. If you can't reach the SwaggerHub docs in your environment, say
so explicitly and ask the user to paste the relevant spec section rather
than fabricating API behavior.

## Where the API surface lives in this repo

- Node.js: `src/api/<Group>Api.js` — one file per API group (e.g.
  `ProjectsApi.js`, `TasksApi.js`, `FilesApi.js`).
- Python: `python/dalux_build/api/<group>.py`, with response/request models
  under `python/dalux_build/models/<group>/` (one folder per endpoint group).
- The two clients are expected to stay in behavioral parity — an endpoint or
  parameter added to one should generally be added to the other in the same
  PR (see the git history around "parity model validation python / npm").

## Versioning and releases

Don't hand-edit the `version` field in `package.json` or
`python/pyproject.toml` — both are bumped together by Changesets. Every PR
that touches `src/`, `package.json`, or `python/dalux_build/` needs a
changeset (`npx changeset`; `npx changeset add --empty` for changes that
don't need a release). See `CONTRIBUTING.md` for the full flow.
