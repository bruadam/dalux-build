# AGENTS.md

Guidance for AI coding agents (and humans skimming for orientation) working
in this repo.

## What this repo is

Two hand-written clients for the Dalux Build REST API — Node.js
(`javascript/src/`, published as `dalux-build-api`) and Python
(`python/dalux_build/`, published as `dalux-build`) — plus a standalone
webhook server (`webhook-server/`) built on the Python client. The repo root
is an npm workspace root (`package.json` has
`"workspaces": ["javascript", "mcp-server"]`); the Node.js package itself lives
under `javascript/`. See `README.md` for
usage and `CONTRIBUTING.md` for how tests, changesets, and releases work.

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

- Node.js: `javascript/src/api/<Group>Api.ts` — one file per API group (e.g.
  `ProjectsApi.ts`, `TasksApi.ts`, `FilesApi.ts`).
- Python: `python/dalux_build/api/<group>.py`, with response/request models
  under `python/dalux_build/models/<group>/` (one folder per endpoint group).
- The two clients are expected to stay in behavioral parity — an endpoint or
  parameter added to one should generally be added to the other in the same
  PR (see the git history around "parity model validation python / npm").
  **This is measurable, so measure it rather than remembering it:**

  ```sh
  node scripts/orchestrator/parity.mjs
  ```

  It compares method names per API group and reports only drift newer than the
  recorded baseline. Fifteen asymmetries existed when the baseline was taken, so
  the habit had already slipped. If an asymmetry is deliberate, re-baseline with
  `--baseline` and say why in the PR.

## Versioning and releases

Don't hand-edit the `version` field in `javascript/package.json` or
`python/pyproject.toml` — both are bumped together by Changesets. Every PR
that touches `javascript/src/`, `javascript/package.json`, or
`python/dalux_build/` needs a changeset (`npx changeset`; `npx changeset
add --empty` for changes that don't need a release). See `CONTRIBUTING.md`
for the full flow.

## Working in parallel

Several agents — and humans — work in this repo at once. The rules below exist
so they collaborate instead of colliding. They are ported from `ifc-lite`, where
the failure mode they prevent was observed rather than imagined: agents that
infer their own work produce overlapping branches and a review queue full of
changes nobody asked for.

### Work is admitted before it is started

An issue is a *proposal* until a maintainer labels it **`ready`**. Only then is
it agreed work. Agents may file issues freely; agents may not label `ready`.

`scripts/check-issue-queue.mjs` checks that a PR closes a `ready` issue. It is
**advisory** today and becomes blocking with `--enforce`.

### Claim it before you touch it

Comment on the issue before writing code:

```
Claiming this. Session <id>, branch <name>.
```

The claim comment is the only artifact that can identify *you*. The assignee
field holds one shared account and cannot distinguish one agent session from
another, so assignment is not a claim and an unassigned issue is not
necessarily unclaimed.

Before starting, check **both**:

```sh
gh issue view <n> --repo bruadam/dalux-build --json assignees,labels,comments
gh pr list --repo bruadam/dalux-build --search "<topic>"   # candidates, not proof
```

If someone has claimed it, pick something else or coordinate on the issue.

### One issue, one PR

A PR closes exactly one admitted issue and says so with `Closes #<n>`. Batch and
release PRs are the stated exception, and the gate recognises them.

### Evidence, not assertion

Every claim in a PR body should carry the command that demonstrates it. "Fixed
the parity gap" is not reviewable; the output of `parity.mjs` before and after
is. The same rule already governs this repo's hardest constraint — **do not
invent Dalux endpoint behaviour** (see *Source of truth* above). If you cannot
verify something, say so explicitly rather than filling the gap.

### The orchestrator files work; do not duplicate it

`scripts/orchestrator/orchestrate.mjs` turns observable repo state — current CI
failures, parity drift, missing changesets, stale AGENTS.md paths, dependency
backlog — into issues, each carrying its evidence and a
`<!-- orchestrator:signal=... -->` marker so re-runs do not duplicate. Before
filing an issue by hand, check whether a signal already covers it. See
`docs/orchestrator.md` for what it watches and why it watches only that.
