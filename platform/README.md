# Platform

Self-hosted Dalux MCP platform (see `docs/specs/self-hosted-mcp-platform.md`).
This folder holds the Compose setup, the `@dalux-platform/db` package
(schema, migrations, row-level security), and the `@dalux-platform/web`
interface.

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
| `worker` | `node dist/cli.js worker` from the same image, connected as the `worker` role: index scopes and Dalux user matching (see *Worker*) |
| `caddy` | One HTTPS origin: `/mcp*`, `/.well-known/*`, `/token`, `/register`, `/revoke` go to `mcp`, everything else (including `/authorize`) to `web` |

Environment (all required unless a default is given):

| Variable | Used by | Meaning |
| --- | --- | --- |
| `PLATFORM_DB_MIGRATOR_PASSWORD` | postgres, migrate | Password of the owner role `migrator` |
| `PLATFORM_DB_WEB_PASSWORD` / `_MCP_` / `_WORKER_` | migrate, web, mcp | Login passwords of the `web`, `mcp`, `worker` roles. The mcp service connects as `mcp` and writes index data as `worker` |
| `PLATFORM_ENCRYPTION_KEY` | web, mcp, worker | 32 bytes, base64 (`openssl rand -base64 32`); encrypts Dalux and embedding keys. Losing it makes stored keys unreadable |
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
  account, settings (embedding key, Dalux header mode), and the audit log.
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

## Worker

`dalux-mcp worker` runs jobs with [pg-boss](https://github.com/timgit/pg-boss) in the
`pgboss` schema (created by migration 0008, owned by the `worker` role). A cron job
every minute queues what is due:

- **Index scopes** (*Indexes* in the interface, admins only): file area, task, or docs
  scopes with the same arguments as `build_file_area_index` / `build_task_index`.
  A scope runs on its schedule (default every 6 hours, minimum 15 minutes) or after
  *Refresh now*. The builders are the MCP server's incremental ones, writing to the
  Postgres store: unchanged revisions are not downloaded or embedded again. Each run
  records items indexed / unchanged / removed / pending, chunks, skipped and failed
  files with reasons, duration, and embedding tokens (from the provider's usage; marked
  *estimated* when it returns none). One run at a time.
- **Embedding key**: the key in *Settings*. Setting it is the admin's consent to send
  document text to Mistral; without it, indexes and searches are lexical only. The worker
  and search-time query embeddings on platform-token requests use only this key:
  `MISTRAL_API_KEY` and `DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO` do not apply to them. They
  still gate consistency checks and Dalux-header-mode requests, as outside platform mode.
- **Toolsets**: `/mcp` and `/mcp/c/<slug>` serve the same default toolsets as outside
  platform mode (`DALUX_MCP_TOOLSETS` / `--toolsets` change it); a client picks others
  with `?toolsets=`, e.g. `/mcp/c/site-a?toolsets=default,ifc`. Toolsets only choose
  what is listed; every tool call is still checked against the caller's grants.
- **Dalux user matching** (*Dalux users*): per connection, the users of every project
  (`GET /1.2/projects/{projectId}/users`, deduplicated by user id) are loaded when the
  connection is new, daily, and on *Load users and match now*. Personal accounts are
  linked to the one Dalux user with the same email (case-insensitive, trimmed) every
  minute, so new accounts are linked quickly. No match or several: not linked, link by
  hand. Robots are only linked by hand. Manual links are never changed.

- **Hosted agents** (*My agents*, admin *Agents*): scheduled model runs that act for their
  owner with at most the owner's access. See [agents.md](agents.md). They need `DATABASE_URL`
  (the `mcp` role) in the worker's environment, and the Mistral key in *Settings*.

Optional: `DOCS_GITHUB_TOKEN` (or `GITHUB_TOKEN`) for private docs repositories.
The worker assumes it is the only worker: at start it marks runs left *running* as failed.

## Audit log

*Audit log* (admins) lists every MCP tool call and every admin change, newest first. A tool call row has
the time, account, linked Dalux user ID, client (token or OAuth app name), connection, project, tool,
capability that was checked, result (`ok`, `denied`, `error`), and duration. It never holds tool arguments,
results, or document text. Filter by time, account, tool or action, connection, status, and kind; *Export CSV*
downloads the filtered rows (up to 50,000; cells that start with `=`, `+`, `-` or `@` are prefixed with `'`).

**Retention** is set on the same page (default 180 days). The worker deletes older rows every hour. Only the
`worker` role can delete audit rows; no role can change them.

## Backup and restore

What to back up:

| What | Where | If lost |
| --- | --- | --- |
| Postgres database `platform` | `pg_dump` (below) | Accounts, grants, tokens, connections, settings and index scopes are gone |
| `PLATFORM_ENCRYPTION_KEY` | your `.env` or secret store; **keep a copy apart from the database backup** | Not recoverable: stored Dalux and embedding keys can no longer be read. Add the connection keys and the embedding key again in the interface |
| `BETTER_AUTH_SECRET` | `.env` | Everyone is signed out; nothing else is lost |
| Index data (`indexes`, `documents`, `chunks`) | inside the dump | Recoverable: the worker rebuilds it from the index scopes (embedding calls are repeated) |
| Project memory (`memory_entries`, `memory_settings`) | inside the dump | **Not recoverable by re-indexing**: it is what users saved. Never exclude these tables from the dump |

Back up (the database and the roles, which `pg_dump` does not include):

```bash
cd platform
docker compose exec -T postgres pg_dump -U migrator -Fc platform > platform-$(date +%F).dump
docker compose exec -T postgres pg_dumpall -U migrator --globals-only > globals-$(date +%F).sql
```

To keep the backup small, leave out the index data and let the worker rebuild it after a restore. Add
`--exclude-table-data=chunks --exclude-table-data=documents --exclude-table-data=indexes` to the `pg_dump` command (only these three: memory is user data).

The dump and `globals.sql` hold password hashes and encrypted keys. Store them like the `.env` file.

Restore into an empty Postgres (a new volume), with the same `.env`:

```bash
cd platform
docker compose up -d postgres
docker compose exec -T postgres psql -U migrator -d postgres < globals-2026-11-08.sql   # "role already exists" for migrator is fine
docker compose exec -T postgres pg_restore -U migrator -d platform --exit-on-error < platform-2026-11-08.dump
docker compose up -d      # migrate applies pending migrations and sets the role passwords again
```

Check afterwards: sign in, open *Connections* (a connection with a wrong `PLATFORM_ENCRYPTION_KEY` shows an
error on first use), and run *Refresh now* on an index scope if the index data was left out. This procedure was
run end to end (backup, new volume, restore, `mcp` role reads rows under RLS, stored key decrypts) for the
full dump and for the dump without index data.

## Upgrade notes

- **Header mode is off by default.** MCP clients that send `X-Dalux-Base-Url` and `X-Dalux-Api-Key` without a
  token get 401 until an admin turns it on under *Settings*, or the client moves to a `dxm_` token or OAuth.
  Header-mode callers have no account: their temporary indexes live on disk per credentials, and everything
  they can do is limited only by their Dalux key.
- **`PUBLIC_URL` must be `https://`.** The MCP server refuses to start OAuth with another scheme, session
  cookies are only marked `Secure` under https, and Caddy sends HSTS.
- **Audit retention** starts at 180 days with migration `0010`: rows older than that are deleted within the hour
  after the worker starts. Raise it under *Audit log* before upgrading if you need to keep them.
- **Cached downloads are kept per connection** (`<cache>/files/<connection id>/<file id>`). The old
  `<cache>/files/<file id>` folders are no longer read; delete them.
- **Behind a proxy other than the bundled Caddy**, the MCP server needs `X-Forwarded-For` set by the proxy
  (replacing any client-sent value): the rate limits on `/register` (20 per hour) and `/token` (60 per minute)
  are per client address.
- **Bootstrap:** the first sign-up on an empty install becomes admin. Create it right after the first start,
  or keep the site private until then.

## Security

Threat model, in short. Assets: Dalux API keys (full read access to a customer's Dalux data), indexed
document text, accounts and grants. Actors: an authenticated user with narrow grants, a holder of a leaked or
revoked token, an unauthenticated visitor, a Dalux customer with a valid key of their own (header mode), and an
admin (trusted for configuration, with no implicit access to document data).

- **Trust boundaries.** Caddy is the only public entry point; `web`, `mcp`, `worker` and Postgres are not
  published (Postgres binds to `127.0.0.1`). `mcp` and `worker` hold the decrypted Dalux keys; the browser never
  receives a secret.
- **Authorization is checked at three layers.** The tool guard checks the capability and, for files, the folder
  before each call; the restricted Dalux client filters listings; Postgres row-level security filters index rows
  by `effective_access` even if a query is wrong. Every cached download, IFC model and report is used only after
  these checks and a Dalux lookup with the caller's connection (see `mcp-server/SECURITY-ANALYSIS.md`).
- **Tokens.** `dxm_`, `dxo_`, `dxr_` tokens and invite links are stored as sha256 hashes. Lookup is by hash in an
  indexed column, so the compared value is not attacker-chosen and a constant-time compare adds nothing.
  Tokens and Dalux keys are never written to the audit log, logs, or error text (tested).
- **Web interface.** Argon2id passwords; sign-in limited to 5 per minute and address (sign-up needs an invite after the first admin); `HttpOnly`,
  `SameSite=Lax` cookies, `Secure` under https; Next.js checks `Origin` against `Host` on server actions, and
  Better Auth checks origins on its own routes; CSP (`default-src 'self'`, `frame-ancestors 'none'`), HSTS,
  `nosniff`, no `Server` or `X-Powered-By` header.
- **SSRF.** A connection's base URL must be `https://*.dalux.com` when it is created in the interface, when it is
  loaded by `mcp` or `worker`, and in header mode. The key check on connection creation does not follow redirects.
- **Memory is private to its owner.** Row-level security on `memory_entries` and `memory_settings` matches the owner's
  account only; admins, other users, and the `web` and `mcp` roles without that account id see nothing, and `worker` has
  no access (tested as the roles, including an admin with every capability).
- **Database.** `web`, `mcp`, `worker` are not superusers, cannot bypass RLS, cannot create objects, and cannot
  switch roles. The only `SECURITY DEFINER` function has a fixed `search_path` and is callable only by `web`
  and `worker`.

Accepted risks:

- A compromised `mcp` process can set `app.account_id` to any account, so RLS protects against bugs in queries,
  not against code execution in `mcp`. Run `mcp` as the unprivileged user it ships with.
- Sign-in is limited per address, not per account; a distributed guessing attack is not stopped. Use long passwords
  or put the interface behind SSO/VPN.
- Rate limits are in memory per process (they reset on restart; one `mcp` replica is assumed).
- Admins can create a grant for themselves, so they can give themselves data access. Every change is in the audit log.
- Document text is sent to Mistral only when an admin sets an embedding key.
- Prompt injection from document text cannot be ruled out; `report_feedback` is the only outbound-write tool and
  stays off unless `DALUX_MCP_FEEDBACK_GITHUB_TOKEN` is set.
- Full-disk encryption of the Postgres volume is the operator's job (index text is stored unencrypted in Postgres).
- Download links from `download_file` point at `127.0.0.1` inside the container and cannot be opened by a remote
  client; `filePath` in results names a path inside the container.

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
npm run build --workspace=dalux-build-api && npm run build --workspace=@dalux-platform/db
npm run test:platform --workspace=mcp-server
```

CI runs the same commands in the `Test platform` job against a pgvector service container.

`PLATFORM_TEST_DB_PORT` changes the host port (default 54329); set
`TEST_DATABASE_URL` to match.

Each test file creates and drops its own database on the test server
(`TEST_DATABASE_URL`, default `postgres://migrator:migrator@localhost:54329/platform_test`).
