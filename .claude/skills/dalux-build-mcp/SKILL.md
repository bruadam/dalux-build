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
- **Don't paginate yourself.** Every `list_*` tool already follows Dalux's bookmark pagination to completion
  server-side and returns `totalCount`/`returnedCount`/`truncated` on the result. There is no `bookmark` param to
  manage and no MCP-side page cap — if you find yourself passing a cursor back in, stop, that's not how these
  tools work.
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

## Filtering tasks: `list_project_tasks` and OData

`list_project_tasks(projectId, typeId?, filter?, select?, orderby?)` wraps `GET
/5.2/projects/{projectId}/tasks`, which speaks OData. The tool's parameters are named `filter`/`select`/`orderby`
**without** the `$` — a literal `$filter` property name fails Anthropic's tool-schema validation and silently
drops the whole tool — and are translated back to `$filter`/`$select`/`$orderby` before the HTTP call
(`mcp-server/src/tools/tasks.ts`).

**`typeId` vs `filter`:** `typeId` is shorthand that expands to `$filter=data/type/typeId eq '<typeId>'`
(quotes in the value are escaped for you). It's ignored the moment `filter` is also set — the two are not
merged. So: use `typeId` alone for "just tasks of this type"; the moment you need anything else too, drop
`typeId` and write the full condition, type check included, inside `filter` yourself.

### Field paths (under `data/`)

Confirmed by the published Dalux schema (`docs/official-api-docs/Dalux Build API.yaml`,
`ApiTaskGet`/`TaskTypeReference`/`WorkflowReference`):

| Path | Meaning |
| --- | --- |
| `data/taskId` | task ID |
| `data/subject` | title/subject text |
| `data/usage` | one of `task`, `approval`, `safetyissue`, `safetyobservation`, `goodpractice` |
| `data/type/typeId` | task type ID — what the `typeId` shorthand filters on |
| `data/type/name` | task type display name |
| `data/number` | task number, e.g. `"T-042"` |
| `data/created` | creation timestamp (ISO 8601 date-time) |
| `data/createdBy/userId` | creator's user ID |
| `data/workflow/name` | workflow/status name |

The **only** filter behaviour the official docs actually commit to is `typeId eq` on `data/type/typeId` — the
rest of the table is real schema, not confirmed filter support. Real task payloads commonly carry more fields
than this table (`deadline`, `status`, `assignedTo`, `currentResponsible`, `workpackageId`,
`userDefinedFields`, per the change-tracking schema in `javascript/src/models/tasks/index.ts`) — if you need to
filter on one of those, verify its exact key first (see "check the real shape" above) rather than guessing the
`data/...` path.

### Operators

Standard OData v4 syntax, prefixed with `data/`:

- Comparison: `eq`, `ne`, `gt`, `ge`, `lt`, `le`
- Logical: `and`, `or`, `not` — combine multiple conditions in one `filter` string
- String functions: `contains(data/subject,'text')`, `startswith(...)`, `endswith(...)`
- String literals: single-quoted; a literal `'` inside one is escaped as `''`
- Date literals: try a plain ISO string first (`data/created ge '2026-01-01T00:00:00Z'`); fall back to
  `datetime'2026-01-01T00:00:00Z'` if the plain form 400s — only `eq` on `typeId` is doc-guaranteed, so treat
  comparisons/date literals as "try it on a small project first," not settled syntax.

### Examples

```
# All safety issues
filter: "data/usage eq 'safetyissue'"

# A given task type, created on/after a date
filter: "data/type/typeId eq 'abc123' and data/created ge '2026-01-01T00:00:00Z'"

# Subject keyword search
filter: "contains(data/subject,'foundation')"

# Trim payload to just what you need when scanning many tasks
select: "taskId,subject,type,workflow"
orderby: "created desc"
```

### When a filter call fails

1. Re-read the `Error: ...` text the tool returned — it's the OData parser's own complaint, and usually names
   the exact clause it choked on.
2. Narrow to one condition at a time to isolate which clause is the problem.
3. If a field path genuinely isn't filterable server-side, fall back to fetching the (already fully paginated)
   unfiltered list and filtering client-side in the conversation — `list_project_tasks` returns everything in
   one structured result, so this is a normal fallback, not a hack.
