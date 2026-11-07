import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { BUNDLED_SKILLS } from './skillsBundle.generated';

/**
 * Self-hosted usage documentation ("skills"), served over MCP itself so any
 * connecting client gets it — not just Claude Code sessions that happen to
 * have this repo's `.claude/skills/` checked out. Two ways in, same content:
 *
 *   - `get_skill` tool: always visible in `tools/list`, callable with no
 *     arguments, works on every MCP host regardless of resource support.
 *     This is the one to point a fresh agent at as its first call.
 *   - `dalux-build://skill/<topic>` resources: for hosts that surface
 *     resources directly (Claude Code's resource tools, Claude Desktop's
 *     resource picker, etc).
 *
 * `buildServer()` sets `instructions` to name `get_skill` explicitly, since
 * that's the one guarantee across hosts: instructions text is delivered at
 * `initialize`, before the model has decided what to call first.
 */

export const SKILL_TOPICS = ['overview', 'tasks', 'documents', 'files', 'models_and_quality'] as const;
export type SkillTopic = (typeof SKILL_TOPICS)[number];

interface SkillDoc {
  title: string;
  content: string;
}

const OVERVIEW: SkillDoc = {
  title: 'dalux-build MCP — overview',
  content: `# dalux-build MCP — overview

This server wraps the Dalux Build REST API (construction project management: files/BIM, tasks, forms,
inspections, work packages, users, companies, test/quality plans) as **read-only** tools for an LLM. Every
structured-data tool wraps a \`list*\`/\`get*\` Dalux endpoint — nothing here creates, updates, or deletes anything
in Dalux. \`download_file\`, \`search_file_content\`, \`render_pdf_page\`, and the \`*_file_area_index\` tools do write
to a local cache directory, but that's a disposable local side effect, not a mutation of project data. The
\`ifc_edit_*\` tools are the one group that edits *model content* — and they do it on a private in-process copy,
saving a **new local .ifc** the user uploads to Dalux themselves if they want to; see \`models_and_quality\`.

## Read this first, then drill in

Call \`get_skill\` again with one of these topics for the full doc on that area — this overview only orients you:

| topic | covers |
| --- | --- |
| \`tasks\` | \`list_project_tasks\` filtering — OData \`$filter\`/\`$select\`/\`$orderby\` syntax, field paths, examples |
| \`documents\` | \`search_file_content\`, \`render_pdf_page\`, cross-document search (\`build_file_area_index\`/\`search_file_area\`), and docs-repo search over GitHub (\`search_docs\`/\`list_docs_indexes\`) |
| \`files\` | Navigating file areas/folders/files, path-based lookups, projects, directory (users/companies) |
| \`models_and_quality\` | IFC model tools (incl. \`ifc_diff\` and the \`ifc_edit_*\` group), the 3D viewer, forms, quality plans, scheduling |

## Principles that apply everywhere

- **Resolve names to IDs once, then reuse the ID.** \`find_project_by_name\`/\`list_projects\` for projects;
  \`get_folder_by_path(projectId, fileAreaId, "Files/4_Design/C07_Geometry")\` resolves a folder path directly —
  prefer it over walking \`list_folders\` yourself just to find one known folder. When only part of a name (or its
  casing) is known, \`search_projects_by_name\`/\`search_files_by_name\`/\`search_folders_by_name\` do a
  case-insensitive substring match and return every hit, rather than assuming there's exactly one.
- **Don't paginate yourself.** Every \`list_*\` tool already follows Dalux's bookmark pagination to completion
  server-side and reports \`totalCount\`/\`returnedCount\`/\`truncated\` on the result. There's no bookmark/cursor
  parameter to manage and no extra MCP-side page cap.
- **Task (and task-change/attachment) objects are intentionally loose.** Task *type* (issue, approval, safety
  observation, good practice, …) determines the rest of the schema, so don't assume a field exists because it
  sounds plausible — call \`get_task\` on one real task, or run \`list_project_tasks\` unfiltered on a small
  project, and read back the actual keys before filtering or reasoning about a field not documented in the
  \`tasks\` topic.
- **Errors come back as tool content, not a protocol exception.** A failed call returns
  \`{ content: [{ type: "text", text: "Error: <message>" }], isError: true }\` — read that message; for OData
  calls it's usually the parser naming the exact bad token.
- **Prefer the narrower tool for the question you actually have.** "What does this one document say" is
  \`search_file_content\`. "Which documents across this file area say anything about X" is
  \`build_file_area_index\` + \`search_file_area\`. "I need to see the drawing's linework, not its text" is
  \`render_pdf_page\` (costs image tokens; try text search first). See the \`documents\` topic for the full
  breakdown.
`,
};

const TASKS: SkillDoc = {
  title: 'dalux-build MCP — filtering tasks with OData',
  content: `# Filtering tasks: \`list_project_tasks\` and OData

\`list_project_tasks(projectId, typeId?, filter?, select?, orderby?)\` wraps \`GET
/5.2/projects/{projectId}/tasks\`, which speaks OData. The tool's parameters are named \`filter\`/\`select\`/\`orderby\`
**without** the \`$\` — a literal \`$filter\` property name fails strict tool-schema validation on some hosts and can
silently drop the whole tool — and are translated back to \`$filter\`/\`$select\`/\`$orderby\` before the HTTP call.

## \`typeId\` vs. \`filter\`

\`typeId\` is shorthand that expands to \`$filter=data/type/typeId eq '<typeId>'\` (a literal \`'\` in the value is
escaped to \`''\` for you). **It is ignored the moment \`filter\` is also set — the two are not merged.** Use
\`typeId\` alone for "just tasks of this type"; the moment you need anything else too, drop \`typeId\` and write the
type condition inside \`filter\` yourself, combined with \`and\`.

## Field paths (under \`data/\`)

Confirmed by the published Dalux Build API schema (\`ApiTaskGet\`/\`TaskTypeReference\`/\`WorkflowReference\`):

| Path | Meaning |
| --- | --- |
| \`data/taskId\` | task ID |
| \`data/subject\` | title/subject text |
| \`data/usage\` | one of \`task\`, \`approval\`, \`safetyissue\`, \`safetyobservation\`, \`goodpractice\` |
| \`data/type/typeId\` | task type ID — what the \`typeId\` shorthand filters on |
| \`data/type/name\` | task type display name |
| \`data/number\` | task number, e.g. \`"T-042"\` |
| \`data/created\` | creation timestamp (ISO 8601 date-time) |
| \`data/createdBy/userId\` | creator's user ID |
| \`data/workflow/name\` | workflow/status name |

**Only \`typeId eq\` on \`data/type/typeId\` is officially documented filter behaviour** — the rest of the table
above is real schema, not a confirmed-filterable guarantee. Real task payloads commonly carry more fields than
this table (\`deadline\`, \`status\`, \`assignedTo\`, \`currentResponsible\`, \`workpackageId\`, \`userDefinedFields\`,
per the task-change tracking schema). If you need to filter on one of those, verify the exact key first — call
\`get_task\` on one real task, or run \`list_project_tasks\` unfiltered on a small project/type — rather than
guessing the \`data/...\` path from the field's name alone.

## Operators

Standard OData v4 syntax, every path prefixed with \`data/\`:

- Comparison: \`eq\`, \`ne\`, \`gt\`, \`ge\`, \`lt\`, \`le\`
- Logical: \`and\`, \`or\`, \`not\` — combine multiple conditions in one \`filter\` string
- String functions: \`contains(data/subject,'text')\`, \`startswith(...)\`, \`endswith(...)\`
- String literals: single-quoted; a literal \`'\` inside one is escaped as \`''\`
- Date literals: try a plain ISO string first (\`data/created ge '2026-01-01T00:00:00Z'\`); fall back to
  \`datetime'2026-01-01T00:00:00Z'\` if the plain form 400s

Treat everything past \`eq\` on \`typeId\` as "try it on a small project first, then trust it" rather than settled
syntax — it isn't spelled out in the published API docs, only exercised in practice.

## Examples

\`\`\`
# All safety issues
filter: "data/usage eq 'safetyissue'"

# A given task type, created on/after a date
filter: "data/type/typeId eq 'abc123' and data/created ge '2026-01-01T00:00:00Z'"

# Subject keyword search
filter: "contains(data/subject,'foundation')"

# Trim payload to just what's needed when scanning many tasks
select: "taskId,subject,type,workflow"
orderby: "created desc"
\`\`\`

## When a filter call fails

1. Re-read the \`Error: ...\` text the tool returned — it's the OData parser's own complaint, and usually names
   the exact clause it choked on.
2. Narrow to one condition at a time to isolate which clause is the problem.
3. If a field genuinely isn't filterable server-side, fall back to the (already fully paginated) unfiltered list
   and filter client-side in the conversation — \`list_project_tasks\` returns everything in one structured
   result, so this is a normal fallback, not a hack.

## The rest of the task surface

- \`get_task(projectId, taskId)\` — one task, full detail.
- \`list_task_changes(projectId, updatedAfter?)\` — incremental change feed; pass an ISO timestamp to avoid
  re-reading history you've already seen.
- \`list_task_attachments(projectId, updatedAfter?)\` — same incremental shape, for attachments.
- \`view_tasks_timeline(projectId, taskIds)\` — renders a Gantt-style lifecycle chart for a specific set of task
  IDs (pick them from \`list_project_tasks\`/\`get_task\` first) as an interactive MCP App, in hosts that support
  it.

## Keyword/content search, instead of writing OData

\`contains(data/subject, '...')\` above only matches the subject field, exactly, server-side. Two tools rank tasks
by relevance across more of their content instead, no OData required:

- \`search_tasks(projectId, query, typeId?, filter?, includeChanges?, topK?)\` — ad hoc, no setup: fetches the
  project's tasks (optionally narrowed with \`typeId\`/\`filter\` first), ranks them against \`query\` by BM25 (or
  embeddings if the server has \`MISTRAL_API_KEY\` set) over subject, type, status, description and custom fields,
  and returns the best matches with a \`score\`. Pass \`includeChanges: true\` to also match against each task's
  change-history text — costs one extra API call to fetch every change on the project.
- \`build_task_index(projectId, typeId?, filter?)\` + \`search_task_index(indexId | scope, query, topK?)\` — for
  repeated searches over the same project. Combines each task with its change history into one searchable
  document, same shape as the file-area index (\`build_file_area_index\`/\`search_file_area\` in the \`documents\`
  topic) but with nothing to download, so a build always finishes in one call. Incremental: a task whose fields
  and change history are unchanged since the last build is skipped. \`list_task_indexes\`/\`drop_task_index\` manage
  what's cached, same as the file-area index tools.
`,
};

const DOCUMENTS: SkillDoc = {
  title: 'dalux-build MCP — document search and rendering',
  content: `# Document search and rendering

## \`search_file_content\` — search one document

Downloads (or reuses the cache for) **one** file, extracts its text, chunks it, and ranks the chunks against a
natural-language query. Every match carries a citable location:

| Format | Extensions | Location reported |
| --- | --- | --- |
| PDF | \`.pdf\` | \`p. 12\` (includes drawings — their text layer holds title blocks, room names, areas, annotations) |
| Word | \`.docx\`, \`.docm\` | \`§ 4 Payment › 4.2 Retention\` (headings tracked, including localised style names) |
| Excel | \`.xlsx\`, \`.xlsm\` | \`Budget!rows 40–58\` (each chunk repeats the sheet name and header row) |

Anything else (\`.dwg\`, \`.rvt\`, \`.ifc\`, images, legacy \`.doc\`/\`.xls\`) reports which formats *are* readable
instead of failing. A scanned/rasterised PDF has no text layer at all — rather than an empty result that reads
like "no match", the tool reports \`pagesWithoutText\` and says so in \`note\`. There is no OCR.

\`search_pdf_content\` still exists as a deprecated alias for the same handler (it now reads Word/Excel too) —
prompts that learned the old name keep working, but prefer \`search_file_content\` going forward.

## \`render_pdf_page\` — see the drawing itself

\`search_file_content\` only sees a PDF's text layer. It can't see wall linework, dimension lines, hatching, or
symbols — geometry, not text. \`render_pdf_page(projectId, fileAreaId, fileId, page?, scale?)\` rasterizes one
page (default page 1, default scale 2 ≈ 144 dpi) and returns it as an inline image. \`scale\` is clamped to
\`[0.5, 4]\` and reduced further so the longest edge never exceeds 2048px — this costs real image tokens, so try
\`search_file_content\` first and only reach for this when the answer is genuinely in the drawing's geometry, not
its title block or annotations.

## Cross-document search: \`build_file_area_index\` / \`search_file_area\`

\`search_file_content\` answers "what does *this document* say about X". For "which documents say anything about
X", build a temporary index first:

\`\`\`
build_file_area_index(projectId, fileAreaId, folderPath?)  ->  { indexId, filesInScope, totalChunks, complete, ... }
search_file_area(indexId | scope, query, topK?)            ->  [{ fileName, location, text, score }, ...]
list_file_area_indexes()                                   ->  what is currently cached, with size and freshness
drop_file_area_index(indexId)                               ->  delete one (nothing in Dalux is touched)
\`\`\`

Details worth knowing before pointing this at a large file area:

- **Scope** is (project, file area, optional folder subtree, extension filter) — it hashes to a stable
  \`indexId\`, so re-running \`build_file_area_index\` with the same arguments reuses what's already on disk
  instead of re-downloading. You can address an index by scope in \`search_file_area\` and never handle the id
  yourself.
- **Incremental**: a file is re-downloaded only when its revision changed; files that left the file area have
  their chunks dropped; files that fail to extract are recorded once and not retried until their revision
  changes.
- **Budgeted**: each call indexes at most 250 files and stops after ~120 seconds, so a large file area never
  blows a host's tool timeout. If the result says \`complete: false\`, call it again with the *same* arguments to
  continue where it left off — don't restart with different arguments mid-index.
- **Ranking**: cosine similarity over embeddings when the server has an embeddings key configured, BM25
  otherwise — either way scores are meant to be compared within one result set, not across separate calls.

Indexes untouched for a week are deleted automatically on the next build.

## Docs-repo search: \`search_docs\` / \`list_docs_indexes\`

Different source and use case from the above: a Dalux file area holds project-specific documents, but laws,
guidelines, standards and procedures are usually shared across every project — kept in one GitHub repo this
deployment is pinned to (via \`DOCS_GITHUB_OWNER\`/\`DOCS_GITHUB_REPO\`/\`DOCS_GITHUB_REF\`/\`DOCS_GITHUB_PATH\`), not
addressed per call the way file-area and task indexes are:

\`\`\`
search_docs(query, topK?, pathContains?) ->  [{ path, location, text, score }, ...]
list_docs_indexes()                      ->  { indexes: [{ docCount, chunkCount, updatedAt, mode, ... }] }
\`\`\`

Unlike the file-area and task indexes, this one **persists across server restarts** and is **never built by a tool
call** — it's one corpus shared by every session, not scoped to whatever project is currently open, and indexing
costs an embedding call per chunk plus can take minutes for a large corpus, both bad things to let a model trigger
mid-conversation. It's built out-of-band, server-side, with \`npm run docs:build\` (see
\`mcp-server/scripts/build-docs-index.ts\`) — a deploy/rebuild step, not a chat action. If \`search_docs\` errors
saying the corpus isn't indexed yet, that's telling you \`docs:build\` hasn't run on this server, not something to
retry. \`list_docs_indexes\` is read-only and safe to call any time to check what's currently indexed and how fresh
it is. A private repo needs \`DOCS_GITHUB_TOKEN\` (or \`GITHUB_TOKEN\`, or a \`gh\`-CLI login with
\`DOCS_GITHUB_USE_GH_CLI=1\`) set wherever \`docs:build\` runs. Each document's git blob SHA doubles as its revision
key, so re-running \`docs:build\` after editing a few files only re-indexes those. Reads the same formats as
\`search_file_content\` (\`.md\`, \`.html\`, \`.pdf\`, \`.docx\`, \`.xlsx\`).

## Cross-document consistency: \`check_document_consistency\`

Finds statements in *different* documents that contradict each other — a door schedule says D-101 is EI60 while
the specification says EI30, the tender letter's handover date differs from the time schedule, a BoQ quantity
differs from the description, two documents cite different editions of DS/EN 1992-1-1, or a drawing is
referenced with different revisions. Reads PDF, Word, Excel and CSV (\`;\`-separated Danish exports included);
IFC is out of scope. Read-only towards Dalux: the report lives in the server's local cache.

\`\`\`
check_document_consistency(projectId, fileAreaId, folderPath?, fileIds?, extensions?, focus?, maxFiles?, timeBudgetSeconds?, useModel?)
    -> { reportId, complete, filesInScope, filesAnalyzed, skipped, findingsCount, bySeverity, topFindings, warnings }
list_inconsistencies(reportId, severity?, type?, fileId?, offset?, limit?)  ->  { total, findings }
export_inconsistency_report(reportId, format: 'xlsx' | 'docx' | 'md')      ->  { fileName, filePath, downloadUrl, findingsCount }
list_consistency_reports() / drop_consistency_report(reportId)
\`\`\`

- **Workflow**: run \`check_document_consistency\` on a folder (e.g. the tender folder); while \`complete\` is
  false, call it again with the *same* arguments. Then page through \`list_inconsistencies\` (high severity first)
  and, if the user wants a document, \`export_inconsistency_report\` and share the \`downloadUrl\`.
- **Findings**: each has a type (\`value_conflict\`, \`quantity_conflict\`, \`date_conflict\`,
  \`reference_conflict\`, \`revision_conflict\`, \`other\`), a severity (fire, structural, deadline and money
  conflicts are high) and at least two statements from different files, each with file, location and verbatim
  quote. Values are compared after normalisation, so \`EI 60\`/\`EI60\`, \`1.200 mm\`/\`1,2 m\` and
  \`01-03-2027\`/\`1. marts 2027\` agree.
- **Verdicts**: with \`MISTRAL_API_KEY\` set (and \`useModel\` not false), Mistral also extracts facts the
  patterns miss and judges each finding: false alarms are dropped and the rest become \`confirmed\` with an
  explanation and a precedence note. Without a key, findings stay \`candidate\` — check each one against its
  quotes yourself, using the \`document-consistency-review\` and \`danish-construction-contracts\` skills, before
  presenting it as a conflict.
- **Incremental**: facts are kept per file revision, so a later call only re-reads changed files. Reports untouched
  for a week are deleted automatically.
`,
};

const FILES: SkillDoc = {
  title: 'dalux-build MCP — files, folders, projects, directory',
  content: `# Files, folders, projects, directory

## Finding a project

\`find_project_by_name\` for the exact display name; \`search_projects_by_name\` for a case-insensitive partial
match when only part of the name (or its casing) is known — it returns every match, not just one; \`list_projects\`
to browse; \`get_project\` once you have an ID. Resolve this once per conversation and reuse the \`projectId\` —
almost every other tool is project-scoped.

## Files and folders

- \`list_file_areas\` — the top-level areas on a project (e.g. "Files", "Shared files", "Published files").
- \`get_folder_tree(projectId, fileAreaId)\` — the full folder tree (folders only, no files) for orientation
  before drilling into a specific folder. Don't use it just to locate one known folder — see below.
- \`get_folder_by_path(projectId, fileAreaId, "Files/4_Design/C07_Geometry/C07.05_BIM")\` — resolves a folder
  directly from a path string starting with the file area's display name. Prefer this over walking
  \`list_folders\`/\`get_folder_tree\` when you already know (or can guess) the path.
- \`list_folders\` / \`get_folder\` — lower-level browsing/lookup by ID.
- \`search_folders_by_name(projectId, fileAreaId, query)\` — folders whose name contains \`query\`, case-insensitively.
- \`list_files_in_folder\` — files inside one specific folder.
- \`list_files\` — every file in a file area (can be large; prefer \`list_files_in_folder\` when you know the
  folder).
- \`search_files_by_name(projectId, fileAreaId, query)\` — files whose name contains \`query\`, case-insensitively;
  for locating a file by (partial) name rather than browsing a folder.
- \`get_file\` — file metadata by ID; does **not** download content.
- \`download_file\` — downloads into this server's local cache and gets the content to the chat: a clickable
  \`downloadUrl\` always comes back (single-use, ~15 min, same-machine only); an image also comes back as a real
  \`image\` block; a PDF/Word/Excel/Markdown/HTML file also comes back as its extracted \`text\` (raw document
  bytes aren't something a model can read the way it can an image). Anything else — or anything over the size
  cap — falls back to \`filePath\` plus a message; pass that path to search_file_content/render_pdf_page rather
  than trying to read it back inline yourself.

List tools follow Dalux pagination to completion and report \`totalCount\`/\`truncated\` — there's no need (and no
mechanism) to page through them yourself.

## Directory

- \`list_project_users\` / \`get_user\` — people on a project.
- \`list_project_companies\` — companies on a project.

Use these to resolve a name mentioned in conversation (e.g. "assign it to Erik") to the ID a task field or
filter actually needs — don't guess an ID from a name.
`,
};

const MODELS_AND_QUALITY: SkillDoc = {
  title: 'dalux-build MCP — models, forms, quality, scheduling',
  content: `# Models, forms, quality, scheduling

## IFC / BIM models

- \`ifc_model_info\` — high-level info about an \`.ifc\` model (element counts, storeys, etc.) — start here before
  querying it.
- \`ifc_discover_properties\` / \`ifc_property_values\` — what property sets/fields exist on a model, and the
  distinct values for one, before writing a query that filters on it.
- \`ifc_query_elements\` — query elements by type/property; use the discovery tools above first rather than
  guessing property names.
- \`ifc_schedule\` — a quantity/schedule rollup over queried elements.
- \`ifc_clash_start\` / \`ifc_clash_result\` — clash detection is asynchronous: \`ifc_clash_start\` kicks off a job
  and returns a job handle, \`ifc_clash_result\` polls it (call again if not yet finished) and returns a summary
  plus the deepest clashes once done.
- \`ifc_volumes_start\` / \`ifc_volumes_result\` — geometric volume extraction, also asynchronous.

## \`ifc_diff\` — comparing two revisions

Compares two IFC files from the same project (or an open edit session against its source), reporting per-type
count deltas, added/removed GlobalIds, and — with \`propertyChanges: true\` — which properties actually changed
on each common element.

Two things decide whether the answer is useful:

- **\`byContent\`.** Off by default. Leave it off when the two files are genuine revisions of one model, where
  GlobalIds carry across. Turn it on when they may have been re-exported from scratch: a re-GUID otherwise
  reads as every element deleted and an equal number added, which is technically true and completely useless.
  It costs a full content-fingerprint pass.
- **Scope is data only.** Attributes, property sets, quantity sets and IFC type. There is no geometry
  fingerprint on this path, so an element that was *moved* or *reshaped* but keeps all its data reads as
  unchanged. Say so when reporting a clean diff on a model somebody expects to have changed geometrically —
  don't let "no differences" be read as "nothing moved".

## \`ifc_edit_*\` — editing property sets and properties

\`ifc_edit_start\` → \`ifc_edit_apply\` → \`ifc_edit_review\` → \`ifc_edit_save\`.

**Nothing is written to Dalux, ever.** An edit session is a private in-process copy of the downloaded file;
\`ifc_edit_save\` writes a **new local .ifc** plus a single-use download link. Putting a revision back into the
project is a manual step the user takes in Dalux. Say this plainly when a user asks you to "update the model" —
they may be expecting the project file to change, and it will not.

### Everything written is marked as AI-authored

Not a setting, not a flag — it always happens:

- a property set this server **creates** is named \`AI_<name>\` (so an unprefixed pset is always the authoring
  tool's);
- **every** change, including an edit to an existing unprefixed pset and every deletion, is recorded on the same
  element in an \`AI_Provenance\` pset: one property per changed path, carrying the old value, the new value and
  an ISO timestamp, plus \`ModifiedBy\` / \`ModifiedAt\`.

\`set_property\` takes an optional \`markValue\` that additionally prefixes the *value* with \`AI: \`. It applies to
strings only and is **refused, with a reason in the result, on numbers and booleans** — prefixing \`0.18\` into
\`"AI: 0.18"\` turns a real into a label, and \`ifc_schedule\` would then silently drop it from every total. Don't
reach for it as the default way to make an edit visible; the pset prefix and the provenance pset already do that
without corrupting the data.

### Operations

\`ifc_edit_apply\` takes a list, applied in order, **not atomic** — a failure is reported per operation and
earlier ones stay queued.

| kind | does |
| --- | --- |
| \`set_property\` | set or create \`pset.property\`. Element already carries that pset → edited in place; doesn't → created as \`AI_<pset>\` |
| \`delete_property\` | remove one property from a pset (elements not carrying it are reported as skipped, not failed) |
| \`delete_pset\` | remove a whole property set; the names it held are captured into the provenance record first |
| \`set_attribute\` | Name / Description / ObjectType / Tag |
| \`undo\` | revert the last N **operations** — not the last N mutations, which would strip provenance off edits that stayed |

Target elements with \`select\`: either explicit \`globalIds\`, or a \`type\` optionally narrowed by
\`where: { pset, property, op, value }\`. **Run \`ifc_discover_properties\` first** — pset names are
exporter-specific ("Tekla Quantity", "i-Theses TSB_PlateBase") and a wrong one silently matches nothing. A
selector matching more than \`maxElements\` (default 500) is refused *with its count*, so widen deliberately.

### Saving

\`ifc_edit_save\` is confirmation-gated like \`report_feedback\`: call it without \`confirmed\` first, show the user
the returned operation list, and only call again with \`confirmed: true\` once they have agreed to that exact set
of changes. \`discard: true\` (also confirmed) throws the session away instead. Sessions are dropped after 2h
idle or on restart, and queued edits are **not** persisted.

## \`view_model_3d\` — interactive 3D viewer

Renders an \`.ifc\` file as an interactive 3D view inline, using MCP Apps in supporting hosts (currently Claude.ai
and Claude Desktop). **This only works on the HTTP transport with \`PUBLIC_URL\` configured** — on stdio (the
common local Claude Desktop/Claude Code setup) the tool still appears in the tool list, but replies with
instructions to use \`download_file\` instead of erroring. If you see that reply, that's expected behaviour for
this deployment, not a bug.

## Forms

- \`list_forms\` / \`get_form\` — forms and their submitted content on a project.

## Quality

- \`list_test_plans\` / \`list_test_plan_registrations\` — test plans and their registered results.
- \`list_inspection_plans\` — inspection plans on a project.

## Scheduling

- \`list_work_packages\` — work packages on a project.
- \`list_version_sets\` — version sets (grouped file/model revisions) on a project.

The forms, quality and scheduling tools are plain \`list*\`/\`get*\` wrappers — same pagination and
error-handling behaviour as every other tool on this server (see the \`overview\` topic). The IFC tools above are
not: they download and parse the model locally, and \`ifc_clash_*\` / \`ifc_volumes_*\` are asynchronous jobs.
`,
};

const BUILT_IN_DOCS: Record<SkillTopic, SkillDoc> = {
  overview: OVERVIEW,
  tasks: TASKS,
  documents: DOCUMENTS,
  files: FILES,
  models_and_quality: MODELS_AND_QUALITY,
};

export interface MarkdownSkill {
  name: string;
  description: string;
  tags: string[];
  /** The whole SKILL.md body, frontmatter stripped. */
  content: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (/^(['"]).*\1$/.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed;
}

/**
 * Reads the Agent Skills frontmatter fields this server uses: `name`,
 * `description` (plain, quoted or a `>`/`|` block) and `metadata.tags`
 * (flow `[a, b]` or block list). Not a general YAML parser.
 */
export function parseSkillMarkdown(markdown: string, fallbackName: string): MarkdownSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  const frontmatter = match ? match[1].split(/\r?\n/) : [];
  const content = (match ? markdown.slice(match[0].length) : markdown).trim();

  const fields: Record<string, string> = {};
  let tags: string[] = [];
  for (let i = 0; i < frontmatter.length; i += 1) {
    const line = frontmatter[i];
    const top = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (top && (top[2] === '>' || top[2] === '|' || top[2] === '>-' || top[2] === '|-')) {
      const block: string[] = [];
      while (i + 1 < frontmatter.length && /^\s+\S|^\s*$/.test(frontmatter[i + 1])) {
        block.push(frontmatter[(i += 1)].trim());
      }
      fields[top[1]] = block.join(top[2].startsWith('>') ? ' ' : '\n').trim();
    } else if (top) {
      fields[top[1]] = unquote(top[2]);
    }
    const tagLine = /^\s+tags:\s*(.*)$/.exec(line);
    if (tagLine) {
      if (tagLine[1].startsWith('[')) {
        tags = tagLine[1].replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
      } else {
        while (i + 1 < frontmatter.length && /^\s+-\s+/.test(frontmatter[i + 1])) {
          tags.push(unquote(frontmatter[(i += 1)].replace(/^\s+-\s+/, '')));
        }
      }
    }
  }

  return {
    name: fields.name || fallbackName,
    description: fields.description ?? '',
    tags,
    content,
  };
}

/** Every skills/<name>/SKILL.md, bundled at build time by scripts/build-skills.mjs. */
export const MARKDOWN_SKILLS: MarkdownSkill[] = BUNDLED_SKILLS.map((skill) =>
  parseSkillMarkdown(skill.markdown, skill.directory),
).filter((skill) => !(SKILL_TOPICS as readonly string[]).includes(skill.name));

export function markdownSkill(name: string): MarkdownSkill | undefined {
  return MARKDOWN_SKILLS.find((skill) => skill.name === name);
}

const DOCS: Record<string, SkillDoc> = {
  ...BUILT_IN_DOCS,
  ...Object.fromEntries(
    MARKDOWN_SKILLS.map((skill) => [
      skill.name,
      { title: skill.name, content: skill.content.startsWith('#') ? skill.content : `# ${skill.name}\n\n${skill.content}` },
    ]),
  ),
};

/** Built-in usage topics followed by the bundled markdown skills. */
export const ALL_TOPICS = [...SKILL_TOPICS, ...MARKDOWN_SKILLS.map((skill) => skill.name)] as [string, ...string[]];

export const getSkillInput = z.object({
  topic: z
    .enum(ALL_TOPICS)
    .optional()
    .describe(
      'Which usage doc to fetch. Omit on the first call of a conversation to get the overview, which lists every other topic.',
    ),
});
export type GetSkillInput = z.infer<typeof getSkillInput>;

const getSkillOutput = z.object({
  topic: z.enum(ALL_TOPICS),
  title: z.string(),
  content: z.string().describe('Full usage doc for this topic, as markdown.'),
  availableTopics: z.array(z.enum(ALL_TOPICS)).describe('Every topic get_skill accepts.'),
});
export type GetSkillOutput = z.infer<typeof getSkillOutput>;

function overviewWithSkills(): string {
  if (!MARKDOWN_SKILLS.length) return OVERVIEW.content;
  const rows = MARKDOWN_SKILLS.map((skill) => `| \`${skill.name}\` | ${skill.description.replace(/\|/g, '\\|')} |`);
  return `${OVERVIEW.content}
## Domain skills

Also fetchable with \`get_skill\` (or as \`dalux-build://skill/<name>\` resources):

| topic | covers |
| --- | --- |
${rows.join('\n')}
`;
}

export function getSkill(args: GetSkillInput): GetSkillOutput {
  const topic = args.topic ?? 'overview';
  const doc = DOCS[topic];
  return {
    topic,
    title: doc.title,
    content: topic === 'overview' ? overviewWithSkills() : doc.content,
    availableTopics: [...ALL_TOPICS],
  };
}

function resourceUri(topic: string): string {
  return `dalux-build://skill/${topic}`;
}

/**
 * Registers the `get_skill` tool and one `dalux-build://skill/<topic>`
 * resource per topic. Needs no Dalux client — this is documentation, not a
 * Dalux API call — so it's registered directly rather than through the
 * generic `tool()`/`TOOLS` array in server.ts (same reasoning as
 * ui/taskTimeline.ts and ui/ifcViewer.ts, which also register straight onto
 * `server`).
 */
export function registerSkills(server: McpServer): void {
  for (const topic of ALL_TOPICS) {
    const skill = markdownSkill(topic);
    server.registerResource(
      `skill-${topic}`,
      resourceUri(topic),
      {
        title: DOCS[topic].title,
        description: skill?.description || `dalux-build MCP usage doc: ${topic}`,
        mimeType: 'text/markdown',
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: getSkill({ topic }).content }],
      }),
    );
  }

  server.registerTool(
    'get_skill',
    {
      title: 'Get usage guide',
      description:
        "Read this server's own usage documentation — call it first, with no arguments, before exploring an " +
        'unfamiliar project or writing an OData filter for list_project_tasks. Returns the overview topic by ' +
        `default, which lists every other topic (${ALL_TOPICS.filter((t) => t !== 'overview').join(', ')}) to fetch next.`,
      inputSchema: getSkillInput,
      outputSchema: getSkillOutput,
    },
    async (args) => {
      const result = getSkill(args);
      return {
        content: [{ type: 'text' as const, text: result.content }],
        structuredContent: result,
      };
    },
  );
}
