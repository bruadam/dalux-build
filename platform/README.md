# Platform

Self-hosted Dalux MCP platform (see `docs/specs/self-hosted-mcp-platform.md`).
Today this folder holds the Postgres service and the `@dalux-platform/db`
package; `web`, `mcp`, `worker`, and Caddy join `compose.yaml` later.

## Postgres

```bash
cd platform
PLATFORM_DB_MIGRATOR_PASSWORD=change-me docker compose up -d postgres
```

The container's superuser is `migrator`, which owns all tables.

## Migrations

```bash
DATABASE_URL=postgres://migrator:change-me@localhost:5432/platform \
PLATFORM_DB_WEB_PASSWORD=... PLATFORM_DB_MCP_PASSWORD=... PLATFORM_DB_WORKER_PASSWORD=... \
npm run migrate --workspace=@dalux-platform/db
```

Migrations create the roles `web`, `mcp`, and `worker` (`NOLOGIN`) and then
set a login password for each role whose `PLATFORM_DB_<ROLE>_PASSWORD` is set.
Roles are cluster-wide, so every database in the cluster shares them.

After a schema change in `db/src/schema.ts`, run
`npm run generate --workspace=@dalux-platform/db`. Roles, grants, row-level
security, and SQL functions live in hand-written migrations
(`npx drizzle-kit generate --custom --name=<name>` in `db/`).

## Access model in the database

- `grants` hold capabilities for an account or a group on a connection,
  project, file area, or folder (NULL = the whole level).
- `refresh_effective_access()` rebuilds `effective_access` from direct and
  group grants of active accounts. `web` and `worker` call it after changing
  grants, groups, memberships, or account status.
- `indexes`, `documents`, and `chunks` use forced row-level security. The
  `mcp` role sees a row only inside a `withAccount(db, accountId, fn)`
  transaction, and only if `effective_access` gives that account `files:read`
  (file indexes) or `tasks:read` (task indexes) on the row's connection,
  project, file area, or one of its `folder_ancestor_ids`. Docs rows are
  visible to every active account. Only `worker` writes these tables.
- `folder_ancestor_ids` lists the folder path from the file area's top folder
  down to and including the document's own folder.

## Secrets

`encryptSecret` / `decryptSecret` use AES-256-GCM envelope encryption with
`PLATFORM_ENCRYPTION_KEY` (32 bytes, base64: `openssl rand -base64 32`).
Losing this key makes stored API keys unreadable.

## Tests

```bash
cd platform
docker compose -f compose.test.yaml up -d --wait
npm test --workspace=@dalux-platform/db
```

Each test file creates and drops its own database on the test server
(`TEST_DATABASE_URL`, default `postgres://migrator:migrator@localhost:54329/platform_test`).
