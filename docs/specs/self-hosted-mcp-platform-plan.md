# Plan: Self-hosted Dalux MCP platform

_Implements `docs/specs/self-hosted-mcp-platform.md` (PRD v2). Date: 2026-11-07._

Open questions in PRD section 12 are taken with the PRD defaults until decided:
access is the union of grants (no deny rules); admins have no implicit data
access; live file tools check folders with one cached Dalux lookup per file;
manual linking covers mismatched Dalux emails.

## Technical choices

| Concern | Choice | Why |
| --- | --- | --- |
| Database | Postgres 17 + pgvector (`pgvector/pgvector:pg17` image) | One stateful dependency; RLS; HNSW with iterative scans |
| Schema and migrations | Drizzle ORM + drizzle-kit, plus hand-written SQL migrations for roles, RLS policies, and functions | Typed queries shared by `web`, `mcp`, `worker` |
| Web interface | Next.js + Tailwind + shadcn/ui (same stack as `webhook-ui`) | Team already uses it |
| Interface login | Better Auth (email/password, sessions; SSO later) with its Drizzle adapter | Covers P0/P1 auth without custom crypto |
| MCP tokens and OAuth | Platform tables (`api_token`, `oauth_*`); OAuth AS evolves from today's `mcp-server/src/oauth.ts` unless Better Auth's MCP/OIDC provider fits in wave 3 | Keep token checks one indexed lookup in `mcp` |
| Jobs | pg-boss (jobs in Postgres) | No Redis |
| Worker | `mcp-server` image, `node dist/cli.js worker` | Reuses `rag/*Build.ts` |
| Proxy | Caddy | Automatic TLS, one origin |

## Repo layout

```
platform/
  compose.yaml            web, mcp, worker, postgres, caddy
  compose.test.yaml       postgres only, for tests
  Caddyfile
  db/                     npm workspace "@dalux-platform/db": Drizzle schema, migrations, migrate CLI,
                          withAccount() helper (SET LOCAL app.account_id), RLS test suite
  web/                    npm workspace "@dalux-platform/web": Next.js interface (wave 2)
mcp-server/
  src/store/              IndexStore interface; file store (today's code); postgres store (wave 2)
  src/access/             capability registry, scope resolvers, request context (account, connection)
  src/worker/             index jobs, Dalux user matching, effective_access refresh (wave 3)
```

`platform/db` and `platform/web` join the root npm workspaces. Header and stdio
modes must keep working without `DATABASE_URL`.

## Waves

Each task runs on its own branch from `feat/self-hosted-platform` and opens a
draft PR into it. Tasks in the same wave touch different folders.

### Wave 1 (parallel)

- **W1-db** (`platform/`): compose files; `platform/db` package with the full
  schema of PRD sections 5–7 (accounts, groups, memberships, grants with
  capabilities and scopes, `effective_access`, connections with encrypted
  secrets, Dalux user links, API tokens, OAuth clients/codes/tokens, audit log,
  settings, index/document/chunk with folder ancestry and `vector(1024)`);
  database roles (`migrator`, `web`, `mcp`, `worker`); RLS policies;
  `effective_access` refresh function; `withAccount()`; secret encryption
  helper (AES-256-GCM, envelope); RLS test suite against real Postgres
  (PRD success criteria 3 and 4 at SQL level).
- **W1-mcp** (`mcp-server/`): no behavior change. Extract an `IndexStore`
  interface from `rag/store.ts`, `taskStore.ts`, `docsStore.ts` with the file
  store as the only implementation; documents carry project/file area/folder
  ancestry. Add the capability registry: every tool declares its capability
  (PRD 5.4 table) and scope resolver. Add a request context (account,
  connection, capabilities) that is "unrestricted" in stdio and header mode.
  All existing tests pass unchanged.

### Wave 2 (after wave 1 merges)

- **W2-pgstore**: Postgres `IndexStore` (pgvector HNSW + iterative scan, exact
  fallback, full-text ranking on the `simple` config), queries via `withAccount()`.
- **W2-auth-mcp**: platform mode in `mcp`: API token auth, `/mcp/c/<slug>`,
  capability checks and list filtering, header mode off by default, audit of tool calls.
- **W2-web**: interface: login, accounts, robots, groups, connections, grants
  (presets), tokens, effective-access view, settings (embedding key, header mode).

### Wave 3

- **W3-oauth**: OAuth AS in the platform, stored/refreshable/revocable tokens, connection picker.
- **W3-worker**: admin-defined index scopes, schedules, status, token usage;
  Dalux user matching by email; index tools admin-only.
- **W3-python**: MCP-backed retriever for the Python RAG agent.
- **W3-hardening**: audit UI, security review against `SECURITY-ANALYSIS.md`, docs, backup.

### Wave 4

- **W4-memory**: memory tables + RLS migration, MCP memory tools, interface page, Python memory retriever.
- **W4-agents**: hosted agent definitions, worker runtime (pg-boss, in-process tools under the owner's restricted context), run log, templates.

## Definition of done per task

Tests for new behavior; existing suites green (`npm test --workspace=mcp-server`,
`npm test --workspace=javascript`, Python if touched); typecheck clean; no
invented Dalux API behavior (AGENTS.md); changeset if a published package changes.
