# dalux-build-mcp

An [MCP](https://modelcontextprotocol.io) server exposing read-only [Dalux Build](https://www.dalux.com/) API access — files, folders, tasks, projects, forms, users, companies, test/inspection plans, work packages, version sets — plus file download and lightweight PDF search, as tools for an LLM (Claude Code, Claude Desktop, Cursor, or your own agent).

Built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`) and the [`dalux-build-api`](../javascript) client.

## Why read-only

All 26 structured-data tools wrap `list*`/`get*` Dalux Build API methods only — nothing that creates, updates, or deletes project data. `download_file` and `search_pdf_content` write to a local cache directory, but that's a local, disposable side effect, not a mutation of anything in Dalux.

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
| `OPENAI_API_KEY` | no | Enables semantic (embedding-based) ranking in `search_pdf_content`; without it, the tool falls back to keyword matching |
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

### OAuth (Claude.ai / ChatGPT custom connectors)

Claude.ai's "custom connector" and ChatGPT's "Developer Mode" custom-app flows are both OAuth-only — they have no way to configure the `X-Dalux-*` headers above, only an authorization URL. Dalux Build itself has no OAuth of its own (just the static API key), so when `PUBLIC_URL`/`--public-url` is set, this server mounts a minimal OAuth 2.1 authorization server whose "login" step is a one-time browser form where you paste your existing Dalux Base URL and API key, in exchange for a per-user bearer token:

```sh
PUBLIC_URL=https://dalux-mcp.example.com node dist/cli.js --transport http --host 0.0.0.0
```

`PUBLIC_URL` must be `https://` — it's used to construct the OAuth issuer, authorization, token, and registration endpoint URLs, and can't be safely inferred from request headers behind a reverse proxy. Point the connector at `https://dalux-mcp.example.com/mcp` in Claude.ai (Customize > Connectors > Add custom connector) or ChatGPT (Settings/Workspace settings > Apps > Create); the client self-registers (RFC 7591), redirects you to `/authorize` to paste your Dalux credentials, and from then on sends the issued token as `Authorization: Bearer <token>` — no different from the static-header flow under the hood, just filled in by the client instead of hand-edited into its MCP config.

This is fully additive: deployments that never set `PUBLIC_URL` behave exactly as before (static-header-only), and even with it set, clients that still send `X-Dalux-Base-Url`/`X-Dalux-Api-Key` headers directly keep working unchanged. Issued access tokens are opaque, server-side-only (never a JWT encoding the API key), and — like the per-credential client cache above — held in memory only: they don't survive a restart, and there's no revoke endpoint yet, so revoking one today means restarting the server.

## Tools

**Files & folders**: `list_file_areas`, `get_file_area`, `list_folders`, `get_folder`, `get_folder_by_path`, `get_folder_tree`, `list_files_in_folder`, `list_files`, `get_file`, `download_file`, `search_pdf_content`

**Tasks**: `list_project_tasks`, `get_task`, `list_task_changes`, `list_task_attachments`

**Projects**: `list_projects`, `get_project`, `find_project_by_name`

**Forms**: `list_forms`, `get_form`

**Directory**: `list_project_users`, `get_user`, `list_project_companies`

**Quality**: `list_test_plans`, `list_test_plan_registrations`, `list_inspection_plans`

**Scheduling**: `list_work_packages`, `list_version_sets`

Every list tool accepts `limit`/`offset` (default `limit=50`, max `200`) and reports `totalCount`/`truncated` so a caller knows when to narrow its query rather than blindly paginate — the underlying `dalux-build-api` methods already page through the full result set, which can be thousands of items.

### `download_file` / `search_pdf_content`

`download_file` downloads a file into a local cache directory (`$TMPDIR/dalux-mcp/files/<fileId>/`) and returns the local path — not raw bytes, which would blow an LLM's context for anything but a tiny file.

`search_pdf_content` downloads (or reuses the cache), extracts text page-by-page, chunks it, and ranks chunks against a natural-language query — using OpenAI embeddings for real semantic search if `OPENAI_API_KEY` is set, otherwise a keyword-overlap fallback that needs no extra config. This is a lightweight, **single-file** complement to the corpus-wide, multi-document RAG agent in the Python package (`python/dalux_build/ai/`) — not a replacement for it.

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
