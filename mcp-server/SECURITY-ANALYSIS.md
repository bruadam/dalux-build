# dalux-build-mcp — Security Analysis

_Date: 2026-09-22 · Scope: `mcp-server/src` at commit `92bbcf7` · Method: manual code review_
_Platform-mode status added 2026-11-08 (M9 review of the self-hosted platform), verified with tests against the platform branch._

## Summary

The server is well designed on most fronts: credentials are per-request and never persisted, OAuth follows PKCE/S256 with registered redirect URIs, the Dalux base URL is pinned to `https://*.dalux.com` (no SSRF), and every direct file read goes through Dalux with the caller's own key.

One real **cross-tenant data leak** exists, affecting only the **HTTP transport when several Dalux API keys share one server** (the default stdio mode — one user on their own machine — is not affected).

| # | Severity | Finding | Original status | Platform mode (2026-11-08) |
| --- | --- | --- | --- | --- |
| 1 | **High** (multi-tenant HTTP) | File-area and task search indexes are shared across tenants with no authorization check | Open | **Resolved** (see below) |
| 2 | Medium | Document text is sent to a third-party embedding provider when a key is set | Policy decision | **Resolved**: only the admin's embedding key, shown in the interface |
| 3 | Medium | Prompt injection from document/task content could drive `report_feedback` as an exfiltration channel | Mitigated, not eliminated | **Accepted**: off unless a GitHub token is configured; compose sets none |
| 4 | Low | Cached documents stored unencrypted with default (umask) permissions | Open | **Resolved** for permissions (0700); **accepted** for encryption at rest (disk encryption is the operator's job) |
| 5 | Low | OAuth access tokens live 90 days with no revocation endpoint | Open | **Resolved** |
| 6 | Low | Shared-secret gate (`DALUX_MCP_TOKEN`) is optional; README understates multi-tenant risk | Docs | **Resolved**: platform mode requires an account token on every request |

"Platform mode" means `DATABASE_URL` is set (see `platform/README.md`). Stdio and standalone HTTP are covered where noted.
Every status below has a test; the test file and name are given as evidence.

### Status and evidence per finding

**#1 Resolved.** Three layers, each tested:

- *Index data* lives in Postgres under forced row-level security, filtered by the caller's `effective_access`, including folder ancestry. `platform/db/test/rls.test.ts` (project, folder, group, disabled account, no account id, success criteria 3 and 4) and `platform/db/test/hardening.test.ts` (the `mcp` role under `SET row_security = off`, temp tables and functions shadowing the policy inputs, forged account ids, `SET ROLE`).
- *Tools*: search, list, build and drop go through the capability and folder check. `mcp-server/test/platform/hardening.platform.test.ts` › "shared index": an admin builds one index; two users with different folder grants each get only their folder's passages; a user without `files:read` is denied; build and drop are not available to non-admins. `http.platform.test.ts` covers the other capability and listing checks.
- *Header mode* (Dalux key in headers): temporary indexes, reports, jobs and cached downloads are namespaced by a hash of the credentials. `http.platform.test.ts` › "builds and searches a temporary file index per credentials", and for the standalone HTTP transport (no platform) `mcp-server/test/security.httpIsolation.test.ts`. The standalone transport was open until this review: callers with different keys shared `rag/`; `http.ts` now always sets the namespace.

*Shared caches (the open item from the platform plan).* The per-file download cache and what is derived from it are shared by callers of the same connection, never across connections:

| Cache | Key | Before a hit is served |
| --- | --- | --- |
| Downloaded files `files/<scope>/<fileId>` | scope = connection (platform), credentials hash (header mode) | `download_file`, `search_file_content`, `render_pdf_page` call Dalux with the caller's key on every call (no cache read at all) after the platform capability + folder check |
| Resident IFC models, geometry, viewer data, clash/volume inputs | scope + file id; geometry caches are keyed by the model object | `assertReadable` (Dalux lookup with the caller's client) before any cache read, after the platform capability + folder check (`readsFiles` tools) |
| Derived files `derived/<scope>/<fileId>` (schedules, clash results, edited IFC) | scope + file id; job and edit-session ids are random and owned | owner check (G2) plus the check above |
| Consistency reports | per account and connection | on read, the files are listed again through the restricted client and findings that quote a file no longer visible are dropped, also from exports |
| Rendered PDF pages | not cached (rendered per call) | n/a |

Tests: `hardening.platform.test.ts` › "shared file cache" (user A downloads a file; user B without the folder grant is denied on `download_file`, `search_file_content`, `render_pdf_page`, and IFC tools and nothing is downloaded; a cached model is not served when Dalux refuses the file, though the platform allows it; downloads of two connections land in different directories; a file id such as `../../x` is refused), `ifcSession.test.ts` (same file id on two connections), `cachePaths.test.ts`, `consistency.report.test.ts` › "stops showing findings...".

**#2 Resolved.** Search-time and worker embeddings use only the key an admin stores in *Settings*; `MISTRAL_API_KEY` and `DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO` do not apply. `http.platform.test.ts` › "search-time embeddings", `worker.platform.test.ts` › "builds lexical indexes without an embedding key". The settings page says what the key does.

**#3 Accepted.** `report_feedback` stays confirmation-gated and posts only when `DALUX_MCP_FEEDBACK_GITHUB_TOKEN` (or `GITHUB_TOKEN`) is set in the `mcp` environment, which `platform/compose.yaml` does not do. Do not set it in a multi-user deployment. Audit rows hold no arguments, so a feedback exfiltration would not be visible in the audit log either.

**#4 Resolved (permissions), accepted (encryption).** Cache directories are created `0700` (`cachePaths.test.ts` › "cache directory permissions"). Index data is in Postgres, not on disk. Postgres data is not encrypted by the platform; use an encrypted volume (see `platform/README.md`, Security).

**#5 Resolved.** Access tokens `dxo_` last 1 hour, refresh tokens `dxr_` 30 days and rotate on use (reuse revokes the whole approval), RFC 7009 revocation, revocation by the user under *Connected apps*. `oauth.platform.test.ts`. `/register` (20/hour) and `/token` + `/revoke` (60/minute) are rate limited per client address (`hardening.platform.test.ts` › "OAuth endpoints"). Redirect URIs must be `https://` or loopback `http://` (same suite).

**#6 Resolved.** Every request needs a `dxm_`/`dxo_` token of an active account (`http.platform.test.ts` › "authentication"); Caddy is the only published entry point; HSTS and security headers are set (see below).

### Other findings from the W4 review

| Area | Finding | Result | Evidence |
| --- | --- | --- | --- |
| Cache paths | `cacheDirFor(fileId)` joined a caller-supplied id into a path: `../x` created directories outside the cache | **Fixed**: ids must match `[\w.-]+` | `cachePaths.test.ts`, `hardening.platform.test.ts` |
| Cache keys | File id is only unique per Dalux customer; two connections could be served each other's cached file or model | **Fixed**: scope in cache path, resident-model key and model registry | `ifcSession.test.ts`, `cachePaths.test.ts` |
| Reports | A consistency report stayed readable after the caller's grants shrank | **Fixed**: re-checked on read | `consistency.report.test.ts` |
| OAuth | `/register`, `/token`, `/revoke` unauthenticated and unlimited | **Fixed**: per-address rate limits | `hardening.platform.test.ts` |
| Header mode | Handler cache keyed by raw credentials grew without bound | **Fixed**: capped at 200 entries | `http.ts` (`MAX_CREDENTIAL_HANDLERS`) |
| SSRF | Base URL check accepted control characters and `user@` forms | **Fixed**: stricter; also checked on creation in the interface, when loaded by `mcp` and `worker`, and in header mode | `security.daluxUrl.test.ts`, `http.platform.test.ts` › "misconfigured connection", `worker.platform.test.ts` (worker refuses a bad URL) |
| Interface | No CSP, HSTS, or other headers; `X-Powered-By` set; no sign-up rate limit | **Fixed** in Caddy and Next config. Verified with Caddy 2 (headers on web routes, CSP only on web routes, no `Server`) and `next start` (no `X-Powered-By`) | `platform/Caddyfile` |
| Interface | CSRF on server actions, cookie flags | **Resolved by the framework, checked**: a server action POST with a foreign `Origin` is refused before the action runs (500), same-origin gets past the check (400 for an unknown action id); Better Auth refuses foreign origins on its routes (403); cookies are `HttpOnly`, `SameSite=Lax`, `Secure` under https (library defaults, read in `better-auth/dist/cookies`) | manual check against `next start`, documented here |
| Interface | Brute-force of sign-in | **Resolved** per address (5/minute, 429 on the 6th); not per account (accepted) | manual check against `next start` |
| Interface | Sign-up over HTTP | Only the sign-up server action creates logins (invite or first admin); `/api/auth/sign-up/*` answers 404 | `app/api/auth/[...all]/route.ts` |
| Tokens | Compare timing | Token lookup is `WHERE token_hash = sha256(token)` on an indexed column; the attacker does not choose the compared bytes. Accepted. `hashApiToken` is the only comparison; `DALUX_MCP_TOKEN` (non-platform) uses `timingSafeEqual` | `http.platform.test.ts`, `platform/db/test/tokens.test.ts` |
| Secrets | Tokens or Dalux keys in logs, audit rows, error text | None found. Tokens and keys are not in `api_tokens`/`connections` rows (hash and ciphertext only), not in audit rows, not in error responses or console output across the suite; the Dalux client's errors do not contain the key | `hardening.platform.test.ts` › "secrets and document content", `security.keyLeak.test.ts` |
| Audit | Document text in audit rows | None: rows hold identifiers only; a test searches the table for query text and file content | `hardening.platform.test.ts` |
| Header injection | `X-Dalux-*` values | Base URL is validated (no CR/LF, no userinfo, `https://*.dalux.com`); the API key is only sent as the `X-API-KEY` header by the fetch implementation, which rejects invalid header values | `security.daluxUrl.test.ts`, `hardening.platform.test.ts` › "Dalux header mode" |
| RLS | `SET ROLE`, `SET SESSION AUTHORIZATION`, `row_security = off`, temp tables or functions named like the policy inputs, `CREATE` in `public`, malformed account ids | All refused or ineffective | `platform/db/test/hardening.test.ts` |
| RLS | `SECURITY DEFINER` functions | Exactly two: `refresh_effective_access` (web, worker) and `admin_stop_agent` (web; checks the caller is an active admin; added by hosted agents). Both have a fixed `search_path`, `EXECUTE` revoked from `PUBLIC` and not granted to `mcp`. `memory_may`, `app_is_admin` and `app_account_id` run as the caller. A new definer function fails the test until it is reviewed | same (`hardening.test.ts` › "SECURITY DEFINER functions"); `agents.test.ts` for the admin check |
| Roles | Privilege creep | Privileges of `web`, `mcp`, `worker` on index data, memory, credentials, tokens, grants, login data and audit rows are asserted | same |
| Hosted agents | `mcp` reading or changing agent definitions or runs | Refused (no grants); admins can list and stop agents but not read run output | same, `agents.test.ts` |
| Memory | Another account, an admin, or `mcp` without the owner's id reading memory | Refused (owner-only policies, `worker` has no grant) | same |
| Revocation | Changes apply within 60 s (success criterion 6) | Revoked token, disabled account, removed group member: blocked after the 60 s cache | `hardening.platform.test.ts` › "changes take effect within 60 seconds" |
| Restart | State kept after restart (success criterion 5) | Tokens and OAuth sessions are database rows; a fresh process accepts existing tokens; index data is in Postgres (`store.postgres.test.ts`) | `hardening.platform.test.ts` › "restart" |
| Audit trail | Every call has account, Dalux user ID and project (success criterion 12) | Yes | `hardening.platform.test.ts`, `http.platform.test.ts` › "audit" |

### Accepted risks and open items

- A compromised `mcp` process can set `app.account_id` to any account. RLS protects against query bugs, not code execution in `mcp`.
- Sign-in is limited per address, not per account.
- Rate limits are in memory per process and assume one `mcp` replica and a proxy that sets `X-Forwarded-For` (the bundled Caddy does).
- Admins can grant themselves data access; every change is in the audit log.
- `download_file` returns a `127.0.0.1` link and a container-local `filePath`: unusable by remote callers, not a leak.
- Postgres data is not encrypted at rest by the platform.
- Standalone and stdio modes keep their shared `files/` cache when there is a single caller.
- Header mode (off by default) trusts the Dalux key as the only access control.

---

## 1. Cross-tenant leak via search indexes (High)

### What

In HTTP mode, every tenant shares one process and one cache directory (`mcpCacheRoot()`). The IFC tools guard their shared caches correctly — `assertReadable` (`src/ifc/session.ts:89`) asks Dalux whether the caller may read the file before any cache hit is served. The RAG index tools have no equivalent guard:

| Tool | Code | Problem |
| --- | --- | --- |
| `list_file_area_indexes` | `src/tools/fileAreaIndex.ts:159` → `listIndexes()` in `src/rag/store.ts:218` | Returns **every** index on the server, including other tenants' `indexId`s and scopes (project/file-area IDs, file counts) |
| `list_task_indexes` | `src/tools/taskIndex.ts:99` → `src/rag/taskStore.ts:179` | Same, for task indexes |
| `search_file_area` (by `indexId`) | `src/tools/fileAreaIndex.ts:113` | Searches the index with no Dalux call; returns matching document text, file names, pages |
| `search_task_index` | `src/tools/taskIndex.ts:76` (`_client` unused) | Same, returns task text |
| `drop_file_area_index` / `drop_task_index` | `src/tools/fileAreaIndex.ts:170`, `src/tools/taskIndex.ts` | Any tenant can delete any other tenant's index |

Searching by scope (`projectId` + `fileAreaId`) only recomputes the deterministic `indexId`; `resolveScope` may touch Dalux for folder-path resolution but does not verify read access on the indexed contents.

### Impact

- Tenant B lists indexes, sees tenant A's `indexId`, calls `search_file_area` → reads tenant A's contracts, specs, drawings text.
- A user whose Dalux access was revoked keeps searching an index built before revocation.
- Denial of service: tenant B drops tenant A's indexes.

Nothing stops an arbitrary Dalux customer from connecting: `DALUX_MCP_TOKEN` is optional, and in OAuth mode any valid Dalux key can self-register. The README statement "an attacker without valid Dalux credentials can't do anything useful" is true, but a customer of **a different company** *does* have valid credentials.

### Fix

1. **Namespace indexes per tenant.** Derive `tenantKey = sha256(normalizedBaseUrl + "\0" + apiKey)` (never store the key itself). Store it in the manifest and/or prefix the index directory with it.
2. `listIndexes`, `searchIndex`, `readManifest`, `dropIndex` take `tenantKey` and refuse (as "not found", to avoid an existence oracle) any index belonging to another tenant.
3. **Re-authorize on search**, mirroring `assertReadable`: before serving results, make one cheap Dalux call for the manifest's scope (e.g. `getFileArea(projectId, fileAreaId)` / `getProject(projectId)`) with the caller's client. This covers revoked access and same-company keys with different permissions.
4. Add a regression test: two clients with different credentials — B cannot list, search or drop A's index.

The docs index (`search_docs`) is intentionally a single shared corpus and is out of scope — confirm its source repo contains nothing tenant-specific.

---

## 2. Document text sent to OpenAI (Medium — policy)

With `OPENAI_API_KEY` set, `build_file_area_index`, `build_task_index` and `search_file_content` send chunked document/task text to OpenAI's embeddings API. That is third-party processing of customer construction data (contracts, personal data in tasks).

**Action:** document this in the README/privacy notice; confirm your DPA with OpenAI and with customers covers it; offer a per-deployment switch (or leave the key unset → BM25 lexical ranking); consider an EU-region or self-hosted embedding model.

## 3. Prompt injection → exfiltration (Medium)

Tool results (document text, task comments, IFC property values) flow straight into the model's context. A crafted document could instruct the model to call `report_feedback`, which posts to a (public) GitHub repo.

Existing mitigations: `report_feedback` is confirmation-gated (`confirmed: true`) and rejects content that looks like project/personal data.

**Action:** disable `report_feedback` in multi-tenant deployments (leave `DALUX_MCP_FEEDBACK_GITHUB_TOKEN` unset); keep it the only outbound-write tool; if you add an internal agent (see the multi-agent PRD), do **not** give that agent `report_feedback`.

## 4. Cache at rest (Low)

Downloads, derived artefacts and indexes are written unencrypted under `$TMPDIR/dalux-mcp` (or `DALUX_MCP_CACHE_DIR`). `mkdirSync` is called without a mode, so directories are typically `0755` — readable by other local users on a shared Linux host (`/tmp`). macOS `$TMPDIR` is per-user, so less exposed.

**Action:** create directories with `mode: 0o700`; in Docker mount a private volume for `DALUX_MCP_CACHE_DIR`; keep the stale-index pruning and consider pruning `files/` and `derived/` too.

## 5. OAuth token lifetime (Low)

`ACCESS_TOKEN_TTL_SECONDS = 90 days` (`src/oauth.ts:28`); tokens are in-memory only and revoking one requires a restart. The authorize step does not verify that the pasted API key actually works before issuing a token (not a leak — the key is checked on first use — but a UX/abuse point).

**Action:** shorten to hours/days with refresh tokens, add a revoke endpoint, validate the key with one Dalux call at `/authorize`.

## 6. Deployment hardening (Low / docs)

- Set `DALUX_MCP_TOKEN` whenever OAuth isn't needed; for a single-company deployment, also allowlist that company's base URL.
- Terminate TLS in front of the server (reverse proxy); keep `HOST=127.0.0.1` unless remote access is required.
- Rate-limit `/register`, `/authorize`, `/token` (unauthenticated endpoints; in-memory maps grow per client registration).
- Correct the README multi-tenant statement (see §1).

---

## Verified as sound

- **Credentials:** HTTP mode reads `X-Dalux-Base-Url`/`X-Dalux-Api-Key` per request; nothing is persisted. OAuth tokens are opaque random values (`randomBytes`), not JWTs embedding the key.
- **OAuth:** PKCE S256 mandatory, redirect URI must match a registered one and be `https://` (or localhost), auth codes expire after 60 s.
- **SSRF:** `validateDaluxBaseUrl` (`src/daluxUrl.ts`) enforces `https://` + `dalux.com` / `*.dalux.com`.
- **Bearer check:** `timingSafeEqual` (`src/http.ts:230`).
- **Download/model links:** 24 random bytes, single-use / time-limited, loopback-only listener.
- **Direct file reads:** `download_file`, `search_file_content`, `render_pdf_page` always call Dalux with the caller's key, so the shared `files/` cache is not a bypass on those paths.
- **IFC tools:** `assertReadable` guards every shared-cache hit.
- **No writes to Dalux:** `FileUploadApi` not reachable from tools; `ifc_edit_*` only writes local copies.
- **Logging:** discovery logging records client name/version and tool counts, not credentials.

## Ongoing practice

- Run `/security-review` on each branch before merge.
- Add the cross-tenant regression test from §1 to CI.
- Re-check this document when adding any tool that reads from a process-wide cache.
