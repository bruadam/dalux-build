---
name: dalux-build-mcp
description: Use whenever calling any dalux-build MCP tool (mcp__dalux-build__*, mcp__Dalux__*, or mcp__Dalux-demo__* in this session — files, folders, tasks, projects, forms, directory, quality, scheduling, document search, 3D viewer) to browse or query a live Dalux Build project. Load this before calling list_project_tasks with a filter, or whenever a tool call is about to loop/re-fetch/guess at a field name instead of checking the shape first.
---

# Using the dalux-build MCP well

This server (`mcp-server/`, README at `mcp-server/README.md`) wraps the Dalux Build REST API as **read-only**
`list*`/`get*` tools — nothing here creates, updates or deletes project data. Full tool list and per-tool
details are in the README; this skill is about *using* the tools efficiently and correctly, not what each one
does.

**The server now also documents itself over MCP**, independent of this repo-local skill file: call the
`get_skill` tool (no arguments) for the overview, or `get_skill({ topic: "tasks" })` etc. for a specific area —
see `mcp-server/README.md#usage-guide-get_skill` and `mcp-server/src/tools/skills.ts`. That copy works from any
MCP client, not just a Claude Code session with this repo checked out, so treat it as the canonical, live
version of the guidance below; this file exists so Claude Code sessions working in this repo get the same
guidance without an extra tool round-trip.

## General principles

- **Resolve names to IDs once, then reuse the ID.** `find_project_by_name` / `list_projects` for projects;
  `get_folder_by_path(projectId, fileAreaId, "Files/4_Design/C07_Geometry")` resolves a folder path directly —
  prefer it over walking `list_folders` yourself. `get_folder_tree` is for browsing/orientation (folders only,
  no files), not for finding one known folder.
- **Page with `offset`, not Dalux bookmarks.** Every `list_*` tool follows Dalux's bookmark pagination to completion
  server-side, then returns one page: `limit` (default 50, max 200) and `offset`, with `totalCount`/`returnedCount`/
  `truncated` and, when more remain, `nextOffset` to pass as the next `offset`. Prefer narrowing the query (filters,
  `search_*_by_name`) over walking many pages.
- **List items are lean by default.** `list_files`/`list_files_in_folder`/`search_files_by_name` and
  `list_project_tasks` (without `select`) return only the key fields; pass `fields: [...]` (or `["*"]`) for more, or
  `get_file`/`get_task` for one full item. `search_tasks` matches carry id/number/subject/type/status/snippet only.
- **Check the real shape before trusting a field name.** Task/task-change/attachment objects are intentionally
  loose (`extra`/passthrough on the Dalux side — task *type* determines the rest of the schema). Before filtering,
  selecting, or reasoning about a field that isn't in the tables below, call `get_task` on one real task or run
  `list_project_tasks` unfiltered on a small project and read the actual keys back. Don't assume a field exists
  because it sounds plausible.
- **Search vs. index, pick the narrower one.** `search_file_content` (alias `search_pdf_content`) answers "what
  does *this one document* say" — pass a specific `fileId`. `build_file_area_index` +
  `search_file_area` answers "which documents across this file area/folder say anything about X" — build once
  (re-running with the same scope reuses the on-disk index and only re-downloads changed files), then query it
  as many times as needed. Don't build a whole-file-area index to answer a one-document question.
- **`render_pdf_page` costs image tokens; `search_file_content` doesn't.** Only reach for rasterizing a page when
  the answer is in the drawing's geometry (linework, hatching, symbols) rather than its text layer — try the text
  search first.
- **`download_file` returns a local path, not bytes.** Pass that path along (e.g. to a further shell/analysis
  step) rather than trying to read a large file's content back into the conversation.
- **`view_model_3d` needs the HTTP transport with `PUBLIC_URL` set.** On stdio (the common Claude Desktop/Claude
  Code setup) it still appears in the tool list but replies with instructions to use `download_file` instead —
  that's expected, not a bug, if you see it happen.
- If a call errors, the tool returns `Error: <message>` as its content (not a thrown exception the host hides) —
  read that message; for OData calls it's usually the parser pointing at the exact bad token.

## Filtering tasks: `list_project_tasks`, OData and `conditions`

The full guide is the server's own `get_skill({ topic: "tasks" })`. The short version:

- `filter` (sent to Dalux as `$filter`) accepts exactly one shape: `data/type/typeId eq '<id>'`. No `and`/`or`, no
  other operators, no other fields; anything else fails with "Parameter validation failed for OData query".
  `typeId` is shorthand for that filter and is ignored when `filter` is set.
- Use `conditions` for every other filter. They run server-side after fetching, ANDed together, and `field` is a
  dot path into the task JSON the tool returns (not an OData path):

```
conditions: [
  {"field": "created", "op": "ge", "value": "2026-08-01T00:00:00Z"},
  {"field": "workflow.name", "op": "contains", "value": "open"}
]
```

- Task types carry different fields: read one real task with `get_task` before filtering on a field you have not
  seen.
