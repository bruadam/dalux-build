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
| `DALUX_MCP_CACHE_DIR` | no | Where downloads and search indexes are cached (default `$TMPDIR/dalux-mcp`). Set it when the temp directory is small or wiped between restarts |
| `DALUX_MCP_TOKEN` | HTTP transport only | Shared-secret bearer token clients must send as `Authorization: Bearer <token>` |
| `PORT` | HTTP transport only | Port to listen on (default `8080`) |
| `HOST` | HTTP transport only | Address to bind (default `127.0.0.1`; use `0.0.0.0` for Docker/remote — see below) |
| `PUBLIC_URL` | HTTP transport only, optional | Externally-reachable `https://` base URL of this deployment. Set it to enable OAuth for Claude.ai/ChatGPT custom connectors — see below |

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

**Files & folders**: `list_file_areas`, `get_file_area`, `list_folders`, `get_folder`, `get_folder_by_path`, `get_folder_tree`, `list_files_in_folder`, `list_files`, `get_file`, `download_file`, `search_file_content`, `render_pdf_page`

**Cross-document search**: `build_file_area_index`, `search_file_area`, `list_file_area_indexes`, `drop_file_area_index`

**Tasks**: `list_project_tasks`, `get_task`, `list_task_changes`, `list_task_attachments`

**Projects**: `list_projects`, `get_project`, `find_project_by_name`

**Forms**: `list_forms`, `get_form`

**Directory**: `list_project_users`, `get_user`, `list_project_companies`

**Quality**: `list_test_plans`, `list_test_plan_registrations`, `list_inspection_plans`

**Scheduling**: `list_work_packages`, `list_version_sets`

**3D viewer**: `view_model_3d` (renders an interactive MCP App in supporting hosts — see below; requires `PUBLIC_URL`)

List tools report `totalCount`/`truncated` and follow Dalux pagination to completion, returning all matching items. There is no extra MCP-side list cap.

### Document search

`download_file` downloads a file into a local cache directory (`$TMPDIR/dalux-mcp/files/<fileId>/`) and returns the local path — not raw bytes, which would blow an LLM's context for anything but a tiny file.

`search_file_content` searches **one** document. It downloads (or reuses the cache), extracts the text, chunks it, and ranks the chunks against a natural-language query. Every match carries a location you can cite:

| Format | Extensions | Location reported | Notes |
| --- | --- | --- | --- |
| PDF | `.pdf` | `p. 12` | Includes drawings — their text layer holds the title block, room names, areas and annotations |
| Word | `.docx`, `.docm` | `§ 4 Payment › 4.2 Retention` | Paragraphs and table rows; headings tracked (including localised style names such as Danish `Overskrift1`); tracked deletions excluded |
| Excel | `.xlsx`, `.xlsm` | `Budget!rows 40–58` | Rows are rendered as `Description=Concrete C30/37 \| Qty=120`, and each chunk repeats the sheet name and header row so a passage is quantifiable on its own |

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
