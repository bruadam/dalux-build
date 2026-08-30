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
    name: 'search_pdf_content',
    description: 'Search inside a PDF file\'s text content for a natural-language query, returning the best-matching passages with page numbers.',
    inputSchema: documents.searchPdfContentInput,
    handler: documents.searchPdfContent,
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
] as const;

export interface BuildServerOptions {
  name?: string;
  version?: string;
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
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
        }
      },
    );
  }

  return server;
}
