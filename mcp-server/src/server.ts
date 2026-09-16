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
import * as ifc from './tools/ifc';
import { registerIfcViewer, type IfcHostingOptions } from './ui/ifcViewer';

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
    name: 'get_file',
    description: 'Get file metadata by ID (does not download file content).',
    inputSchema: files.getFileInput,
    handler: files.getFile,
  }),
  tool({
    name: 'download_file',
    description: 'Download a file into a local cache and return its path (does not return raw bytes).',
    inputSchema: documents.downloadFileInput,
    handler: documents.downloadFile,
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

  // Tasks
  tool({
    name: 'list_project_tasks',
    description: 'List tasks on a project, optionally filtered by type/OData filter.',
    inputSchema: tasks.listProjectTasksInput,
    handler: tasks.listProjectTasks,
  }),
  tool({
    name: 'get_task',
    description: 'Get a single task by ID.',
    inputSchema: tasks.getTaskInput,
    handler: tasks.getTask,
  }),
  tool({
    name: 'list_task_changes',
    description: 'List change history entries for tasks on a project.',
    inputSchema: tasks.listTaskChangesInput,
    handler: tasks.listTaskChanges,
  }),
  tool({
    name: 'list_task_attachments',
    description: 'List task attachments on a project.',
    inputSchema: tasks.listTaskAttachmentsInput,
    handler: tasks.listTaskAttachments,
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
    description: 'Find a project ID by its display name.',
    inputSchema: projects.findProjectByNameInput,
    handler: projects.findProjectByName,
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
    name: 'ifc_clash_start',
    description:
      'Start a clash detection run on an IFC from Dalux. Returns a jobId immediately — clash meshes the whole model first and can take minutes. Poll with ifc_clash_result.',
    inputSchema: ifc.ifcClashStartInput,
    handler: ifc.ifcClashStart,
  }),
  tool({
    name: 'ifc_clash_result',
    description: 'Poll a clash job started by ifc_clash_start; returns a summary plus the deepest clashes once finished.',
    inputSchema: ifc.ifcClashResultInput,
    handler: ifc.ifcClashResult,
  }),
] as const;

type ImageContent = { type: 'image'; mimeType: string; data: string };
type TextContent = { type: 'text'; text: string };

/** A handler result carrying an `image: { mimeType, data }` field (see tools/drawings.ts) renders as a real image content block, with the rest of the result alongside it as text — not base64 stuffed into JSON, which a multimodal client can't see as a picture. */
function toolResultContent(result: unknown): [TextContent] | [ImageContent, TextContent] {
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
  const server = new McpServer({
    name: options.name ?? 'dalux-build',
    version: options.version ?? '0.1.0',
  });

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

  return server;
}
