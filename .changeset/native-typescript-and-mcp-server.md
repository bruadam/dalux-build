---
"dalux-build-api": minor
---

Rewrite the JavaScript client in native TypeScript, and add a new MCP server package.

## What's New

- `javascript/` (`dalux-build-api`) is now native TypeScript, built with `tsup` (dual `.d.ts` generation via `tsc`). Public API, method signatures, and runtime behavior — bookmark pagination (`getAllX`), path/name resolution (`getFolderByPath`, `getFolderByName`, `resolveFileAreaByName`), zod-validated responses, error classes — are unchanged; this is a typing/tooling upgrade, not a breaking change.
- New `mcp-server` package (`dalux-build-mcp`, private, not published to npm): an MCP server built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`), exposing 28 read-only tools over Dalux Build data (file areas/folders/files, tasks, projects, forms, users/companies, test/inspection plans, work packages, version sets) plus `download_file` and `search_pdf_content` (lightweight per-file PDF search, semantic via `OPENAI_API_KEY` or keyword fallback). Supports stdio (Claude Code/Desktop/Cursor) and streamable-HTTP (bearer-token gated) transports, and ships a `Dockerfile` for remote deployment.
- `python/dalux_build/ai/agent/graph.py`'s deep agent now also loads these Dalux API tools via `langchain-mcp-adapters`, spawning the Node MCP server as a stdio subprocess alongside its existing document-retrieval tool — silently skipped if the server hasn't been built, same as the agent's other optional tool groups.
