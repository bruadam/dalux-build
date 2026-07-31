# Contributing

This repo ships two clients for the same API — a Node.js package (`src/`,
published as `dalux-build-api`) and a Python package (`python/dalux_build/`,
published as `dalux-build`) — plus a standalone webhook server
(`webhook-server/`). They're versioned together: one release number for both
`package.json` and `python/pyproject.toml`.

## Setup

```bash
npm install
cd python && pip install -e ".[dev,webhook]"
```

## Running tests

```bash
npm test                                              # Node.js client
cd python && pytest --cov=dalux_build                 # Python client
cd webhook-server && pytest                           # webhook server
```

## Adding a changeset

Every PR that changes published code — `src/`, `package.json`,
`python/dalux_build/`, or `python/pyproject.toml` — needs a changeset. CI
(`changeset-check` in `.github/workflows/ci.yml`) fails the PR if one is
missing.

```bash
npx changeset
```

Pick a bump type (patch for fixes, minor for backwards-compatible features,
major for breaking changes) and write a short summary — it becomes the
changelog entry. This bumps both packages' version together, so pick the
highest bump type needed by either side.

For changes that don't need a release (docs, CI, tests only), add an empty
changeset instead of skipping this step:

```bash
npx changeset add --empty
```

## How releases work

Releases are fully automated by [Changesets](https://github.com/changesets/changesets)
via `.github/workflows/release.yml` — there's no manual version bump:

1. Merging a PR with a changeset to `main` makes the `Release` workflow open
   or update a **"chore: version packages"** PR. That PR's diff is the
   changelog: it runs `changeset version` (bumps `package.json`, writes
   `CHANGELOG.md`) and then `scripts/sync-python-version.mjs`, which copies
   the same version into `python/pyproject.toml` and mirrors the newest
   changelog entry into `python/CHANGELOG.md` — one changeset summary powers
   both packages' release notes.
2. Merging the version PR triggers the workflow again. This time there are no
   pending changesets, so it publishes `dalux-build-api` to npm
   (`changeset publish`), tags the release, and creates a GitHub Release.
3. A GitHub Release publish then builds and publishes `dalux-build` to PyPI.

You never need to hand-edit a version number in `package.json` or
`python/pyproject.toml` — the version PR does it for you.
