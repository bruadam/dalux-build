# The orchestrator

A scheduled job that turns observable repo state into issues agents can claim.
It never edits code. Its only output is issues.

## Why this shape

Several agents work in this repo at once, and the failure mode is not
incompetence — it is **inference**. An agent with no queue picks something
plausible, and so does the next one, and the review queue fills with
overlapping changes nobody asked for. The fix is not smarter agents; it is that
work is written down, visible, and claimed before it starts.

So the design borrowed from `ifc-lite` is three rules, not a framework:

1. **Work is admitted through a queue.** An issue is a proposal until a
   maintainer labels it `ready`.
2. **Work is claimed explicitly**, by comment, because the assignee field holds
   one shared account and cannot identify an agent session.
3. **Findings carry evidence.** Every issue the orchestrator files includes the
   command that reproduces it.

## What it watches, and why only this

| Signal | Priority | Source |
| --- | --- | --- |
| Our own workflow failing on `main`, latest run | P1 | `gh run list` |
| New JS/Python parity drift beyond baseline | P2 | `parity.mjs`, local |
| Open PR touching published clients with no changeset | P2 | `gh pr list` |
| AGENTS.md referencing paths that do not resolve | P3 | local |
| Dependency PR backlog ≥ 5 | P3 | `gh pr list` |
| `ready` issues nobody has claimed | report only | `gh issue list` |

Each is **cheap to check, unambiguous when it fires, and actionable by one PR.**
Signals that fail any of those three were deliberately left out: "test coverage
dropped", "this module is complex", "performance regressed" all need a baseline
and a judgement call, and a signal that invites argument gets muted.

The last row is reported to the run log and **never filed**: an issue about
unclaimed issues is noise.

## The four properties that keep it trustworthy

Each one is the result of getting it wrong first:

- **Dry run by default.** `--apply` is required to create anything.
- **Idempotent.** Every issue carries `<!-- orchestrator:signal=<key> -->`, and
  a re-run finds the open issue and leaves it alone.
- **Failure-tolerant per signal.** A failing `gh` call degrades one signal
  instead of making the whole run look clean.
- **It does not label `ready`.** Filing proposes work; admitting it is a human
  act. `--ready` overrides, for a solo maintainer who wants the loop closed.

## What getting it wrong looked like

Recorded because it is the argument for running a new signal before trusting it:

- **The parity extractor reported `folders.if` and `tasks.if` as API methods** —
  a JS `if (` sits at exactly method indent inside a class — and
  `files.close` / `files.update`, which come from a `_ProgressBar(Protocol)`
  stub in the same module. Both fixed by scoping extraction to the `<Group>Api`
  class body. `parity.test.mjs` pins the behaviour.
- **The CI signal reported a P1 that did not exist.** It counted any failure in
  the last eight runs, so a failure already followed by a green run read as
  current; and it counted `Dependabot Updates`, GitHub's own `dynamic` workflow,
  which is not this repo's test suite and blocks no release. Now it takes the
  latest run per workflow and only workflows declared in `.github/workflows`.
- **The doc-drift signal flagged illustrative filenames.** AGENTS.md says "one
  file per API group (e.g. `ProjectsApi.ts`)", which is not a repo-relative
  path. Bare filenames are now accepted if a file of that name exists anywhere,
  which still catches the drift that was genuinely there: the examples said
  `.js` after the clients had moved to `.ts`.
- **The queue gate crashed on a batch PR.** `gh issue view` errors on a PR
  number, and this repo's batched dependency PRs close other PRs. It now reads
  through `repos/:owner/:repo/issues/:n`, which answers for both and marks pull
  requests, and treats an all-PR reference set as a superseding PR.

## Running it

```sh
node scripts/orchestrator/orchestrate.mjs            # report
node scripts/orchestrator/orchestrate.mjs --apply    # file issues
node scripts/orchestrator/parity.mjs                 # parity only
node scripts/orchestrator/parity.mjs --baseline      # accept current asymmetries
node scripts/check-issue-queue.mjs --pr <n>          # the queue gate, advisory
node --test scripts/orchestrator/parity.test.mjs     # extractor tests
```

`.github/workflows/orchestrator.yml` runs it twice a day and on manual
dispatch. The scheduled run applies; manual dispatch defaults to a dry run.
The workflow self-tests the extractors first — if those are broken the findings
are fiction, so it fails rather than filing nonsense.

## Before the first scheduled run

The labels it applies must exist:

```sh
gh label create agent-task --description "A unit of work an agent can claim" --color 0e8a16
gh label create ready      --description "Admitted work: agreed and claimable" --color 1d76db
gh label create P1 --description "Blocks a release" --color b60205
gh label create P2 --description "Correctness"      --color d93f0b
gh label create P3 --description "Hygiene"          --color fbca04
```

Without them `gh issue create --label` fails and the run reports that it could
not file.

## Limits worth stating

- **Parity is name-level only.** A method present on both sides with different
  behaviour passes. Signature comparison across TypeScript and Python overloads
  needs two real parsers.
- **Python mixin inheritance is invisible.** `FilesApi(AiMixin, …)` gains
  methods from other modules, so a method Python inherits reads as `only-js`.
  The direction of the error is known; verify before porting.
- **The baseline is a choice, not a clean slate.** Fifteen asymmetries were
  accepted when it was recorded. Everything in `parity-baseline.json` is a
  parity gap someone is choosing to keep.
- **It cannot see upstream API drift.** The Dalux SwaggerHub docs are
  client-rendered behind SSO and cannot be fetched headlessly, which AGENTS.md
  already records. Detecting that Dalux changed an endpoint remains manual, and
  it is the most valuable signal this orchestrator does *not* have.
