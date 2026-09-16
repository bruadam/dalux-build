import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

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
to a local cache directory, but that's a disposable local side effect, not a mutation of project data.

## Read this first, then drill in

Call \`get_skill\` again with one of these topics for the full doc on that area — this overview only orients you:

| topic | covers |
| --- | --- |
| \`tasks\` | \`list_project_tasks\` filtering — OData \`$filter\`/\`$select\`/\`$orderby\` syntax, field paths, examples |
| \`documents\` | \`search_file_content\`, \`render_pdf_page\`, cross-document search (\`build_file_area_index\`/\`search_file_area\`), and docs-repo search over GitHub (\`search_docs\`/\`list_docs_indexes\`) |
| \`files\` | Navigating file areas/folders/files, path-based lookups, projects, directory (users/companies) |
| \`models_and_quality\` | IFC model tools, the 3D viewer, forms, quality plans, scheduling |

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
  embeddings if the server has \`OPENAI_API_KEY\` set) over subject, type, status, description and custom fields,
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
- \`download_file\` — downloads into a local cache directory and returns the **local path**, not raw bytes (a
  large file would blow the conversation's context). Pass that path along to whatever needs it next rather than
  trying to read the file's content back inline.

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

All of the above are plain \`list*\`/\`get*\` wrappers — same pagination and error-handling behaviour as every
other tool on this server (see the \`overview\` topic).
`,
};

const DOCS: Record<SkillTopic, SkillDoc> = {
  overview: OVERVIEW,
  tasks: TASKS,
  documents: DOCUMENTS,
  files: FILES,
  models_and_quality: MODELS_AND_QUALITY,
};

export const getSkillInput = z.object({
  topic: z
    .enum(SKILL_TOPICS)
    .optional()
    .describe(
      'Which usage doc to fetch. Omit on the first call of a conversation to get the overview, which lists every other topic.',
    ),
});
export type GetSkillInput = z.infer<typeof getSkillInput>;

const getSkillOutput = z.object({
  topic: z.enum(SKILL_TOPICS),
  title: z.string(),
  content: z.string().describe('Full usage doc for this topic, as markdown.'),
  availableTopics: z.array(z.enum(SKILL_TOPICS)).describe('Every topic get_skill accepts.'),
});
export type GetSkillOutput = z.infer<typeof getSkillOutput>;

export function getSkill(args: GetSkillInput): GetSkillOutput {
  const topic = args.topic ?? 'overview';
  const doc = DOCS[topic];
  return { topic, title: doc.title, content: doc.content, availableTopics: [...SKILL_TOPICS] };
}

function resourceUri(topic: SkillTopic): string {
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
  for (const topic of SKILL_TOPICS) {
    const doc = DOCS[topic];
    server.registerResource(
      `skill-${topic}`,
      resourceUri(topic),
      {
        title: doc.title,
        description: `dalux-build MCP usage doc: ${topic}`,
        mimeType: 'text/markdown',
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: doc.content }],
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
        'default, which lists every other topic (tasks, documents, files, models_and_quality) to fetch next.',
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
