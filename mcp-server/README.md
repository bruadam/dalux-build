# dalux-build-mcp

An [MCP](https://modelcontextprotocol.io) server exposing read-only [Dalux Build](https://www.dalux.com/) API access — files, folders, tasks, projects, forms, users, companies, test/inspection plans, work packages, version sets — plus file download, in-document search (PDF/Word/Excel) and cross-document search over a file area, as tools for an LLM (Claude Code, Claude Desktop, Cursor, or your own agent).

Built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`) and the [`dalux-build-api`](../javascript) client.

## Why read-only

Every structured-data tool wraps `list*`/`get*` Dalux Build API methods only — nothing that creates, updates, or deletes project data. `download_file`, `search_file_content`, `render_pdf_page` and the `*_file_area_index` tools write to (and delete from) a local cache directory, but that's a local, disposable side effect, not a mutation of anything in Dalux.

## Install

From the repo root (this is an npm workspace package):

```sh
npm install
npm run build --workspace=mcp-server
```

## Configuration

Reads the same environment variables as the rest of the Dalux Build clients:

| Variable | Required | Description |
| --- | --- | --- |
| `DALUX_BASE_URL` | yes | Your Dalux Build API base URL |
| `DALUX_API_KEY` | yes | Your company's X-API-KEY |
| `OPENAI_API_KEY` | no | Enables semantic (embedding-based) ranking in document search; without it, ranking falls back to BM25 |
| `DALUX_MCP_CACHE_DIR` | no | Where downloads and the ephemeral file-area/task indexes are cached (default `$TMPDIR/dalux-mcp`). Set it when the temp directory is small or wiped between restarts. Also used by the docs index if `DALUX_MCP_DOCS_DIR` is unset |
| `DALUX_MCP_DOCS_DIR` | no | Where the (persistent) docs-repo index is stored (default `~/.dalux-mcp/docs-index`) — separate from `DALUX_MCP_CACHE_DIR` because, unlike the other two indexes, this one is meant to survive restarts |
| `DOCS_GITHUB_TOKEN` (or `GITHUB_TOKEN`) | only for a private docs repo | Token `npm run docs:build` sends to the GitHub API — required to read a private repo, optional (but raises the rate limit) for a public one. Needs read access to the repo's contents; no other scope |
| `DOCS_GITHUB_USE_GH_CLI` | no | Set to `1` to have `npm run docs:build` fetch the docs repo via the local `gh` CLI's own login instead of a token — a dev-machine-only alternative to `DOCS_GITHUB_TOKEN`; ignored once a token is set |
| `DOCS_GITHUB_OWNER`, `DOCS_GITHUB_REPO`, `DOCS_GITHUB_REF`, `DOCS_GITHUB_PATH` | no | Which repo/branch/folder `docs:build`/`search_docs` index — this deployment's one pinned docs corpus. `ref` defaults to `main`, `path` to `docs` if unset — see [Docs-repo search](#docs-repo-search-laws-guidelines-standards-procedures) below |
| `DALUX_MCP_TOKEN` | HTTP transport only | Shared-secret bearer token clients must send as `Authorization: Bearer <token>` |
| `PORT` | HTTP transport only | Port to listen on (default `8080`) |
| `HOST` | HTTP transport only | Address to bind (default `127.0.0.1`; use `0.0.0.0` for Docker/remote — see below) |
| `PUBLIC_URL` | HTTP transport only, optional | Externally-reachable `https://` base URL of this deployment. Set it to enable OAuth for Claude.ai/ChatGPT custom connectors — see below |
| `DALUX_MCP_LOG_DISCOVERY` | HTTP transport only, optional | Set to `1` to log each client's `initialize` (client name/version, negotiated protocol version) and `tools/list` (tool count, `nextCursor`, payload size) to stderr. For diagnosing a host that shows fewer tools than the server registers — it distinguishes "served a short list" from "shortened a full list client-side". Logs no credentials |

A `.env` file in the working directory is picked up automatically (via the underlying `dalux-build-api` client).

## Running

**stdio** (default — for Claude Code, Claude Desktop, Cursor, or as a subprocess spawned by another agent):

```sh
node dist/cli.js
# or during development:
npm run dev
```

Example Claude Desktop config entry — **replace `args` with the real absolute path to your checkout's `mcp-server/dist/cli.js`** (e.g. `/Users/you/dalux-build/mcp-server/dist/cli.js`); the literal path below is a placeholder and will fail to connect if pasted as-is:

```json
{
  "mcpServers": {
    "dalux-build": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/cli.js"],
      "env": {
        "DALUX_BASE_URL": "https://<company>.dalux.com/api",
        "DALUX_API_KEY": "..."
      }
    }
  }
}
```

The `env` block is only needed if the host process doesn't run with this repo's root as its working directory (Claude Code does, so `.env` there is picked up automatically and `env` can usually be omitted — see above). If tools fail to connect, first check the registered command's path actually exists on disk (`claude mcp list`, or the equivalent in your MCP host) rather than a copy-pasted placeholder.

**streamable-HTTP** (for remote/cloud use):

```sh
node dist/cli.js --transport http --port 8080
```

Unlike stdio mode, HTTP mode does **not** read `DALUX_BASE_URL`/`DALUX_API_KEY` from the server's own environment. Instead every request must carry them as headers:

| Header | Description |
| --- | --- |
| `X-Dalux-Base-Url` | Your Dalux Build API base URL. Must be `https://` and resolve to `*.dalux.com`. |
| `X-Dalux-Api-Key` | Your company's X-API-KEY. |

That means the VM/container running this server never stores your Dalux credentials — they live only in the connecting client's own MCP config. Example remote-server entry (Claude Desktop, Claude Code, or any MCP host that supports custom headers on an HTTP server):

```json
{
  "mcpServers": {
    "dalux-build": {
      "type": "http",
      "url": "https://<your-vm-host>:8080/mcp",
      "headers": {
        "X-Dalux-Base-Url": "https://<company>.dalux.com/api",
        "X-Dalux-Api-Key": "..."
      }
    }
  }
}
```

The server builds (and caches) a Dalux API client per distinct credential pair it sees, so multiple clients/companies can share one deployment without cross-talk.

By default the server also only accepts requests whose Host/Origin claim `localhost` (protects a locally-run dev server from browser-based DNS-rebinding). Pass `--host 0.0.0.0` (or set `HOST=0.0.0.0`) for a real remote deployment — this switches off the localhost-only check, which is what the Docker image below does.

Optionally set `--token`/`DALUX_MCP_TOKEN` for an extra shared-secret gate (`Authorization: Bearer <token>`) in front of the credential headers above — useful if you want to keep the port from responding to arbitrary internet traffic even before it gets to checking Dalux credentials. It's not required for correctness: an attacker without valid Dalux credentials can't do anything useful through this server regardless.

### OAuth (Claude.ai / ChatGPT custom connectors, Linear Agent)

Claude.ai's "custom connector", ChatGPT's "Developer Mode" custom-app flow, and Linear's [custom MCP server](https://linear.app/docs/connect-mcp-servers) connection are all OAuth-only — they have no way to configure the `X-Dalux-*` headers above, only an authorization URL. Dalux Build itself has no OAuth of its own (just the static API key), so when `PUBLIC_URL`/`--public-url` is set, this server mounts a minimal OAuth 2.1 authorization server whose "login" step is a one-time browser form where you paste your existing Dalux Base URL and API key, in exchange for a per-user bearer token:

```sh
PUBLIC_URL=https://dalux-mcp.example.com node dist/cli.js --transport http --host 0.0.0.0
```

`PUBLIC_URL` must be `https://` — it's used to construct the OAuth issuer, authorization, token, and registration endpoint URLs, and can't be safely inferred from request headers behind a reverse proxy. Point the connector at `https://dalux-mcp.example.com/mcp` in Claude.ai (Customize > Connectors > Add custom connector), ChatGPT (Settings/Workspace settings > Apps > Create), or Linear (workspace Settings > Features > Agents/MCP, or an agent's personalization settings > Connect servers > + Custom URL, choosing "OAuth" > "Automatic"); the client self-registers (RFC 7591), redirects you to `/authorize` to paste your Dalux credentials, and from then on sends the issued token as `Authorization: Bearer <token>` — no different from the static-header flow under the hood, just filled in by the client instead of hand-edited into its MCP config. `/register` and `/token` send CORS headers and answer `OPTIONS` preflight requests, since Linear's "Automatic" flow runs registration and token exchange as `fetch` calls from the `linear.app` tab itself rather than from a backend — without CORS the browser blocks those requests before the flow ever reaches `/authorize`, and the "Connect" button silently does nothing.

This is fully additive: deployments that never set `PUBLIC_URL` behave exactly as before (static-header-only), and even with it set, clients that still send `X-Dalux-Base-Url`/`X-Dalux-Api-Key` headers directly keep working unchanged. Issued access tokens are opaque, server-side-only (never a JWT encoding the API key), and — like the per-credential client cache above — held in memory only: they don't survive a restart, and there's no revoke endpoint yet, so revoking one today means restarting the server.

## Tools

**Usage guide**: `get_skill` — this server's own bundled documentation, callable with no arguments; see below

**Files & folders**: `list_file_areas`, `get_file_area`, `list_folders`, `search_folders_by_name`, `get_folder`, `get_folder_by_path`, `get_folder_tree`, `list_files_in_folder`, `list_files`, `search_files_by_name`, `get_file`, `download_file`, `search_file_content`, `render_pdf_page`

**Cross-document search**: `build_file_area_index`, `search_file_area`, `list_file_area_indexes`, `drop_file_area_index`

**Tasks**: `list_project_tasks`, `search_tasks`, `get_task`, `list_task_changes`, `list_task_attachments`

**Cross-task search**: `build_task_index`, `search_task_index`, `list_task_indexes`, `drop_task_index`

**Docs-repo search** (laws, guidelines, standards, procedures — see below): `search_docs`, `list_docs_indexes` (index built server-side via `npm run docs:build`, not a tool)

**Projects**: `list_projects`, `get_project`, `find_project_by_name`, `search_projects_by_name`

**Forms**: `list_forms`, `get_form`

**Directory**: `list_project_users`, `get_user`, `list_project_companies`

**Quality**: `list_test_plans`, `list_test_plan_registrations`, `list_inspection_plans`

**Scheduling**: `list_work_packages`, `list_version_sets`

**3D viewer**: `view_model_3d` (renders an interactive MCP App in supporting hosts — see below; requires `PUBLIC_URL`)

List tools report `totalCount`/`truncated` and follow Dalux pagination to completion, returning all matching items. There is no extra MCP-side list cap.

`search_projects_by_name`, `search_files_by_name` and `search_folders_by_name` complement the exact-match `find_project_by_name` / exact-`folderId` lookups: they match a substring anywhere in the name, case-insensitively, and return every match rather than assuming there is exactly one — useful when only part of the name (or its casing) is known.

### Usage guide (`get_skill`)

The server bundles its own usage documentation and serves it over MCP, so any connecting client gets it — not just a Claude Code checkout of this repo with `.claude/skills/` on disk. `buildServer()` sets the server's `instructions` (delivered at `initialize`, before the model decides what to call first) to name `get_skill` explicitly as the recommended first call.

`get_skill(topic?)` (`src/tools/skills.ts`) returns markdown. Called with no arguments it returns the `overview` topic, which orients the model and lists the others:

| topic | covers |
| --- | --- |
| `overview` | tool categories, general usage principles, how errors are reported |
| `tasks` | `list_project_tasks` filtering — OData `$filter`/`$select`/`$orderby` syntax, field paths, worked examples |
| `documents` | `search_file_content`, `render_pdf_page`, cross-document search (`build_file_area_index`/`search_file_area`) |
| `files` | file areas/folders/files navigation, path-based lookups, projects, directory (users/companies) |
| `models_and_quality` | IFC model tools, the 3D viewer, forms, quality plans, scheduling |

The same five docs are also published as `dalux-build://skill/<topic>` resources (`text/markdown`), for hosts that surface MCP resources directly (Claude Code's resource tools, Claude Desktop's resource picker) rather than relying on the model to call a tool. Both paths read from the same content in `src/tools/skills.ts` — there is only one copy to keep in sync.

### Document search

`download_file` downloads a file into a local cache directory (`$TMPDIR/dalux-mcp/files/<fileId>/`) and gets its content to the chat three ways, not just a local path:

- **`downloadUrl`** — always present: a single-use, ~15-minute link (`downloadLinks.ts`) the user can click to fetch the file directly. Loopback-only (`http://127.0.0.1:<port>/...`), so it only works from the same machine this server runs on — the common case for a local Claude Desktop/Claude Code stdio setup, not a genuinely remote HTTP-transport deployment.
- **`image`** — for an actual image (PNG/JPEG/GIF/WEBP/BMP — not `.tiff`/`.svg`/CAD formats, which aren't things a vision model can decode), the bytes come back as a real MCP `image` content block, the same mechanism `render_pdf_page` already uses. Capped by `maxInlineBytes` (default 10 MB, hard ceiling 500 MB/524288000 bytes, `DALUX_MCP_MAX_INLINE_BYTES` for the server-wide default) — past that, no `image` field, `downloadUrl` still works.
- **`text`** — for PDF/Word (`.docx`/`.docm`)/Excel (`.xlsx`/`.xlsm`)/Markdown/HTML, the same extraction pipeline `search_file_content` uses runs automatically and its text comes back inline, since raw document bytes aren't something a model can read the way it can an image. Capped by `maxInlineChars` (default 200,000 characters, hard ceiling 2,000,000, `DALUX_MCP_MAX_INLINE_CHARS` for the server-wide default).

An MCP embedded-resource (`type: 'resource'`) content block would in principle be the spec-correct way to send arbitrary bytes back for any format, but at least one real MCP host this server runs under has no support for rendering it and hard-errors on any tool result that includes one — so this server never emits one; the local cache write plus `downloadUrl`/`image`/`text` above is what actually reaches the chat instead. The local cache write always happens regardless, since `search_file_content`/`render_pdf_page`/the index builders read from it. `download_task_attachment` behaves the same way.

`search_file_content` searches **one** document. It downloads (or reuses the cache), extracts the text, chunks it, and ranks the chunks against a natural-language query. Every match carries a location you can cite:

| Format | Extensions | Location reported | Notes |
| --- | --- | --- | --- |
| PDF | `.pdf` | `p. 12` | Includes drawings — their text layer holds the title block, room names, areas and annotations |
| Word | `.docx`, `.docm` | `§ 4 Payment › 4.2 Retention` | Paragraphs and table rows; headings tracked (including localised style names such as Danish `Overskrift1`); tracked deletions excluded |
| Excel | `.xlsx`, `.xlsm` | `Budget!rows 40–58` | Rows are rendered as `Description=Concrete C30/37 \| Qty=120`, and each chunk repeats the sheet name and header row so a passage is quantifiable on its own |
| Markdown | `.md`, `.markdown` | `§ 4 Payment › 4.2 Retention` | ATX headings (`#`..`######`) tracked the same way as Word; fenced code blocks kept as plain text, not treated as headings |
| HTML | `.html`, `.htm` | `§ 4 Payment › 4.2 Retention` | `h1`–`h6` tracked as headings; `<script>`/`<style>`/`<head>` content dropped; tags stripped, common entities decoded |

`search_pdf_content` still exists as a deprecated alias for the same handler, so prompts and clients that learned the old name keep working.

Anything else (`.dwg`, `.rvt`, `.ifc`, images, legacy `.doc`/`.xls`) reports which formats *are* readable instead of failing the call. A scanned or fully rasterised PDF has no text layer at all; rather than returning an empty result that reads like "no match", the tool reports `pagesWithoutText` and says so in `note`. There is no OCR.

### `render_pdf_page` (drawing rasterization)

`search_file_content` only sees a PDF's text layer — title blocks, room names, revision tables. It can't see the drawing itself: wall linework, dimension lines, hatching, symbols, anything that's geometry rather than text. `render_pdf_page(projectId, fileAreaId, fileId, page?, scale?)` downloads the file, rasterizes one page (default page 1, default scale 2 ≈ 144 dpi) with [pdfjs-dist](https://mozilla.github.io/pdf.js/) and [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas), and returns it as an inline image the model can actually look at — reading it is then whatever a multimodal model is good at (symbols, callouts, rough spatial checks), not something this server computes. `scale` is clamped to `[0.5, 4]` and reduced further so the longest edge never exceeds 2048px, so an A0 sheet at scale 4 doesn't turn into a multi-hundred-megapixel image. It only rasterizes PDFs; pointed at anything else, it reports that and where the file was downloaded, same as `search_file_content`.

### Cross-document search (temporary file-area index)

`search_file_content` answers "what does *this document* say about X". For "which documents say anything about X", build an index first:

```
build_file_area_index(projectId, fileAreaId, folderPath?)  ->  { indexId, filesInScope, totalChunks, complete, skipped, ... }
search_file_area(indexId | scope, query, topK?)            ->  [{ fileName, location, text, score }, ...]
list_file_area_indexes()                                   ->  what is currently cached, with size and freshness
drop_file_area_index(indexId)                              ->  delete one (nothing in Dalux is touched)
```

The index is a disposable directory under the cache root: per-document chunks plus, when `OPENAI_API_KEY` is set, their embeddings as raw `Float32`. Indexes untouched for a week are deleted on the next build. Retrieval is deliberately all that these tools do — they return cited passages, and the calling agent does the reasoning, which is what makes this usable from any MCP host without a second model API key.

Details worth knowing before pointing it at a large file area:

- **Scope** is (project, file area, optional folder subtree, extension filter). It hashes to a stable `indexId`, so re-running `build_file_area_index` with the same arguments reuses what is already on disk instead of re-downloading — you can address an index by scope in `search_file_area` and never handle the id yourself.
- **Incremental**: a file is re-downloaded only when its `contentHash`/revision changed; files that left the file area have their chunks dropped; files that fail to extract are recorded once and not retried until their revision changes.
- **Budgeted**: each call indexes at most `maxFiles` (250) files and stops after `timeBudgetSeconds` (120), so a large file area never blows the host's tool timeout. If the result says `complete: false`, call it again with the same arguments to continue where it left off.
- **Ranking**: cosine similarity over embeddings when `OPENAI_API_KEY` is set, BM25 otherwise. BM25 scores are absolute (`raw / (raw + 3)`), not normalised to the best hit, so the top result of a query nothing matches looks weak instead of scoring a misleading 1.0.
- **Cost**: with a key, indexing embeds every chunk once (`text-embedding-3-small`); a 250-document folder is a few million tokens of embeddings. Without one, indexing makes no API calls at all.

This is the TypeScript counterpart of the corpus-wide RAG agent in the Python package (`python/dalux_build/ai/`), which uses Chroma and LangChain and hosts its own LLM loop. Chunk size and overlap match (1000/150) so passages read the same through either path.

### Task search

`list_project_tasks` filters with an exact OData `$filter` expression (see `get_skill({ topic: "tasks" })`) — precise, but it needs the model to write correct OData and can only match the literal field it's pointed at. Two tools answer "which tasks are about X" without that:

`search_tasks(projectId, query, typeId?, filter?, includeChanges?, topK?)` is the ad-hoc, no-setup option: it fetches the project's tasks (optionally narrowed with `typeId`/`filter` first), renders each one's subject, type, status, custom fields and (if `includeChanges: true`) change-history text, ranks them against `query` (embeddings if `OPENAI_API_KEY` is set, BM25 otherwise — see `src/search/rank.ts`), and returns the best-matching tasks with a `score`. Good for a one-off question; it re-fetches and re-renders every task on every call.

For repeated searches over the same project, build an index instead — the task-side counterpart of `build_file_area_index`/`search_file_area`, combining each task with its change history into one searchable document per task:

```
build_task_index(projectId, typeId?, filter?)      ->  { indexId, taskCount, tasksIndexed, tasksReused, totalChunks, ... }
search_task_index(indexId | scope, query, topK?)    ->  [{ taskId, subject, location, text, score }, ...]
list_task_indexes()                                 ->  what is currently cached, with size and freshness
drop_task_index(indexId)                             ->  delete one (nothing in Dalux is touched)
```

Unlike the file-area index there is nothing to download, so a build always completes in one call (no `complete`/budget fields to poll). It's still incremental: each task's own fields plus its change history are hashed into a `revisionKey`, so re-running the build after a handful of edits only re-renders and re-embeds the tasks that actually changed — everything else is reused from disk. A `location` in a match like `entries 3-5` refers to the task's own rendered lines (its fields, then one line per change with a description), not a page.

### Docs-repo search (laws, guidelines, standards, procedures)

A project's file areas hold project-specific documents; a corpus of laws, guidelines, standards and procedures is usually *not* project-specific — the same fire code applies to every project a company runs. `search_docs` searches that kind of corpus, indexed straight from a GitHub repo — cited passages, no answer synthesis (like `build_file_area_index`/`search_file_area`), but with GitHub as the source instead of a Dalux file area, and pinned to **one** corpus per deployment rather than addressed per call — see [`bruadam/dalux-build-docs`](https://github.com/bruadam/dalux-build-docs) for the corpus this is built against (private; Danish building-code and standards content under `laws`/`guidelines`/`standards`/`procedures`-style folders):

```
search_docs(query, topK?, perDocLimit?, pathContains?) -> [{ path, location, text, score }, ...]
list_docs_indexes()                                     -> { indexes: [{ docCount, chunkCount, updatedAt, mode, ... }] }
```

**Building the index is deliberately not a tool call.** Indexing costs an OpenAI embedding call per chunk and can take minutes for a large corpus — both bad things to let a model trigger mid-conversation. Instead it's a server-side step:

```sh
cd mcp-server
npm run docs:build            # index (or incrementally refresh) the pinned corpus
npm run docs:build -- --refresh   # force re-extraction/re-embedding of every document
```

Run this whenever the docs repo changes, or as a deploy/rebuild step before restarting the server — not per session. `search_docs` only ever reads what the last `docs:build` wrote; if it errors saying the corpus isn't indexed, that means `docs:build` hasn't run on this server, not something to retry. `list_docs_indexes` is read-only and safe to call any time to check what's currently indexed and how fresh it is.

`owner`/`repo`/`ref`/`path` are **not** arguments anywhere in this — they only come from the `DOCS_GITHUB_OWNER`/`DOCS_GITHUB_REPO`/`DOCS_GITHUB_REF`/`DOCS_GITHUB_PATH` env vars (`ref` falls back to `main`, `path` to `docs`), so a deployment always searches the one corpus it was configured with; nothing (model or script) can point `search_docs` at an arbitrary repo. Fetching goes through the GitHub REST API (Git Trees API for the file listing, Contents API per file) — no local clone, no git binary needed on the host. (The lower-level `build_docs_index`/`search_docs_index`/`list_docs_indexes`/`drop_docs_index` functions `docs:build` and `search_docs` wrap still exist in `src/tools/docsIndex.ts` and take an explicit scope — useful for tests — but only `search_docs`/`list_docs_indexes` are registered as MCP tools.)

Details worth knowing:

- **Persistent**: unlike the file-area and task indexes (OS temp directory, gone on reboot), the docs index lives under `~/.dalux-mcp/docs-index` by default — survives a server restart, so `search_docs` doesn't have to wait on a fresh `docs:build` every session. Override the location with `DALUX_MCP_DOCS_DIR` (or `DALUX_MCP_CACHE_DIR`, shared with the other indexes).
- **Auth**: a private repo needs `DOCS_GITHUB_TOKEN` (or `GITHUB_TOKEN`) with read access to the repo's contents — required for private, optional (but raises the rate limit) for public. As a local-only alternative, set `DOCS_GITHUB_USE_GH_CLI=1` to shell out to the `gh` CLI instead, reusing whatever account it's already logged into (`gh auth login`) — no token ever touches this server's environment. Only works on a host with `gh` installed and authenticated (a dev machine, not a container); ignored once a token is set.
- **Incremental**: each entry's git blob SHA doubles as its revision key, so a document is only re-fetched when its content actually changed — no separate hashing needed, unlike the task index. Documents that left the repo have their chunks dropped; documents that fail to extract are recorded once and not retried until their SHA changes.
- **Formats**: anything `search_file_content`/`build_file_area_index` reads — `.md`, `.html`, `.pdf`, `.docx`, `.xlsx` and their variants (see the format table above). A repo can mix all of them freely; other extensions (images, `.DS_Store`, etc.) are skipped, not errored.
- **Budgeted**: `docs:build` loops calling the underlying build function (up to 2000 documents / 600s per pass) until the corpus is fully indexed, so one `npm run docs:build` normally finishes the whole corpus in one command even if it takes several passes internally.

### `view_model_3d` (3D IFC viewer)

`view_model_3d` renders an interactive 3D view of an `.ifc` file inline in the conversation, using [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) (`ui://` resources, stable since 2026-01-26) and the [ifclite](https://ifclite.dev/) embed viewer (`@ifc-lite/embed-sdk`). Supporting hosts — currently Claude.ai and Claude Desktop — render the tool's `ui://dalux-build/ifc-viewer` resource in a sandboxed iframe; the viewer inside it streams the model from a short-lived signed URL served by this same server.

This only works on the **HTTP transport with `PUBLIC_URL` set** (see [OAuth](#oauth-claudeai--chatgpt-custom-connectors) above) — the embed viewer needs a real `https://` URL it can fetch cross-origin, which stdio can't offer. Without `PUBLIC_URL`, the tool still appears in `tools/list` (so its presence doesn't depend on how the server happens to be deployed) but returns a message explaining to use `download_file` instead, rather than erroring.

Mechanics, if you're curious: calling the tool issues a random, in-memory, 15-minute ticket (`src/modelLinks.ts`) bound to the request's Dalux credentials and file, and returns `https://<PUBLIC_URL>/models/<ticket>` as `modelUrl` in `structuredContent`. `GET /models/<ticket>` (handled in `http.ts`, ahead of the localhost Host/Origin checks that guard the main `/mcp` endpoint, since this route carries its own auth and is fetched cross-origin from `embed.ifclite.com` by design) resolves the ticket, downloads (or reuses the cache for) the file, and streams it back with CORS scoped to `https://embed.ifclite.com` and `Range` support. The Dalux API key itself never reaches the browser. Selecting an element in the viewer reports its IFC properties back to the model via `ui/update-model-context`.

## Docker

Build from the repo root (the Dockerfile needs the sibling `javascript/` workspace package):

```sh
docker build -f mcp-server/Dockerfile -t dalux-build-mcp .
docker run --rm -p 8080:8080 dalux-build-mcp
```

No `-e DALUX_BASE_URL`/`-e DALUX_API_KEY` needed (or wanted) — the container never holds Dalux credentials, see the streamable-HTTP section above. The image always runs the HTTP transport (`HOST=0.0.0.0` by default so the port mapping works, `PORT=8080`). Connect an MCP client to `http://<host>:8080/mcp` sending `X-Dalux-Base-Url`/`X-Dalux-Api-Key` headers (and, if you set `DALUX_MCP_TOKEN` at `docker run` time, `Authorization: Bearer <DALUX_MCP_TOKEN>`).

For a VM deployment, put a reverse proxy (nginx/Caddy) with TLS in front of the container rather than exposing port 8080 directly — Dalux API keys will be flowing over this connection on every request. Set `-e PUBLIC_URL=https://<your-vm-host>` at `docker run` time (matching the reverse proxy's public HTTPS URL) to also enable the OAuth flow above for Claude.ai/ChatGPT connectors.

## Using it from the existing Python RAG agent

`python/dalux_build/ai/agent/graph.py` can load these tools via `langchain-mcp-adapters`, spawning this server as a stdio subprocess (see that file's `_build_dalux_api_tools()`). MCP's stdio transport is plain JSON-RPC over stdin/stdout, so the Python agent doesn't need to know the server is written in TypeScript.

## Development

```sh
npm run typecheck --workspace=mcp-server
npm test --workspace=mcp-server
npm run build --workspace=mcp-server
```
