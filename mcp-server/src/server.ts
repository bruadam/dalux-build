import { McpServer, type RegisteredTool, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
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
import * as consistency from './tools/consistency';
import * as taskIndex from './tools/taskIndex';
import * as docsIndex from './tools/docsIndex';
import * as feedback from './tools/feedback';
import * as ifc from './tools/ifc';
import { registerIfcViewer } from './ui/ifcViewer';
import { registerTaskTimeline } from './ui/taskTimeline';
import { registerSkills } from './tools/skills';
import { registerMemoryTools } from './memory/tools';
import type { Db } from '@dalux-platform/db';
import { UNRESTRICTED_CONTEXT, type RequestContext } from './access/context';
import type { FolderLookup } from './access/folders';
import { createToolGuard, requestIdNote, type ToolCallRecord } from './access/guard';
import { currentCallStats, errorCodeOf } from './observability/callStats';
import { TOOL_ACCESS } from './access/registry';
import { DEFAULT_TOOLSETS, toolsInToolsets, type Toolset } from './toolsets';

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
    description:
      'List the file areas of a project.',
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
    description: 'List the folders in a file area, one page at a time.',
    inputSchema: files.listFoldersInput,
    handler: files.listFolders,
  }),
  tool({
    name: 'search_folders_by_name',
    description:
      'Find folders whose name contains a substring (case-insensitive).',
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
    description:
      'Resolve a folder from its full path, e.g. "Files/4_Design/C07_Geometry".',
    inputSchema: files.getFolderByPathInput,
    handler: files.getFolderByPath,
  }),
  tool({
    name: 'get_folder_tree',
    description:
      'Folder tree (ids and names, depth-limited) of a file area or below one folder.',
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
    description: 'List the files in a file area, one page at a time.',
    inputSchema: files.listFilesInput,
    handler: files.listFiles,
  }),
  tool({
    name: 'search_files_by_name',
    description:
      'Find files whose name contains a substring (case-insensitive).',
    inputSchema: files.searchFilesByNameInput,
    handler: files.searchFilesByName,
  }),
  tool({
    name: 'get_file',
    description:
      'Get file metadata (no content).',
    inputSchema: files.getFileInput,
    handler: files.getFile,
  }),
  tool({
    name: 'download_file',
    description:
      'Get a file into the chat: extracted text for documents, an image for images, plus a short-lived local downloadUrl. Text is capped at 40,000 characters by default.',
    inputSchema: documents.downloadFileInput,
    handler: documents.downloadFileToChat,
  }),
  tool({
    name: 'search_file_content',
    description:
      'Search one document (PDF incl. drawings, Word, Excel, CSV, Markdown, HTML) and return the best passages with page, heading or sheet location.',
    inputSchema: documents.searchFileContentInput,
    handler: documents.searchFileContent,
  }),
  tool({
    // Kept so existing clients and prompts that learned the old name keep
    // working; it is the same handler, which now reads more than PDFs.
    name: 'search_pdf_content',
    description:
      'Deprecated alias for search_file_content.',
    inputSchema: documents.searchFileContentInput,
    handler: documents.searchFileContent,
  }),
  tool({
    name: 'render_pdf_page',
    description:
      'Render one PDF page as an image, to see linework a text search cannot find. Try search_file_content first; images cost more tokens.',
    inputSchema: drawings.renderPdfPageInput,
    handler: drawings.renderPdfPage,
  }),

  // Cross-document search (see tools/fileAreaIndex.ts — a temporary local index)
  tool({
    name: 'build_file_area_index',
    description:
      'Build or refresh a local search index over the documents of a file area or folder. If complete=false, call again with the same arguments.',
    inputSchema: fileAreaIndex.buildFileAreaIndexInput,
    handler: fileAreaIndex.buildFileAreaIndex,
  }),
  tool({
    name: 'search_file_area',
    description:
      'Search all documents in a build_file_area_index index and return passages with file and location.',
    inputSchema: fileAreaIndex.searchFileAreaInput,
    handler: fileAreaIndex.searchFileArea,
  }),
  tool({
    name: 'list_file_area_indexes',
    description:
      'List the local document indexes on this server.',
    inputSchema: fileAreaIndex.listFileAreaIndexesInput,
    handler: fileAreaIndex.listFileAreaIndexes,
  }),
  tool({
    name: 'drop_file_area_index',
    description:
      'Delete a local document index. Dalux is not touched.',
    inputSchema: fileAreaIndex.dropFileAreaIndexInput,
    handler: fileAreaIndex.dropFileAreaIndex,
  }),

  // Cross-document consistency (see tools/consistency.ts — a local report, read-only towards Dalux)
  tool({
    name: 'check_document_consistency',
    description:
      'Find statements that contradict each other across the documents of a file area or folder (fire class, quantities, dates, standard editions, revisions). If complete=false, call again with the same arguments. Review "candidate" findings with get_skill document-consistency-review.',
    inputSchema: consistency.checkDocumentConsistencyInput,
    handler: consistency.checkDocumentConsistency,
  }),
  tool({
    name: 'list_inconsistencies',
    description:
      'Page through the findings of a consistency report, filtered by severity, type or file.',
    inputSchema: consistency.listInconsistenciesInput,
    handler: consistency.listInconsistencies,
  }),
  tool({
    name: 'export_inconsistency_report',
    description:
      'Export a consistency report (xlsx, docx, md or annotated-pdf) and return a download link.',
    inputSchema: consistency.exportInconsistencyReportInput,
    handler: consistency.exportInconsistencyReport,
  }),
  tool({
    name: 'list_consistency_reports',
    description:
      'List the consistency reports on this server.',
    inputSchema: consistency.listConsistencyReportsInput,
    handler: consistency.listConsistencyReports,
  }),
  tool({
    name: 'drop_consistency_report',
    description:
      'Delete a consistency report from the local cache. Dalux is not touched.',
    inputSchema: consistency.dropConsistencyReportInput,
    handler: consistency.dropConsistencyReport,
  }),

  // Cross-task search (see tools/taskIndex.ts — a temporary local index over tasks + change history + attachments)
  tool({
    name: 'build_task_index',
    description:
      'Build or refresh a local search index over a project\'s tasks, their change history and attachment text.',
    inputSchema: taskIndex.buildTaskIndexInput,
    handler: taskIndex.buildTaskIndex,
  }),
  tool({
    name: 'search_task_index',
    description:
      'Search all tasks in a build_task_index index and return passages with the task to cite.',
    inputSchema: taskIndex.searchTaskIndexInput,
    handler: taskIndex.searchTaskIndex,
  }),
  tool({
    name: 'list_task_indexes',
    description:
      'List the local task indexes on this server.',
    inputSchema: taskIndex.listTaskIndexesInput,
    handler: taskIndex.listTaskIndexes,
  }),
  tool({
    name: 'drop_task_index',
    description:
      'Delete a local task index. Dalux is not touched.',
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
      'Search the reference-docs corpus (laws, standards, guidelines, procedures) and return passages with path and location.',
    inputSchema: docsIndex.searchDocsInput,
    handler: docsIndex.searchDocs,
  }),
  tool({
    name: 'list_docs_indexes',
    description:
      'Show the reference-docs index: counts and build time. Read-only.',
    inputSchema: docsIndex.listDocsIndexesInput,
    handler: docsIndex.listDocsIndexes,
  }),

  // Tasks
  tool({
    name: 'list_project_tasks',
    description:
      'List a project\'s tasks, one page at a time. Filter with typeId and conditions; Dalux supports no other OData.',
    inputSchema: tasks.listProjectTasksInput,
    handler: tasks.listProjectTasks,
  }),
  tool({
    name: 'search_tasks',
    description:
      'Ranked keyword search over a project\'s tasks (subject, description, fields; optionally change history and attachments).',
    inputSchema: tasks.searchTasksInput,
    handler: tasks.searchTasks,
  }),
  tool({
    name: 'get_task',
    description:
      'Get one task; optionally with its change history and attachments.',
    inputSchema: tasks.getTaskInput,
    handler: tasks.getTask,
  }),
  tool({
    name: 'list_task_changes',
    description:
      'List task change history on a project, one page at a time; optionally for one task.',
    inputSchema: tasks.listTaskChangesInput,
    handler: tasks.listTaskChanges,
  }),
  tool({
    name: 'list_task_attachments',
    description:
      'List task attachments on a project, one page at a time; optionally for one task. Pass mediaFile.fileDownload to download_task_attachment.',
    inputSchema: tasks.listTaskAttachmentsInput,
    handler: tasks.listTaskAttachments,
  }),
  tool({
    name: 'download_task_attachment',
    description:
      'Get a task attachment into the chat, like download_file. Takes the mediaFile.fileDownload URL.',
    inputSchema: tasks.downloadTaskAttachmentInput,
    handler: tasks.downloadTaskAttachmentToChat,
  }),

  // Projects
  tool({
    name: 'list_projects',
    description:
      'List the projects the API key can access.',
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
    description:
      'Find a project by its exact name.',
    inputSchema: projects.findProjectByNameInput,
    handler: projects.findProjectByName,
  }),
  tool({
    name: 'search_projects_by_name',
    description:
      'Find projects whose name contains a substring (case-insensitive).',
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
    description:
      'List test plan registrations on a project.',
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
      'Summarise an IFC file: entity counts, units, materials, property set coverage.',
    inputSchema: ifc.ifcModelInfoInput,
    handler: ifc.ifcModelInfo,
  }),
  tool({
    name: 'ifc_discover_properties',
    description:
      'List the property sets and properties each IFC type carries. Call before ifc_schedule, ifc_property_values or ifc_query_elements: pset names differ per exporter.',
    inputSchema: ifc.ifcDiscoverPropertiesInput,
    handler: ifc.ifcDiscoverProperties,
  }),
  tool({
    name: 'ifc_property_values',
    description:
      'Value histogram of one "Pset.Property" across an IFC type.',
    inputSchema: ifc.ifcPropertyValuesInput,
    handler: ifc.ifcPropertyValues,
  }),
  tool({
    name: 'ifc_query_elements',
    description:
      'Filter IFC elements by type and property. Returns a selectionId for view_model_3d.',
    inputSchema: ifc.ifcQueryElementsInput,
    handler: ifc.ifcQueryElements,
  }),
  tool({
    name: 'ifc_schedule',
    description:
      'Quantity take-off table for an IFC type from "Pset.Property" columns, written to CSV. Values are in model units.',
    inputSchema: ifc.ifcScheduleInput,
    handler: ifc.ifcSchedule,
  }),
  tool({
    name: 'ifc_clash_rules_list',
    description:
      'List the clash rule catalog (built-in and saved rules).',
    inputSchema: ifc.ifcClashRulesListInput,
    handler: ifc.ifcClashRulesList,
  }),
  tool({
    name: 'ifc_clash_rules_save',
    description:
      'Create or update a rule in the clash rule catalog.',
    inputSchema: ifc.ifcClashRulesSaveInput,
    handler: ifc.ifcClashRulesSave,
  }),
  tool({
    name: 'ifc_clash_rules_delete',
    description:
      'Delete a saved clash rule.',
    inputSchema: ifc.ifcClashRulesDeleteInput,
    handler: ifc.ifcClashRulesDelete,
  }),
  tool({
    name: 'ifc_clash_start',
    description:
      'Start clash detection on one or more IFC files. Returns a jobId; poll ifc_clash_result.',
    inputSchema: ifc.ifcClashStartInput,
    handler: ifc.ifcClashStart,
  }),
  tool({
    name: 'ifc_clash_result',
    description:
      'Poll a clash job; returns a summary and the deepest clashes when done.',
    inputSchema: ifc.ifcClashResultInput,
    handler: ifc.ifcClashResult,
  }),
  tool({
    name: 'ifc_volumes_start',
    description:
      'Start geometric volume extraction (m³ from meshes) on an IFC file. Returns a jobId; poll ifc_volumes_result.',
    inputSchema: ifc.ifcVolumesStartInput,
    handler: ifc.ifcVolumesStart,
  }),
  tool({
    name: 'ifc_volumes_result',
    description:
      'Poll a volume job; returns totals per type and a CSV path when done.',
    inputSchema: ifc.ifcVolumesResultInput,
    handler: ifc.ifcVolumesResult,
  }),
  tool({
    name: 'ifc_diff',
    description:
      'Compare two IFC revisions, or an edit session with its source: count deltas, added and removed GlobalIds, optionally changed properties.',
    inputSchema: ifc.ifcDiffInput,
    handler: ifc.ifcDiff,
  }),

  // IFC editing (see tools/ifc.ts). Read-only with respect to Dalux: edits are
  // queued on a private in-process copy and ifc_edit_save writes a NEW local
  // .ifc. Every write is marked AI-authored in the file itself.
  tool({
    name: 'ifc_edit_start',
    description:
      'Open an in-memory edit session on an IFC file. Dalux is never modified; changes are marked as AI-made. Returns an editId.',
    inputSchema: ifc.ifcEditStartInput,
    handler: ifc.ifcEditStart,
  }),
  tool({
    name: 'ifc_edit_apply',
    description:
      'Queue property and attribute edits (or undo) on an edit session. Not atomic.',
    inputSchema: ifc.ifcEditApplyInput,
    handler: ifc.ifcEditApply,
  }),
  tool({
    name: 'ifc_edit_review',
    description:
      'List the edits queued on a session.',
    inputSchema: ifc.ifcEditReviewInput,
    handler: ifc.ifcEditReview,
  }),
  tool({
    name: 'ifc_edit_save',
    description:
      'Write the session to a new local .ifc, or discard it. Call without confirmed first, show the preview to the user, and set confirmed: true only after they agree.',
    inputSchema: ifc.ifcEditSaveInput,
    handler: ifc.ifcEditSave,
  }),

  // Feedback — the one tool in this server that mutates something outside a
  // local disposable cache (see feedbackReport.ts). Confirmation-gated: an
  // unconfirmed call only returns a preview of what would be posted.
  tool({
    name: 'report_feedback',
    description:
      'File a bug or feature request about this MCP server as a GitHub issue. Call without confirmed first, show the user the exact title and body, and set confirmed: true only after their explicit yes. Never include project data or personal data.',
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

/** Drops what zod's JSON Schema output carries for no model benefit: the root `$schema` dialect URI and safe-integer bounds. */
function stripSchemaNoise(json: Record<string, unknown>): Record<string, unknown> {
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(
      Object.entries(node)
        .filter(
          ([key, value]) =>
            !(key === 'maximum' && value === Number.MAX_SAFE_INTEGER) &&
            !(key === 'minimum' && value === Number.MIN_SAFE_INTEGER),
        )
        .map(([key, value]) => [key, clean(value)]),
    );
  };
  const { $schema: _dialect, ...rest } = json;
  return clean(rest) as Record<string, unknown>;
}

function withLeanJsonSchema<S extends StandardSchemaWithJSON>(schema: S): S {
  const std = schema['~standard'];
  const jsonSchema: typeof std.jsonSchema = {
    input: (options) => stripSchemaNoise(std.jsonSchema.input(options)),
    output: (options) => stripSchemaNoise(std.jsonSchema.output(options)),
  };
  return Object.create(schema, { '~standard': { value: { ...std, jsonSchema } } }) as S;
}

/**
 * Wraps `server.registerTool` once, for every tool including those registered
 * outside this file (get_skill, the UI tools): schemas are listed through
 * stripSchemaNoise (validation still runs on the original schema), and a tool
 * outside the enabled toolsets is removed again right after registration.
 */
function configureToolRegistration(server: McpServer, enabledTools: ReadonlySet<string>): void {
  type ToolConfig = { inputSchema?: StandardSchemaWithJSON; outputSchema?: StandardSchemaWithJSON } & Record<string, unknown>;
  const register = server.registerTool.bind(server) as (name: string, config: ToolConfig, cb: unknown) => RegisteredTool;
  server.registerTool = ((name: string, config: ToolConfig, cb: unknown) => {
    const registered = register(name, {
      ...config,
      inputSchema: config.inputSchema && withLeanJsonSchema(config.inputSchema),
      outputSchema: config.outputSchema && withLeanJsonSchema(config.outputSchema),
    }, cb);
    if (!enabledTools.has(name)) registered.remove();
    return registered;
  }) as typeof server.registerTool;
}

/** Item count and truncation of a list result, for the audit log (the content itself is never recorded). */
function summarizeResult(result: unknown): void {
  const stats = currentCallStats();
  if (!stats || typeof result !== 'object' || result === null) return;
  const { items, truncated } = result as { items?: unknown; truncated?: unknown };
  if (Array.isArray(items)) stats.resultItems = items.length;
  else if (Array.isArray(result)) stats.resultItems = result.length;
  if (typeof truncated === 'boolean') stats.resultTruncated = truncated;
}

export interface BuildServerOptions {
  name?: string;
  version?: string;
  /** Who is calling and what they may access. Unrestricted in stdio and Dalux-header mode. */
  context?: RequestContext;
  /** Places files and folders in the folder tree, so folder grants can be checked (platform mode). */
  folders?: FolderLookup;
  /** Called once per tool call (platform mode). */
  audit?: (record: ToolCallRecord) => void;
  /** Toolsets to expose (see toolsets.ts); defaults to DEFAULT_TOOLSETS. */
  toolsets?: readonly Toolset[];
  /** The platform database (role `mcp`); its presence turns on the memory tools, which exist only in platform mode. */
  memoryDb?: Db;
}

/**
 * Build an MCP server exposing read-only Dalux Build API tools over `client`.
 * Does not start any transport — call `.connect(transport)` (or use `cli.ts`).
 */
export function buildServer(client: DaluxClient, options: BuildServerOptions = {}): McpServer {
  const context = options.context ?? UNRESTRICTED_CONTEXT;
  const server = new McpServer(
    {
      name: options.name ?? 'dalux-build',
      version: options.version ?? '0.1.0',
    },
    {
      instructions:
        'Read-only Dalux Build API access: no tool changes a Dalux project. Call get_skill (no arguments) first ' +
        'for the usage guide, its topics, and the toolsets this connection has.',
    },
  );

  const guard = createToolGuard(context, { folders: options.folders, audit: options.audit });
  const errorResult = (message: string) => ({
    content: [{ type: 'text' as const, text: `Error: ${message}` }] as ReturnType<typeof toolResultContent>,
    isError: true,
  });
  const hidden = (name: string) =>
    context.access !== 'unrestricted' && TOOL_ACCESS[name]?.adminOnly && context.account?.role !== 'admin';

  const toolsets = options.toolsets ?? DEFAULT_TOOLSETS;
  configureToolRegistration(server, toolsInToolsets(toolsets));
  for (const spec of TOOLS) {
    if (hidden(spec.name)) continue;
    server.registerTool(
      spec.name,
      { description: spec.description, inputSchema: spec.inputSchema },
      (args: unknown) =>
        guard(spec.name, args as Record<string, unknown>, errorResult, async () => {
          try {
            const result = await spec.handler(client, args as never);
            summarizeResult(result);
            return { content: toolResultContent(result), isError: false };
          } catch (err) {
            const stats = currentCallStats();
            if (stats) stats.errorCode = errorCodeOf(err);
            return errorResult(`${err instanceof Error ? err.message : String(err)}${requestIdNote(context)}`);
          }
        }),
    );
  }

  if (options.memoryDb) registerMemoryTools(server, guard, options.memoryDb);
  registerIfcViewer(server, client, guard);
  registerTaskTimeline(server, client, guard);
  registerSkills(server, toolsets);

  return server;
}
