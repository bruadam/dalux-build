import { McpServer } from '@modelcontextprotocol/server';
import type { DaluxClient } from 'dalux-build-api';
import type { z } from 'zod';

import * as files from './tools/files';
import * as tasks from './tools/tasks';
import * as projects from './tools/projects';
import * as forms from './tools/forms';
import * as directory from './tools/directory';
import * as quality from './tools/quality';
import * as scheduling from './tools/scheduling';
import * as documents from './tools/documents';
import * as drawings from './tools/drawings';
import * as fileAreaIndex from './tools/fileAreaIndex';
import * as taskIndex from './tools/taskIndex';
import * as docsIndex from './tools/docsIndex';
import * as feedback from './tools/feedback';
import * as ifc from './tools/ifc';
import { registerIfcViewer, type IfcHostingOptions } from './ui/ifcViewer';
import { registerTaskTimeline } from './ui/taskTimeline';
import { registerSkills } from './tools/skills';

interface ToolSpec<Schema extends z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: Schema;
  handler: (client: DaluxClient, args: z.infer<Schema>) => Promise<unknown>;
}

function tool<Schema extends z.ZodTypeAny>(spec: ToolSpec<Schema>): ToolSpec<Schema> {
  return spec;
}

export const TOOLS = [
  // Files & folders
  tool({
    name: 'list_file_areas',
    description: 'List the file areas (e.g. Files, Shared files, Published files) available on a Dalux project.',
    inputSchema: files.listFileAreasInput,
    handler: files.listFileAreas,
  }),
  tool({
    name: 'get_file_area',
    description: 'Get a single file area by ID.',
    inputSchema: files.getFileAreaInput,
    handler: files.getFileArea,
  }),
  tool({
    name: 'list_folders',
    description: 'List all folders in a file area.',
    inputSchema: files.listFoldersInput,
    handler: files.listFolders,
  }),
  tool({
    name: 'search_folders_by_name',
    description:
      'Find folders in a file area whose name contains a substring, case-insensitively — for when only part of the folder name is known. Use get_folder_by_path when the full path is already known.',
    inputSchema: files.searchFoldersByNameInput,
    handler: files.searchFoldersByName,
  }),
  tool({
    name: 'get_folder',
    description: 'Get a single folder by ID.',
    inputSchema: files.getFolderInput,
    handler: files.getFolder,
  }),
  tool({
    name: 'get_folder_by_path',
    description: 'Resolve a folder from a full path starting with the file area name, e.g. "Files/4_Design/C07_Geometry".',
    inputSchema: files.getFolderByPathInput,
    handler: files.getFolderByPath,
  }),
  tool({
    name: 'get_folder_tree',
    description: 'Get the full folder tree (folders only, no files) for a file area — useful for navigation before drilling into a specific folder.',
    inputSchema: files.getFolderTreeInput,
    handler: files.getFolderTree,
  }),
  tool({
    name: 'list_files_in_folder',
    description: 'List files inside a specific folder.',
    inputSchema: files.listFilesInFolderInput,
    handler: files.listFilesInFolder,
  }),
  tool({
    name: 'list_files',
    description: 'List all files in a file area.',
    inputSchema: files.listFilesInput,
    handler: files.listFiles,
  }),
  tool({
    name: 'search_files_by_name',
    description:
      'Find files in a file area whose name contains a substring, case-insensitively — for when only part of the file name is known.',
    inputSchema: files.searchFilesByNameInput,
    handler: files.searchFilesByName,
  }),
  tool({
    name: 'get_file',
    description: 'Get file metadata by ID (does not download file content).',
    inputSchema: files.getFileInput,
    handler: files.getFile,
  }),
  tool({
    name: 'download_file',
    description:
      'Download a file and get its content to the chat, not just a local path. Always returns downloadUrl, a ' +
      'single-use link (valid ~15 min, only reachable from the same machine this server runs on) the user can ' +
      'click to fetch the actual file. An image also comes back as an actual image (up to maxInlineBytes, ' +
      'default 10 MB, hard ceiling 500 MB). A PDF/Word/Excel/Markdown/HTML file also comes back as its extracted ' +
      'text (up to maxInlineChars, default 200,000 characters, hard ceiling 2,000,000) — raw document bytes ' +
      'cannot usefully reach the model, so text is what streams instead. Other formats (zip, dwg, ifc, ...) get ' +
      'the link and the local cache path only.',
    inputSchema: documents.downloadFileInput,
    handler: documents.downloadFileToChat,
  }),
  tool({
    name: 'search_file_content',
    description:
      'Search inside one document for a natural-language query. Reads PDFs (including drawings, whose text layer holds title blocks, room names and annotations), Word (.docx/.docm) and Excel (.xlsx/.xlsm) files, and returns the best-matching passages with a citable location — page number, heading, or sheet and row range.',
    inputSchema: documents.searchFileContentInput,
    handler: documents.searchFileContent,
  }),
  tool({
    // Kept so existing clients and prompts that learned the old name keep
    // working; it is the same handler, which now reads more than PDFs.
    name: 'search_pdf_content',
    description:
      'Deprecated alias for search_file_content, which also reads Word and Excel files. Searches one document and returns the best-matching passages.',
    inputSchema: documents.searchFileContentInput,
    handler: documents.searchFileContent,
  }),
  tool({
    name: 'render_pdf_page',
    description:
      'Rasterize one page of a PDF (drawing exports included) to an image, for when the chat needs to see the sheet — symbols, dimension lines, hatching and other linework a text search cannot find because none of it is real text. Prefer search_file_content when the text layer already has the answer; this costs image tokens that a text search does not.',
    inputSchema: drawings.renderPdfPageInput,
    handler: drawings.renderPdfPage,
  }),

  // Cross-document search (see tools/fileAreaIndex.ts — a temporary local index)
  tool({
    name: 'build_file_area_index',
    description:
      'Build (or incrementally refresh) a temporary local search index over the documents in a Dalux file area or folder, so they can be searched together. Downloads and extracts PDFs, Word and Excel files into a disposable index in the OS temp directory — nothing in Dalux is modified. Large scopes are indexed over several calls: if the result says complete=false, call it again with the same arguments.',
    inputSchema: fileAreaIndex.buildFileAreaIndexInput,
    handler: fileAreaIndex.buildFileAreaIndex,
  }),
  tool({
    name: 'search_file_area',
    description:
      'Search across every document in an index built by build_file_area_index, returning the best-matching passages from all of them with the file and location to cite. Use this for questions that span documents ("which specifications mention fire rating EI60?"); use search_file_content when the document is already known.',
    inputSchema: fileAreaIndex.searchFileAreaInput,
    handler: fileAreaIndex.searchFileArea,
  }),
  tool({
    name: 'list_file_area_indexes',
    description: 'List the temporary document indexes currently on this server, with their scope, size and freshness.',
    inputSchema: fileAreaIndex.listFileAreaIndexesInput,
    handler: fileAreaIndex.listFileAreaIndexes,
  }),
  tool({
    name: 'drop_file_area_index',
    description: 'Delete a temporary document index from this server\'s local cache. Does not touch anything in Dalux.',
    inputSchema: fileAreaIndex.dropFileAreaIndexInput,
    handler: fileAreaIndex.dropFileAreaIndex,
  }),

  // Cross-task search (see tools/taskIndex.ts — a temporary local index over tasks + change history + attachments)
  tool({
    name: 'build_task_index',
    description:
      'Build (or incrementally refresh) a temporary local search index over a project\'s tasks, combining each task\'s own fields, change history, and attachment text (pdf/docx/xlsx — downloaded and extracted, not just an extra API call) into one searchable document per task. Nothing in Dalux is modified. A task whose content, change history, and attachment list are all unchanged since the last build is skipped (and its attachments are not re-downloaded), so re-running after a few edits is cheap — the first build of a project with many/large attachments is the expensive one.',
    inputSchema: taskIndex.buildTaskIndexInput,
    handler: taskIndex.buildTaskIndex,
  }),
  tool({
    name: 'search_task_index',
    description:
      'Search across every task in an index built by build_task_index, returning the best-matching passages (from a task\'s fields, its change history, or an attachment\'s text) with the task to cite. Use this for questions that span many tasks ("which tasks mention a crack in a beam?", "what changed on tasks assigned to X last month?"); use search_tasks for a one-off question that does not warrant building an index first.',
    inputSchema: taskIndex.searchTaskIndexInput,
    handler: taskIndex.searchTaskIndex,
  }),
  tool({
    name: 'list_task_indexes',
    description: 'List the temporary task indexes currently on this server, with their scope, size and freshness.',
    inputSchema: taskIndex.listTaskIndexesInput,
    handler: taskIndex.listTaskIndexes,
  }),
  tool({
    name: 'drop_task_index',
    description: 'Delete a temporary task index from this server\'s local cache. Does not touch anything in Dalux.',
    inputSchema: taskIndex.dropTaskIndexInput,
    handler: taskIndex.dropTaskIndex,
  }),

  // Reference-docs search — one corpus of laws/guidelines/standards/procedures,
  // pinned by this deployment's DOCS_GITHUB_* env vars (see tools/docsIndex.ts).
  // The index persists on disk across restarts (see cachePaths.docsIndexRoot)
  // and is built out-of-band by `npm run docs:build`, never by a tool call —
  // indexing is too slow/expensive to trigger from mid-conversation.
  tool({
    name: 'search_docs',
    description:
      'Search the reference-docs corpus (laws, guidelines, standards, procedures) for a natural-language query, returning the best-matching passages with the document path and location to cite. Use this for "what do our standards/guidelines/laws say about X" questions. If it errors saying the corpus isn\'t indexed yet, that\'s a server setup step (`npm run docs:build`), not something to retry.',
    inputSchema: docsIndex.searchDocsInput,
    handler: docsIndex.searchDocs,
  }),
  tool({
    name: 'list_docs_indexes',
    description:
      'Show the reference-docs index currently on this server — document/chunk counts and when it was last built. Read-only; does not trigger a rebuild (that\'s the server-side `npm run docs:build` step).',
    inputSchema: docsIndex.listDocsIndexesInput,
    handler: docsIndex.listDocsIndexes,
  }),

  // Tasks
  tool({
    name: 'list_project_tasks',
    description:
      'List tasks on a project, optionally filtered by type/OData filter and/or field conditions. Dalux\'s ' +
        '$filter only supports a single `data/type/typeId eq \'<id>\'` expression (no `and`/`or`, no comparisons, ' +
        'no other fields) — use `conditions` for anything else (dates, status, custom fields, ...), applied ' +
        'client-side against each task\'s own JSON fields.',
    inputSchema: tasks.listProjectTasksInput,
    handler: tasks.listProjectTasks,
  }),
  tool({
    name: 'search_tasks',
    description:
      'Ranked keyword/natural-language search across a project\'s tasks — no OData syntax needed. Matches against subject, description, custom fields, type, status and (optionally) change history and attachment text (pdf/docx/xlsx), returning the best-matching tasks with a relevance score. Supports `conditions` for field-based filtering (dates, status, custom fields, ...) applied client-side, since Dalux\'s own $filter only supports typeId eq. For repeated searches over the same project, build_task_index + search_task_index is cheaper — it downloads and extracts each attachment once instead of on every call.',
    inputSchema: tasks.searchTasksInput,
    handler: tasks.searchTasks,
  }),
  tool({
    name: 'get_task',
    description:
      'Get a single task by ID. Returns only the task\'s own structured fields by default (subject, type, custom ' +
        'fields) — set includeChanges and/or includeAttachments to also pull that task\'s change history and ' +
        'attachments (filtered client-side, since Dalux has no per-task filter for those).',
    inputSchema: tasks.getTaskInput,
    handler: tasks.getTask,
  }),
  tool({
    name: 'list_task_changes',
    description:
      'List change history entries for tasks on a project, paginated (default 50, max 200 per call — a ' +
        'project-wide change log can otherwise be huge). Pass taskId to scope to one task (filtered client-side ' +
        'after fetching the full updatedAfter window — Dalux has no server-side per-task filter).',
    inputSchema: tasks.listTaskChangesInput,
    handler: tasks.listTaskChanges,
  }),
  tool({
    name: 'list_task_attachments',
    description:
      'List task attachments on a project, paginated (default 50, max 200 per call — a project-wide attachment ' +
        'list can otherwise be huge). Pass taskId to scope to one task (filtered client-side after fetching the ' +
        'full updatedAfter window — Dalux has no server-side per-task filter). Each item\'s mediaFile.fileDownload ' +
        'is a direct, signed URL — pass it to download_task_attachment to fetch the actual file content.',
    inputSchema: tasks.listTaskAttachmentsInput,
    handler: tasks.listTaskAttachments,
  }),
  tool({
    name: 'download_task_attachment',
    description:
      'Download a task attachment and get its content to the chat — the same downloadUrl/image/extracted-text ' +
        'behaviour as download_file (see its description for the size caps). Pass the mediaFile.fileDownload ' +
        'URL from list_task_attachments or get_task (includeAttachments: true) — unlike ordinary project files, ' +
        'task attachments have no fileId/fileArea to look up through get_file/download_file; this signs the ' +
        'request with the same Dalux API key instead.',
    inputSchema: tasks.downloadTaskAttachmentInput,
    handler: tasks.downloadTaskAttachmentToChat,
  }),

  // Projects
  tool({
    name: 'list_projects',
    description: 'List projects accessible to the configured API key.',
    inputSchema: projects.listProjectsInput,
    handler: projects.listProjects,
  }),
  tool({
    name: 'get_project',
    description: 'Get a single project by ID.',
    inputSchema: projects.getProjectInput,
    handler: projects.getProject,
  }),
  tool({
    name: 'find_project_by_name',
    description: 'Find a project ID by its exact display name.',
    inputSchema: projects.findProjectByNameInput,
    handler: projects.findProjectByName,
  }),
  tool({
    name: 'search_projects_by_name',
    description:
      'Find projects whose name contains a substring, case-insensitively — for when only part of the project name is known, or its exact casing isn\'t. Returns every match, not just one.',
    inputSchema: projects.searchProjectsByNameInput,
    handler: projects.searchProjectsByName,
  }),

  // Forms
  tool({
    name: 'list_forms',
    description: 'List forms on a project.',
    inputSchema: forms.listFormsInput,
    handler: forms.listForms,
  }),
  tool({
    name: 'get_form',
    description: 'Get a single form by ID.',
    inputSchema: forms.getFormInput,
    handler: forms.getForm,
  }),

  // Directory
  tool({
    name: 'list_project_users',
    description: 'List users on a project.',
    inputSchema: directory.listProjectUsersInput,
    handler: directory.listProjectUsers,
  }),
  tool({
    name: 'get_user',
    description: 'Get a single project user by ID.',
    inputSchema: directory.getUserInput,
    handler: directory.getUser,
  }),
  tool({
    name: 'list_project_companies',
    description: 'List companies on a project.',
    inputSchema: directory.listProjectCompaniesInput,
    handler: directory.listProjectCompanies,
  }),

  // Quality
  tool({
    name: 'list_test_plans',
    description: 'List test plans on a project.',
    inputSchema: quality.listTestPlansInput,
    handler: quality.listTestPlans,
  }),
  tool({
    name: 'list_test_plan_registrations',
    description: 'List test plan registrations (completed/pending checks) on a project.',
    inputSchema: quality.listTestPlanRegistrationsInput,
    handler: quality.listTestPlanRegistrations,
  }),
  tool({
    name: 'list_inspection_plans',
    description: 'List inspection plans on a project.',
    inputSchema: quality.listInspectionPlansInput,
    handler: quality.listInspectionPlans,
  }),

  // Scheduling
  tool({
    name: 'list_work_packages',
    description: 'List work packages on a project.',
    inputSchema: scheduling.listWorkPackagesInput,
    handler: scheduling.listWorkPackages,
  }),
  tool({
    name: 'list_version_sets',
    description: 'List version sets on a project.',
    inputSchema: scheduling.listVersionSetsInput,
    handler: scheduling.listVersionSets,
  }),

  // IFC analysis (see tools/ifc.ts — deliberately read-only)
  tool({
    name: 'ifc_model_info',
    description:
      'Summarise an IFC file from Dalux: entity counts by type, units, materials, and how many products carry property sets.',
    inputSchema: ifc.ifcModelInfoInput,
    handler: ifc.ifcModelInfo,
  }),
  tool({
    name: 'ifc_discover_properties',
    description:
      'List the property sets and properties each IFC type actually carries, with coverage counts. Call this before ifc_schedule or ifc_property_values — pset names are exporter-specific and guessing one yields blank columns rather than an error.',
    inputSchema: ifc.ifcDiscoverPropertiesInput,
    handler: ifc.ifcDiscoverProperties,
  }),
  tool({
    name: 'ifc_property_values',
    description: 'Value histogram for one "Pset.Property" across an IFC type — useful for picking a filter value.',
    inputSchema: ifc.ifcPropertyValuesInput,
    handler: ifc.ifcPropertyValues,
  }),
  tool({
    name: 'ifc_query_elements',
    description: 'Filter IFC elements by type and/or a property comparison (= != > < >= <= contains exists matches).',
    inputSchema: ifc.ifcQueryElementsInput,
    handler: ifc.ifcQueryElements,
  }),
  tool({
    name: 'ifc_schedule',
    description:
      'Build a schedule / quantity-takeoff table for an IFC type from explicit "Pset.Property" columns, written to CSV. Values are in the file\'s own units (usually millimetres).',
    inputSchema: ifc.ifcScheduleInput,
    handler: ifc.ifcSchedule,
  }),
  tool({
    name: 'ifc_clash_rules_list',
    description: 'List the clash rule catalog: ifc-lite\'s built-in discipline matrix (MEPxSTR, HVACxARCH, ...) plus any custom rules saved with ifc_clash_rules_save. Call before ifc_clash_start to pick ruleIds.',
    inputSchema: ifc.ifcClashRulesListInput,
    handler: ifc.ifcClashRulesList,
  }),
  tool({
    name: 'ifc_clash_rules_save',
    description: 'Create or update a named rule in the persistent clash rule catalog, so it can be reused across projects via ifc_clash_start\'s ruleIds.',
    inputSchema: ifc.ifcClashRulesSaveInput,
    handler: ifc.ifcClashRulesSave,
  }),
  tool({
    name: 'ifc_clash_rules_delete',
    description: 'Delete a custom rule from the clash rule catalog by id. Built-in rules cannot be deleted.',
    inputSchema: ifc.ifcClashRulesDeleteInput,
    handler: ifc.ifcClashRulesDelete,
  }),
  tool({
    name: 'ifc_clash_start',
    description:
      'Start a clash detection run on one or more IFCs from Dalux — pass 2+ models to clash across disciplines exported as separate files. Pick rules from the catalog (ruleIds, see ifc_clash_rules_list) and/or supply one ad-hoc rule, optionally narrowed by a property filter. Returns a jobId immediately — clash meshes every model first and can take minutes. Poll with ifc_clash_result.',
    inputSchema: ifc.ifcClashStartInput,
    handler: ifc.ifcClashStart,
  }),
  tool({
    name: 'ifc_clash_result',
    description: 'Poll a clash job started by ifc_clash_start; returns a summary plus the deepest clashes once finished.',
    inputSchema: ifc.ifcClashResultInput,
    handler: ifc.ifcClashResult,
  }),
  tool({
    name: 'ifc_volumes_start',
    description:
      'Start geometric volume extraction on an IFC file, optionally restricted to one type. Unlike ifc_schedule this reads no property set — it meshes the model and reads back the enclosed volume proved from the tessellated solid, in real cubic metres. Only entities the kernel can prove are a single closed solid get a volume (~71% coverage on a measured corpus); the rest report as absent, not zero. Returns a jobId immediately — meshing can take minutes on a cold model (shares a cache with ifc_clash_start). Poll ifc_volumes_result.',
    inputSchema: ifc.ifcVolumesStartInput,
    handler: ifc.ifcVolumesStart,
  }),
  tool({
    name: 'ifc_volumes_result',
    description: 'Poll a volume extraction job started by ifc_volumes_start; returns per-type totals (proved volumes only) plus a csvPath with the full per-element table once finished.',
    inputSchema: ifc.ifcVolumesResultInput,
    handler: ifc.ifcVolumesResult,
  }),

  // Feedback — the one tool in this server that mutates something outside a
  // local disposable cache (see feedbackReport.ts). Confirmation-gated: an
  // unconfirmed call only returns a preview of what would be posted.
  tool({
    name: 'report_feedback',
    description:
      'File a bug report or feature request about this MCP server/tool set as a GitHub issue. Two-step: call ' +
        'without confirmed (or confirmed: false) first — nothing is posted, you just get back the exact title ' +
        'and body that would be filed. Show that to the user verbatim and get their explicit approval, then call ' +
        'again with confirmed: true to actually file it; never set confirmed: true without having done that. ' +
        'Never include Dalux project data (project/file/task names or IDs, document content, company or user ' +
        'names) or personal data in the report — describe only the tool/server behavior. The call is refused ' +
        '(even if confirmed) if the content looks like it contains an email, an API key, an IP address, or a ' +
        'Dalux identifier.',
    inputSchema: feedback.reportFeedbackInput,
    handler: feedback.reportFeedback,
  }),
] as const;

type ImageContent = { type: 'image'; mimeType: string; data: string };
type TextContent = { type: 'text'; text: string };

/**
 * A handler result carrying an `image: { mimeType, data }` field (see
 * tools/drawings.ts, tools/documents.ts's downloadFileToChat) renders as a
 * real image content block, with the rest of the result alongside it as
 * text — not base64 stuffed into JSON, which a client can't render as a
 * picture.
 *
 * Deliberately does NOT special-case an MCP embedded-resource (`type:
 * 'resource'`) content block for arbitrary binary data: that block type is
 * spec-legal, but at least one MCP host this server is used from has no
 * support for rendering it at all and hard-errors on any tool result that
 * includes one, regardless of the declared mimeType. Streaming a
 * non-image file's bytes back to the chat is handled instead by
 * inlineText.ts, which sends extracted text through the plain JSON path
 * below rather than a binary content block.
 */
export function toolResultContent(result: unknown): [TextContent] | [ImageContent, TextContent] {
  if (result && typeof result === 'object' && 'image' in result && result.image) {
    const { image, ...meta } = result as { image: { mimeType: string; data: string } } & Record<string, unknown>;
    return [
      { type: 'image', mimeType: image.mimeType, data: image.data },
      { type: 'text', text: JSON.stringify(meta) },
    ];
  }
  return [{ type: 'text', text: JSON.stringify(result) }];
}

export interface BuildServerOptions {
  name?: string;
  version?: string;
  /** Enables the view_model_3d tool's 3D viewer — see ui/ifcViewer.ts. Only set on the HTTP deployment (--public-url); leave unset for stdio. */
  hosting?: IfcHostingOptions;
}

/**
 * Build an MCP server exposing read-only Dalux Build API tools over `client`.
 * Does not start any transport — call `.connect(transport)` (or use `cli.ts`).
 */
export function buildServer(client: DaluxClient, options: BuildServerOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: options.name ?? 'dalux-build',
      version: options.version ?? '0.1.0',
    },
    {
      instructions:
        'Read-only Dalux Build API access. Call get_skill (no arguments) first — before browsing an ' +
        'unfamiliar project or writing an OData filter for list_project_tasks — for this server\'s own ' +
        'usage guide and links to deeper topics (tasks/documents/files/models_and_quality).',
    },
  );

  for (const spec of TOOLS) {
    server.registerTool(
      spec.name,
      { description: spec.description, inputSchema: spec.inputSchema },
      async (args: unknown) => {
        try {
          const result = await spec.handler(client, args as never);
          return { content: [...toolResultContent(result)] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
        }
      },
    );
  }

  registerIfcViewer(server, client, options.hosting);
  registerTaskTimeline(server, client);
  registerSkills(server);

  return server;
}
