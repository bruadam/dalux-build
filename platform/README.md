# Platform

Self-hosted Dalux MCP platform (see `docs/specs/self-hosted-mcp-platform.md`).
This folder holds the Compose setup, the `@dalux-platform/db` package
(schema, migrations, row-level security), and the `@dalux-platform/web`
interface. The `worker` service joins `compose.yaml` in wave 3.

## Run with Docker Compose

```bash
cd platform
cp .env.example .env   # then fill in every value
docker compose up -d --build
```

| Service | What it does |
| --- | --- |
| `postgres` | Postgres 17 + pgvector |
| `migrate` | Applies migrations and sets the role passwords, then exits; `web` and `mcp` start after it |
| `web` | The interface (Next.js), connected as the `web` role |
| `mcp` | The MCP server (`mcp-server/Dockerfile`), connected as the `mcp` role |
| `caddy` | One HTTPS origin: `/mcp*`, `/.well-known/*`, `/token`, `/register`, `/revoke` go to `mcp`, everything else (including `/authorize`) to `web` |

Environment (all required unless a default is given):

| Variable | Used by | Meaning |
| --- | --- | --- |
| `PLATFORM_DB_MIGRATOR_PASSWORD` | postgres, migrate | Password of the owner role `migrator` |
| `PLATFORM_DB_WEB_PASSWORD` / `_MCP_` / `_WORKER_` | migrate, web, mcp | Login passwords of the `web`, `mcp`, `worker` roles. The mcp service connects as `mcp` and writes index data as `worker` |
| `PLATFORM_ENCRYPTION_KEY` | web, mcp | 32 bytes, base64 (`openssl rand -base64 32`); encrypts Dalux and embedding keys. Losing it makes stored keys unreadable |
| `BETTER_AUTH_SECRET` | web | Signs interface sessions (`openssl rand -base64 32`) |
| `PUBLIC_URL` | web, mcp | The public origin, e.g. `https://mcp.example.com`; used for invite links, cookies, auth origin checks, and as the OAuth issuer. Must be `https://` |
| `PLATFORM_SITE_ADDRESS` | caddy | Host name Caddy serves and gets a certificate for (default `localhost`) |
| `PLATFORM_HTTP_PORT` / `PLATFORM_HTTPS_PORT` / `PLATFORM_DB_PORT` | caddy, postgres | Host ports (defaults `80`, `443`, `5432`; Postgres binds to 127.0.0.1 only) |

## Interface

- The first sign-up on an empty install (`/signup`) creates the admin. After
  that, sign-up only works through an invite link that an admin creates on
  *Accounts*. Links work once, for 7 days, and only their sha256 hash is stored.
- Logins use Better Auth (email and password, Argon2id hashes, rate-limited
  sign-in, session cookies). Its tables have the `auth_` prefix; each
  `auth_users` row links 1:1 to a personal row in `accounts`. Disabling an
  account ends its sessions.
- Admin screens: accounts, robots (with owner and tokens), groups, connections
  (key verified with a Dalux read call, stored encrypted, only the last 4
  characters shown, rotation), grants (account or group; connection, project,
  file area, or folder scope by ID; the *Reader* preset = every `*:read`
  capability from `mcp-server/src/access/registry.ts`), effective access per
  account, and settings (embedding key, Dalux header mode).
- Every account sees its own access and manages its own `dxm_` API tokens. A
  token is shown once; the database stores `hashApiToken(token)` (sha256 hex of
  the full token) and a 12-character display prefix.
- OAuth 2.1 for MCP clients (Claude, ChatGPT, Linear; PRD 6.5 mode B): the
  `mcp` service serves the RFC 8414 / RFC 9728 metadata (per MCP endpoint, so
  `/mcp/c/<slug>` has its own resource), RFC 7591 registration, the token
  endpoint (PKCE S256; access tokens `dxo_…` for 1 hour, refresh tokens `dxr_…`
  for 30 days, rotated on use; presenting a used refresh token revokes the
  whole approval) and RFC 7009 revocation, with CORS on `/register`, `/token`
  and `/revoke`. The interface serves `/authorize`: sign in, choose the
  connection (fixed when the client asks for `/mcp/c/<slug>`), optionally
  narrow the capabilities, approve. Each approval is an `oauth_sessions` row;
  *Connected apps* lists and revokes them. Codes and tokens are stored as
  sha256 hashes. An OAuth access token acts like a `dxm_` token restricted to
  the approved connection; revocation takes effect within 60 seconds.
- Every admin change writes an `audit_log` row. Changes to grants, groups,
  memberships, and account status call `refresh_effective_access()` in the
  same transaction.
- Secrets never reach the browser: the interface only encrypts keys and never
  reads them back.

Local development:

```bash
npm run build --workspace=dalux-build-api && npm run build --workspace=@dalux-platform/db
DATABASE_URL=postgres://web:...@localhost:5432/platform PLATFORM_ENCRYPTION_KEY=... \
BETTER_AUTH_SECRET=... PUBLIC_URL=http://localhost:3000 npm run dev --workspace=@dalux-platform/web
```

## Postgres (alone)

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
npm test --workspace=@dalux-platform/web
```

`PLATFORM_TEST_DB_PORT` changes the host port (default 54329); set
`TEST_DATABASE_URL` to match.

Each test file creates and drops its own database on the test server
(`TEST_DATABASE_URL`, default `postgres://migrator:migrator@localhost:54329/platform_test`).
