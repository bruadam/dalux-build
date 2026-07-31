<!-- Keep this focused: one change per PR. Delete sections that do not apply. -->

## What and why

<!-- The change and the problem it solves. Link the issue if there is one. -->

## How it was verified

<!-- Commands run and what you observed. Not "should work". -->

- [ ] `npm test --workspace=javascript` (Node.js client) passes locally
- [ ] `pytest` in `python/` passes locally
- [ ] Webhook server change: ran the relevant tests in `webhook-server/tests`

## Checklist

- [ ] Added a changeset (`npx changeset`) — required for any change under
      `javascript/src/`, `javascript/package.json`, `python/dalux_build/`, or
      `python/pyproject.toml`. Docs/CI-only changes can use
      `npx changeset add --empty`.
- [ ] Node.js (`javascript/src/`) and Python (`python/dalux_build/`) clients
      were updated together if this changes shared API behavior, or the gap
      is explained above.
- [ ] README / `javascript/README.md` / `python/README.md` updated if public
      behavior changed.
- [ ] No secrets, API keys, or company-specific base URLs in code, tests, or
      this PR.
