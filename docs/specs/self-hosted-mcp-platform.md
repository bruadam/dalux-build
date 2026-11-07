# PRD: Self-hosted Dalux MCP platform

_Status: draft v2 for review · Date: 2026-11-07 · Owner: Bruno Adam_
_v2 adds the decisions from the first review: groups, admin-only indexing,
row-level security with folder access, header mode off by default, Dalux user
mapping by email, capability-based permissions, and shared indexes for the
Python RAG agent._

## 1. Summary

Turn `dalux-build-mcp` from a stateless server that the client hands credentials
to on every request into a **self-hosted platform** that a team runs as a set of containers:

- the **MCP server** (the existing `mcp-server`, extended),
- a **web interface** for admins and users,
- a **worker** that builds and refreshes indexes, and
- **Postgres with pgvector**, the persistent store for accounts, connections,
  permissions, tokens, audit log, and all indexed and embedded content.

Admins manage one or more **Dalux connections**, **accounts** (personal and
robot) and **groups**, and grant **capabilities** (e.g. `files:read`,
`tasks:write`) per connection, project, file area, and folder. Admins decide
what is indexed; the worker keeps those indexes fresh. Every search over
indexed content goes through **Postgres row-level security (RLS)**, so a user
never sees passages from a project or folder they have no access to.

MCP clients connect with a platform API token (personal or robot) or with
OAuth using a platform account. The old Dalux-header mode still exists but is
off by default. The Python RAG agent uses the same shared indexes through MCP.

## 2. Problem

Today (see `mcp-server/README.md` and `mcp-server/SECURITY-ANALYSIS.md`):

1. **Vectors are not persistent.** File-area and task indexes are files under
   `$TMPDIR/dalux-mcp`; they are deleted after a week of no use and when the
   temp folder is wiped. Every new session or machine re-downloads and
   re-embeds the same documents and pays for the embeddings again.
2. **No user management.** A Dalux API key is a company key. Whoever has it has
   full access to every project through the MCP server. There is no way to give
   one colleague access to project A only, or to some folders only, or to give
   an agent narrower access than a person.
3. **Credentials live in every client.** Each user pastes the company API key
   into their MCP config or the OAuth form. Rotating the key means touching
   every client.
4. **OAuth state is in memory.** Tokens are lost on restart, last 90 days,
   and cannot be revoked (security finding #5).
5. **Indexes leak across tenants in HTTP mode** (security finding #1): any
   caller can list, search, and drop any index.
6. **The embedding key is server-wide.** `MISTRAL_API_KEY` is an environment
   variable; nobody can see or limit what indexing costs.
7. **Two separate RAG stores.** The Python RAG agent has its own vector store,
   so the same documents are embedded twice, with no access control.

## 3. Goals

- G1. Embedded content is stored persistently and shared per connection; a
  document is embedded once per revision, not once per session or per client.
- G2. Admins manage several Dalux connections and grant access to accounts and
  groups, without editing any MCP client config.
- G3. Two account types: **personal** (a named person who logs in) and
  **robot** (an agent; token only, never logs in).
- G4. Permissions are **capabilities per resource area** (files, tasks, forms,
  …), scoped down to connection, project, file area, and folder. Write
  capabilities exist in the model now, so write tools can be added later
  without a new permission model.
- G5. Indexed data is protected by **row-level security in the database**,
  not only by checks in application code.
- G6. Personal accounts are linked to their **Dalux user ID** per connection,
  by email.
- G7. MCP clients connect with a platform token or OAuth; the Python RAG agent
  uses the shared indexes.
- G8. The whole platform runs with one `docker compose up` on a single host.

## 4. Non-goals (v1)

- Write tools against Dalux. Only the permission model for them is in scope.
- Multi-organization SaaS. One deployment serves one organization (team).
- Billing, quotas per user, or usage-based pricing.
- Importing permissions from Dalux. The Dalux user ID is linked (6.8), but the
  platform does not assume the Dalux API can tell it who may see which
  project or folder; access is managed in the platform.
- Replacing stdio mode. Local stdio use (`node dist/cli.js`) stays as it is,
  with the file-based index store.
- Deny rules. Access is the union of all grants; nothing subtracts access (see 5.4).

## 5. Accounts, groups, and permissions

### 5.1 Accounts

| Account type | Who | How it authenticates | Can log in to the interface |
| --- | --- | --- | --- |
| Personal | A named person (email, display name) | Password or SSO in the interface; OAuth or personal API token for MCP | Yes |
| Robot | An agent or automation (e.g. "Linear triage agent", "nightly report") | Robot API tokens only | No |

Every robot account has a name, a description, and an **owner** (a personal
account). If the owner is disabled, the robot is flagged for an admin to
reassign or disable; it is not silently kept alive.

### 5.2 Organization roles

| Role | Can do |
| --- | --- |
| **Admin** | Everything: manage accounts, robots, groups, connections, grants, the embedding key, indexed scopes and index builds, settings; see the audit log |
| **User** | Use MCP within their grants; search indexes they can read; manage their own tokens; see the connections and indexes they have access to |

The first account created on a fresh install becomes admin. There must always
be at least one active admin. Admin is an organization role and is separate
from data capabilities: being admin does not by itself give access to project
data through MCP. Admins grant themselves capabilities like anyone else, so
their data access is visible in the grant list and the audit log.

### 5.3 Groups

- P0. Admins create groups (e.g. "Site team Aarhus", "Design managers") and
  add personal and robot accounts to them.
- P0. Grants can be given to an account or to a group. An account's effective
  access is the union of its own grants and the grants of all its groups.
- P1. Group membership from SSO claims (e.g. Entra ID groups), mapped to
  platform groups by an admin.

### 5.4 Capabilities and scopes

A **grant** = principal (account or group) + scope + set of capabilities.

**Capabilities** are named `<area>:<action>`. Areas follow the API groups the
clients already wrap (`javascript/src/api/*Api.js`, `python/dalux_build/api/*.py`)
and the MCP tool groups (`mcp-server/src/tools/*.ts`):

| Area | v1 capabilities (used by tools) | Reserved for future write tools |
| --- | --- | --- |
| `projects` | `projects:read` | — |
| `files` | `files:read` (list, download, render, search file content, search file indexes) | `files:write` |
| `tasks` | `tasks:read` (list, search, task indexes) | `tasks:write` |
| `forms` | `forms:read` | `forms:write` |
| `quality` | `quality:read` | `quality:write` |
| `scheduling` | `scheduling:read` | `scheduling:write` |
| `directory` | `directory:read` | — |
| `models` | `models:read` (IFC tools) | `models:write` |

The exact list is derived from the tool registry during the plan phase. Write
capabilities can be split further when write tools are designed (e.g.
`tasks:create`, `tasks:update`, `tasks:comment`); the grant table stores
capability names, so adding one needs no schema change.

**Presets** make the common cases one click: _Reader_ (all `*:read`),
_Contributor_ and _Editor_ (read plus selected write capabilities, defined when
write tools exist). Presets are expanded into capabilities when the grant is
saved, so changing a preset later does not silently change existing grants.

**Scopes**, from wide to narrow:

```
connection → project → file area → folder (and everything below it)
```

- A grant on a wider scope covers everything inside it.
- Folder scopes only apply to `files:*` capabilities. Other areas stop at project.
- **Default: everything.** A grant on a connection or project covers all file
  areas and folders. Folder-level grants are only needed to give access to
  _part_ of a project. The folder-level mechanism (data model, RLS, checks) is
  P0; the interface for picking folders is P1.
- Effective access = union of all grants of the account and its groups. There
  are no deny rules in v1 (open question 1).
- The Dalux API key of the connection is the upper limit: the platform can only
  narrow what the key allows, never widen it.

### 5.5 Where access is checked

1. **Tool layer (application check).** Every MCP tool declares the capability
   it needs and how to find its scope (project ID, file area ID, folder or file
   ID) from its arguments. The MCP server checks before calling Dalux.
   List tools filter their output to what the caller can see (e.g.
   `list_projects`, folder and file listings). For a file, the server checks
   the file's folder using the folder information it already reads from Dalux.
2. **Database layer (RLS).** All indexed content is read under RLS (6.7), so a
   bug in a tool check cannot leak indexed passages.

## 6. Functional requirements

Priority: **P0** = needed for the first release; **P1** = shortly after; **P2** = later.

### 6.1 Interface: accounts, groups, authentication

- P0. Email and password login for personal accounts, with secure session cookies.
- P0. Admin invites personal accounts by email (invite link if no mail server
  is set up), disables or deletes them, and changes roles.
- P0. Admin creates robot accounts, assigns an owner, issues and revokes their tokens.
- P0. Admin manages groups and their members.
- P0. Every account can see and revoke its own active tokens and OAuth sessions.
- P0. "Effective access" view per account: what it can do where, and which
  grant (direct or via which group) gives it.
- P1. OIDC SSO (e.g. Microsoft Entra ID, Google) for personal accounts.
- P1. TOTP two-factor authentication; admins can require it.

### 6.2 Interface: Dalux connections and grants

- P0. Admin adds a connection: name, Dalux base URL (`https://*.dalux.com`,
  same rule as today), API key. The key is verified with a read call before saving.
- P0. API keys are encrypted at rest (7.4) and never shown again after saving;
  only the last 4 characters are displayed. Admin can rotate the key.
- P0. Admin grants capabilities (or a preset) to accounts and groups on a
  connection or project (project list loaded from the connection).
- P1. Folder picker for file-area and folder grants.
- P1. Connection health: last successful call, last error.

### 6.3 Interface: indexation (admin only)

- P0. Admin sets the **embedding API key** (Mistral) in the interface, stored
  encrypted. Without one, indexes are lexical only, as today.
- P0. **Only admins create, refresh, and drop indexes**, in the interface.
  Admins define **indexed scopes** per connection: file area (+ optional folder
  and extension filter), task scope (project + optional type/filter), and the
  docs corpus. These are the same scope definitions as the current
  `build_file_area_index` and `build_task_index` tools.
- P0. A background worker builds and refreshes indexed scopes on a schedule
  (default every 6 hours) and on demand ("Refresh now"). It reuses the current
  incremental logic: only changed revisions are re-downloaded and re-embedded.
  Moved files and folders update the stored folder ancestry, so RLS follows moves.
- P0. Index status page: files/tasks indexed, chunks, skipped and failed files
  with reasons, last refresh, embedding model, and embedding tokens used per run.
- P1. Monthly embedding token budget; indexing pauses with a visible warning
  when it is reached.
- P1. Embedding key per connection (overrides the organization key).

### 6.4 Interface: audit

- P0. Audit log of admin actions (accounts, groups, grants, connections, keys,
  tokens, index scopes and builds).
- P0. Audit log of MCP tool calls: time, account, linked Dalux user ID,
  client (OAuth client name or token name), connection, project, tool name,
  capability checked, result status, duration. **No arguments or results with
  document content are stored.**
- P1. Filter and CSV export; retention setting (default 180 days).

### 6.5 MCP server: connecting

| Mode | Client sends | Identity | Uses grants and shared indexes | Default |
| --- | --- | --- | --- | --- |
| A. Platform API token | `Authorization: Bearer dxm_...` | Personal or robot account | Yes | On |
| B. OAuth 2.1 | Token from the platform's OAuth flow | Personal account | Yes | On |
| C. Dalux headers (legacy) | `X-Dalux-Base-Url`, `X-Dalux-Api-Key` | None | No | **Off** (admin switch) |

- P0. **Choosing a connection.** Each connection has its own endpoint,
  `/mcp/c/<connection-slug>`, so existing tool schemas do not change. `/mcp`
  without a slug uses the account's default connection.
- P0. **OAuth.** The interface is the authorization server: the user logs in
  (password or SSO), sees which client is asking, chooses the connection, and
  approves. It keeps what works today: RFC 8414 metadata, RFC 7591 dynamic
  client registration, PKCE (S256), and CORS for Linear's browser-based
  registration. New: tokens are stored hashed in Postgres and survive restarts;
  access tokens last 1 hour, with refresh tokens (30 days, rotated on use);
  revocation in the interface takes effect within 60 seconds.
- P0. **API tokens.** Format `dxm_<random>`; shown once; stored as a hash.
  Optional expiry (default 90 days for personal, none for robots, set by an
  admin). A token can be restricted to one connection and to a subset of the
  account's capabilities (e.g. a read-only token for an account that has write).
- P0. **Header mode (C)** is off by default. When an admin turns it on, it
  behaves as today: no account, no access to shared indexes, the file-based
  temporary indexes only, namespaced by a hash of the credentials (fixes
  security finding #1 for this mode).

### 6.6 MCP server: tools and access

- P0. Every tool is registered with its capability and a scope resolver. A
  denied call returns a clear MCP error that names the missing capability, and
  is audit-logged.
- P0. `list_projects`, directory, file-area, folder, and file listings return
  only what the caller can see.
- P0. In platform mode, **index build and drop tools are not offered to
  non-admins** (`build_file_area_index`, `drop_file_area_index`,
  `build_task_index`, `drop_task_index`). Search and list index tools only
  return indexes and passages the caller can read (enforced by RLS).
- P0. `search_file_content` (single-document search without an index) checks
  `files:read` on the file's folder before downloading.
- P0. `report_feedback` keeps its current rules.

### 6.7 Persistent vector store with row-level security

- P0. One storage interface with two implementations:
  - **File store** (current code) for stdio, header mode, and local use.
  - **Postgres store** for the platform.
- P0. Postgres tables (simplified): `index` (connection, scope, embedding
  model and dimension), `document` (index, Dalux file/task ID, revision or
  content hash, **project ID, file area ID, folder ID, folder ancestor IDs**),
  `chunk` (document, text, citation location, `embedding vector(1024)`,
  full-text `tsvector`). Access columns are copied onto `chunk` as well, so
  policies need no joins on the hot path.
- P0. **RLS policies** on `index`, `document`, and `chunk`:
  - The MCP server sets the caller per transaction
    (`SET LOCAL app.account_id = ...`) and queries as a database role that is
    **not** the table owner and has no `BYPASSRLS`; tables use
    `FORCE ROW LEVEL SECURITY`.
  - A row is visible if the caller has `files:read` (file indexes) or
    `tasks:read` (task indexes) on its connection, project, file area, or one
    of its folder ancestors, directly or through a group.
  - Effective access is precomputed into an `effective_access` table
    (account, connection, project, file area, folder, capability), rebuilt
    when grants, groups, or memberships change, so the policy is an indexed lookup.
  - The docs corpus (laws, guidelines, standards) is not project data. It is
    visible to every active account.
  - Only the worker's database role may insert, update, or delete index data.
- P0. Lexical ranking moves to Postgres full-text search (`simple`
  configuration, so drawing numbers and Nordic words are not stemmed away).
  Scores stay on an absolute scale (no "top hit = 1.0"), as today.
- P0. Indexes belong to a **connection**, not to a user or session. Two users
  searching the same file area use the same chunks and vectors; RLS gives each
  of them only their visible rows.
- P0. Vector search must stay correct under RLS: filtered approximate (HNSW)
  search can return too few rows when most rows are hidden. Use pgvector's
  iterative index scans, and fall back to exact search on the visible rows
  when the result is short. Test both cases (7.2).
- P0. The embedding model and dimension are stored per index; the
  model-change logic from the Mistral PR (re-embed on change, search
  lexically until done) carries over.
- P1. Hybrid ranking: combine vector and full-text results (reciprocal rank fusion).
- P1. One-time import of existing file-store indexes.
- P2. Cross-scope search: one query over all indexes a user can read on a connection.

**Task attachments.** Attachments indexed with a task inherit the task's
project scope and need `tasks:read`, not a folder grant, since they are not
stored in a file-area folder.

### 6.8 Dalux user mapping

- P0. For each connection, every personal account is linked to a **Dalux user
  ID** by matching the account email with Dalux user emails
  (case-insensitive, trimmed). The worker reads users through the client's
  existing user lookup; the exact endpoint and fields are confirmed against
  the SwaggerHub docs during the plan phase, not assumed.
- P0. Matching runs when an account or connection is created, and then daily.
- P0. No match or more than one match: the account shows as "not linked" in
  the interface, and an admin can set the Dalux user manually. A manual link
  is not overwritten by automatic matching.
- P0. Robot accounts are not matched by email. An admin may link a robot to a
  Dalux user (e.g. a service user) manually.
- P0. The link is used in the audit log, and is the basis for future features:
  "my tasks" filters, and attributing future write calls to the right person.
- The link does **not** grant or restrict access by itself (see non-goals).

### 6.9 Python RAG agent on the shared indexes

- P0. The Python RAG agent (`python/dalux_build/ai/`) gets a retriever backed
  by the platform's MCP search tools (`search_file_area`, `search_task_index`,
  `search_docs`) over streamable HTTP, instead of its own vector store.
  Retrieval stays RLS-protected because it goes through MCP.
- P0. When the agent works for a person, it uses that person's token (OAuth or
  personal API token), so it sees exactly what the person may see. A robot
  token is only for unattended jobs, with that robot's grants.
- P0. Stdio and local mode keep the current local vector store, so the Python
  package still works without the platform.
- P1. The adaptive RAG loop from PR #167 works unchanged on top of the new
  retriever (same document shape: text, file name, page or location).

## 7. Non-functional requirements

### 7.1 Deployment

- `docker compose up` starts `web`, `mcp`, `worker`, `postgres` (with pgvector),
  and a reverse proxy (Caddy) serving `/` (interface) and `/mcp` (MCP) on one
  HTTPS origin.
- Configuration by environment: `PUBLIC_URL`, `DATABASE_URL` (one per database
  role), `PLATFORM_ENCRYPTION_KEY`, optional SMTP and OIDC settings.
  Everything else is configured in the interface.
- Database migrations, including RLS policies and roles, run automatically on start.
- Backup and restore of Postgres is documented. Losing the vector tables is
  recoverable by re-indexing; losing the encryption key is not.

### 7.2 Performance

- Token and grant checks add at most 20 ms (p95) per tool call (cached for up
  to 60 seconds; revocation applies within that time).
- Search over an index of 500k chunks returns in under 300 ms (p95) on a
  4 vCPU / 16 GB host, both for a user who sees everything and for one who
  sees 1% of the rows.
- Refreshing an unchanged scope makes no embedding calls and downloads no files.
- Rebuilding `effective_access` after a grant change takes under 5 seconds for
  200 accounts, 50 groups, and 10,000 folder grants.

### 7.3 Compatibility

- Stdio mode, the CLI, and current tool names and schemas keep working.
  Breaking changes to existing tools need a separate decision.
- Header mode exists but is off by default in the platform image. Deployments
  that relied on it must switch it on, or move to tokens; the upgrade notes say so.

### 7.4 Security

- Dalux API keys, the embedding key, and other secrets are encrypted with
  AES-256-GCM using `PLATFORM_ENCRYPTION_KEY` (one data key per secret).
  Secrets are decrypted only in `mcp` and `worker`, never sent to the browser.
- Tokens, refresh tokens, and invite links are stored as hashes only.
  Passwords are hashed with Argon2id.
- Separate database roles: `web` (accounts, grants; no index data), `mcp`
  (reads index data under RLS), `worker` (writes index data), `migrator` (owner).
- The interface has CSRF protection, rate-limited login, and secure cookies.
- Account, group, and grant changes take effect within 60 seconds.
- All open items in `SECURITY-ANALYSIS.md` are resolved or explicitly
  accepted in platform mode: #1 by connection scoping and RLS, #4 by storing
  index data in Postgres (plus disk encryption guidance), #5 by 6.5, #6 by
  required accounts.
- Document text is sent to Mistral only when an admin has set an embedding
  key; the interface says so clearly (finding #2).

## 8. Architecture overview

```
           ┌──────────── Caddy (TLS, one origin) ─────────────┐
 Browser ──┤ /                    → web (Next.js, OAuth AS)    │
 MCP client┤ /mcp, /mcp/c/<slug>  → mcp (existing server, RS)  │
 Python RAG┘                                                   │
           └───────────────────────────────────────────────────┘
          web ──┐           mcp ──┐            worker ──┐
                ▼                 ▼  (RLS, app.account_id) ▼
     Postgres + pgvector: accounts, groups, grants, effective_access,
     connections (encrypted keys), Dalux user links, tokens, OAuth clients,
     audit log, indexes, documents, chunks + embeddings
                                  │
                      Dalux Build API, Mistral API
```

- **web**: same stack as `webhook-ui` (Next.js, Tailwind, shadcn/ui), without
  Supabase. Hosts login, OAuth authorize/consent pages, and admin screens.
- **mcp**: the existing server, plus platform auth, connection selection,
  capability checks, and the Postgres store.
- **worker**: index builds and refreshes (current `rag/*Build.ts` logic),
  Dalux user matching, and `effective_access` rebuilds. Same image as `mcp`
  with another command.
- Candidates to choose in the plan phase: Better Auth or Auth.js (accounts,
  OIDC, OAuth provider); Drizzle or Kysely (schema and migrations shared by
  `web`, `mcp`, `worker`); pg-boss (jobs in Postgres, no Redis).

## 9. Success criteria

1. A new admin goes from `docker compose up` to a working Claude.ai connector
   (OAuth, own account, one connection) in under 15 minutes, following the README.
2. A user with `files:read` on project A only gets a capability error for
   project B from every tool that takes a project ID, and does not see B in
   `list_projects`.
3. A user granted one folder of a file area gets search results only from
   that folder and its subfolders, **even when querying the database directly
   with the `mcp` role and that user's `app.account_id`** (RLS test, not only
   a tool test).
4. Moving a file out of a granted folder hides its passages from that user
   after the next refresh.
5. After a restart, OAuth sessions, API tokens, and indexes still work; no
   re-embedding happens.
6. Revoking a token, disabling an account, or removing a group member blocks
   the affected access within 60 seconds.
7. Two users searching the same file area cause one embedding run, not two.
8. A non-admin does not see index build or drop tools.
9. A personal account whose email exists in Dalux is linked to the right Dalux
   user ID on each connection; unmatched accounts are listed for admins.
10. A token restricted to read capabilities is rejected by a tool that needs a
    write capability (tested with a test-only write tool).
11. The Python RAG agent answers from the shared indexes with a user's token
    and cites only passages that user may see.
12. The audit log shows every tool call with account, Dalux user ID, and
    project, and holds no document text.
13. Header mode and stdio mode pass the existing test suite unchanged.

## 10. Milestones

| # | Milestone | Content | Depends on |
| --- | --- | --- | --- |
| M1 | Persistent store | Storage interface; Postgres + pgvector store (folder ancestry columns included); full-text ranking; compose file | — |
| M2 | Accounts and groups | Schema, `web` app, login, admin/user roles, personal and robot accounts, groups, API tokens | M1 |
| M3 | Permissions | Connections (encrypted), capability grants on connection/project/file area/folder, `effective_access`, tool capability tags and checks, `/mcp/c/<slug>` | M2 |
| M4 | RLS | Database roles, RLS policies, filtered vector search, RLS test suite | M1, M3 |
| M5 | OAuth | Platform as authorization server; stored, refreshable, revocable tokens; connection picker | M2, M3 |
| M6 | Indexation | Admin-only index scopes, embedding key in the interface, worker schedules, status and token usage | M1, M4 |
| M7 | Dalux user mapping | Email matching per connection, manual links, audit integration | M3 |
| M8 | Python RAG on shared indexes | MCP-backed retriever over HTTP, token handling | M4, M5, M6 |
| M9 | Audit and hardening | Audit logs, security review against `SECURITY-ANALYSIS.md`, backup docs | M3–M8 |

M1 can ship alone. M4 is the gate before any real project data is indexed
into the shared store.

## 11. Decisions from review (v2)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Grants to accounts or groups? | Both (5.3) |
| 2 | Who builds indexes? | Admins only. Indexed data is protected by RLS with folder-level access; default access is everything (5.4, 6.7) |
| 3 | Dalux-header mode default? | Off; an admin can turn it on (6.5) |
| 4 | Link platform accounts to Dalux users? | Yes, by email per connection (6.8) |
| 5 | Permission granularity? | Finer than read/write per project: capabilities per resource area, scoped to connection/project/file area/folder (5.4) |
| 6 | Python RAG agent? | Uses the shared indexes through MCP (6.9) |

## 12. Open questions

1. **Deny rules.** v1 access is the union of grants. Is there a real case for
   "everyone in group X except folder Y" (e.g. HR or contract folders)? If so,
   deny grants would need to be added to the model and to RLS.
2. **Folder access for live file tools.** Checking `files:read` on a folder for
   every download needs the file's folder. Is one extra Dalux lookup per
   uncached file acceptable, or should the worker keep a file → folder map for
   indexed file areas only?
3. **Admins and data access.** This PRD keeps admin (managing the platform)
   separate from data access (capabilities). Should admins instead see all
   data by default?
4. **Group sync from SSO** (P1): which identity provider must be supported first?
5. **Dalux users per connection.** If the same person has different emails in
   different Dalux companies, is manual linking enough?
6. **Write capability names.** The reserved `*:write` capabilities are
   placeholders. They should be split into concrete actions when the first
   write tool is designed, based on the Dalux API docs.

## 13. Assumptions

- A Dalux API key gives company-wide access, as the current README describes,
  so per-user and per-folder restrictions must be enforced by the platform.
- The Dalux API exposes users with an email field and files with their folder;
  both are to be confirmed against the SwaggerHub docs in the plan phase.
- Mistral (`mistral-embed`, 1024 dimensions) stays the embedding provider, as
  in PR #167.
- Postgres 16+ with pgvector 0.8+ (for iterative index scans) is acceptable as
  the only stateful dependency.
- The interface reuses the `webhook-ui` stack but not its Supabase backend.
