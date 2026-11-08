/**
 * What every MCP tool needs to be called: the capability (PRD 5.4) and the
 * Dalux resources its arguments point at. Tool names here must match the
 * registered tools exactly; test/access.registry.test.ts enforces that.
 */

export const CAPABILITIES = [
  'projects:read',
  'files:read',
  'tasks:read',
  'forms:read',
  'quality:read',
  'scheduling:read',
  'directory:read',
  'models:read',
  'memory:read',
  'memory:write',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * A Dalux resource a tool call touches. Fields left undefined are not narrowed:
 * `{}` is the whole connection, `{ projectId }` a whole project.
 */
export interface ResourceScope {
  projectId?: string;
  fileAreaId?: string;
  folderId?: string;
  /** Folders above `folderId`; needed for folder grants to cover anything below them. */
  folderAncestorIds?: string[];
  fileId?: string;
}

export interface ToolAccess {
  /** 'none' for tools that read no Dalux project data (usage guide, feedback, reference docs). */
  capability: Capability | 'none';
  /** Index build and drop tools: offered only to admins in platform mode. */
  adminOnly?: boolean;
  /**
   * The tool returns a list that is filtered to what the caller can see, so a
   * caller with access to only part of the scope may still call it.
   */
  filtersOutput?: boolean;
  /** The scopes name files (IFC models live in folders), so files:read is also required on each of them. */
  readsFiles?: boolean;
  /**
   * Every resource the call touches. An empty list means the arguments name no
   * Dalux resource (e.g. polling a job by id): holding the capability anywhere
   * on the connection is enough.
   */
  scopes: (args: Record<string, unknown>) => ResourceScope[];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** The resource named by the standard projectId / fileAreaId / folderId / fileId arguments. */
function fromArgs(args: Record<string, unknown>): ResourceScope[] {
  const scope: ResourceScope = {
    projectId: text(args.projectId),
    fileAreaId: text(args.fileAreaId),
    folderId: text(args.folderId),
    fileId: text(args.fileId),
  };
  for (const key of Object.keys(scope) as (keyof ResourceScope)[]) {
    if (scope[key] === undefined) delete scope[key];
  }
  return [scope];
}

const connectionWide = (): ResourceScope[] => [{}];
const noResource = (): ResourceScope[] => [];

type FileRef = { fileAreaId?: unknown; fileId?: unknown };

function ifcFiles(args: Record<string, unknown>, refs: (FileRef | undefined)[]): ResourceScope[] {
  return refs
    .filter((ref): ref is FileRef => ref !== undefined)
    .map((ref) => ({ projectId: text(args.projectId), fileAreaId: text(ref.fileAreaId), fileId: text(ref.fileId) }));
}

const read = (capability: Capability, extra: Partial<ToolAccess> = {}): ToolAccess => ({
  capability,
  scopes: fromArgs,
  ...extra,
});
const listing = (capability: Capability): ToolAccess => read(capability, { filtersOutput: true });
const none: ToolAccess = { capability: 'none', scopes: noResource };
const ifcRead = read('models:read', { readsFiles: true });

export const TOOL_ACCESS: Record<string, ToolAccess> = {
  // Files & folders
  list_file_areas: listing('files:read'),
  get_file_area: read('files:read'),
  list_folders: listing('files:read'),
  search_folders_by_name: listing('files:read'),
  get_folder: read('files:read'),
  // The path names the file area by name, not id, so only the project is known up front.
  get_folder_by_path: read('files:read'),
  get_folder_tree: listing('files:read'),
  list_files_in_folder: listing('files:read'),
  list_files: listing('files:read'),
  search_files_by_name: listing('files:read'),
  get_file: read('files:read'),
  download_file: read('files:read'),
  search_file_content: read('files:read'),
  search_pdf_content: read('files:read'),
  render_pdf_page: read('files:read'),

  // File-area indexes
  build_file_area_index: read('files:read', { adminOnly: true }),
  search_file_area: listing('files:read'),
  list_file_area_indexes: listing('files:read'),
  drop_file_area_index: { capability: 'files:read', adminOnly: true, scopes: connectionWide },

  // Document consistency reports. Reports are kept per caller (see RequestContext.fileNamespace),
  // so the reportId tools need no Dalux scope; the check itself reads only files the caller can list.
  check_document_consistency: listing('files:read'),
  list_inconsistencies: { capability: 'files:read', scopes: noResource },
  export_inconsistency_report: { capability: 'files:read', scopes: noResource },
  list_consistency_reports: { capability: 'files:read', scopes: noResource },
  drop_consistency_report: { capability: 'files:read', scopes: noResource },

  // Task indexes
  build_task_index: read('tasks:read', { adminOnly: true }),
  search_task_index: listing('tasks:read'),
  list_task_indexes: listing('tasks:read'),
  drop_task_index: { capability: 'tasks:read', adminOnly: true, scopes: connectionWide },

  // Reference docs: not project data, visible to every account (PRD 6.7).
  search_docs: none,
  list_docs_indexes: none,

  // Tasks
  list_project_tasks: read('tasks:read'),
  search_tasks: read('tasks:read'),
  get_task: read('tasks:read'),
  list_task_changes: read('tasks:read'),
  list_task_attachments: read('tasks:read'),
  // Only a signed download URL is passed; nothing in it names a project.
  download_task_attachment: { capability: 'tasks:read', scopes: connectionWide },
  view_tasks_timeline: read('tasks:read'),

  // Projects
  list_projects: listing('projects:read'),
  get_project: read('projects:read'),
  find_project_by_name: listing('projects:read'),
  search_projects_by_name: listing('projects:read'),

  // Forms
  list_forms: read('forms:read'),
  get_form: read('forms:read'),

  // Directory
  list_project_users: read('directory:read'),
  get_user: read('directory:read'),
  list_project_companies: read('directory:read'),

  // Quality
  list_test_plans: read('quality:read'),
  list_test_plan_registrations: read('quality:read'),
  list_inspection_plans: read('quality:read'),

  // Scheduling
  list_work_packages: read('scheduling:read'),
  list_version_sets: read('scheduling:read'),

  // IFC models
  ifc_model_info: ifcRead,
  ifc_discover_properties: ifcRead,
  ifc_property_values: ifcRead,
  ifc_query_elements: ifcRead,
  ifc_schedule: ifcRead,
  ifc_clash_rules_list: { capability: 'models:read', scopes: noResource },
  ifc_clash_rules_save: { capability: 'models:read', scopes: noResource },
  ifc_clash_rules_delete: { capability: 'models:read', scopes: noResource },
  ifc_clash_start: {
    capability: 'models:read',
    readsFiles: true,
    scopes: (args) => ifcFiles(args, (args.models as FileRef[] | undefined) ?? []),
  },
  ifc_clash_result: { capability: 'models:read', scopes: noResource },
  ifc_volumes_start: ifcRead,
  ifc_volumes_result: { capability: 'models:read', scopes: noResource },
  ifc_diff: {
    capability: 'models:read',
    readsFiles: true,
    scopes: (args) => ifcFiles(args, [args.base as FileRef | undefined, args.head as FileRef | undefined]),
  },
  ifc_edit_start: ifcRead,
  ifc_edit_apply: { capability: 'models:read', scopes: noResource },
  ifc_edit_review: { capability: 'models:read', scopes: noResource },
  ifc_edit_save: { capability: 'models:read', scopes: noResource },
  view_model_3d: ifcRead,
  // App-only tools of the 3D viewer; selections are owned by their caller (see viewerData.ts).
  ifc_viewer_geometry: ifcRead,
  ifc_viewer_element: ifcRead,
  ifc_viewer_selection: ifcRead,

  // Per-person project memory (platform mode only). Stored in the platform database, never in Dalux. The tools
  // also need read access to the project: projects:read, files:read or tasks:read.
  memory_status: read('memory:read'),
  memory_search: read('memory:read'),
  memory_list: read('memory:read'),
  memory_set_enabled: read('memory:write'),
  memory_write: read('memory:write'),
  memory_update: read('memory:write'),
  memory_forget: read('memory:write'),

  // Server itself
  get_skill: none,
  report_feedback: none,
};
